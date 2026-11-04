# Pre-registration BREADTH-1 (draft v0, revision 3): cheap model + Foundry against frontier alone, across independent beds

**Status: DRAFT v0, revision 3, 2026-10-21. Not frozen. Nothing in this file has run.** It follows
[research/PREREGISTRATION-TEMPLATE.md](../PREREGISTRATION-TEMPLATE.md). Version v1 is frozen and committed only after
every item of the freeze checklist (§11) is filled; until then any run on a sealed item is forbidden, and a result from
a run before the v1 commit is diagnostic evidence only. The design and its reasons are in [PLAN.md](PLAN.md)
(revision 3); this file holds the rules. Revisions 1 (`6c56ec30`) and 2 (`eebece12`, `a1260640`) are superseded; the
changes are listed at the end ("Draft revisions") and argued in the "Critique log" here and in PLAN §15.

| Field | Value |
|---|---|
| Experiment id | BREADTH-1 |
| Claim tested | ROADMAP C1, with the construction (C0) and within-cluster reuse (C2) parts that the Foundry arm exercises: **on a declared portfolio of up to ten independent external beds, Haiku 5.5 inside Foundry is within 10 points (pooled) of Sonnet 5.5 alone at effort high, at no more than half its cost per verified success; Foundry lifts Haiku 5.5 above Haiku 5.5 alone; and Haiku 5.5 inside Foundry is within 10 points of Opus 5.5 alone at effort xhigh (the owner's frontier bar, D19), pooled over Opus anchors on every bed, at no more than half its cost.** The words "non-inferior" and "matches" need the retention test too (§5.4). Falsifiable by §5.7. Superiority over Opus xhigh on enterprise streams is a separate preregistration (PREREG-V-1, PLAN §6.6) |
| Evidence class | Sealed items: `sealed` (held-out, claim-bearing). Screens, dev pilots, kit development, interim reports: `development` |
| Pre-registration commit | to be recorded at the v1 freeze (`git log --diff-filter=A --format=%H -- research/breadth-20261021/PREREG-BREADTH-v1.md`) |
| Repository HEAD when this revision was written | `48712cca97d13ff7e93dff4227ae1799938b5916` |
| Policy file | `policy/models.json` version `2026-10-21.2` (re-read at freeze) |
| One-sided level | **0.025** for every claim-bearing test (two-sided 95% intervals); 0.05 only for screens and contamination probes |
| Date | 2026-10-21 (v0, revision 3) |

Tags: **[M]** measured or read in the repo; **[S-obs]** observed by a breadth sweep today; **[C-obs]** observed or computed by
one of today's three critiques; **[calc]** computed for this design; **[P]** a choice this preregistration makes; **[TBD-v1]**
to be filled before the freeze.

---

## 0. What the author had seen before writing

The author (an Opus 5.5 subagent) read PLAN.md and this file at revision 2, the three critiques of revision 2 (validity, cost
and throughput, owner vision) and their scripts and outputs, `research/compromises-20261021/REGISTER.md` (C7),
`PREREG-AB-v1.md` AM-9, `research/decisions-20261021.md` (D16–D23), `research/OPERATING-PRINCIPLES.md`,
`research/jit-20261008/R0-RUNBOOK.md` (G5), `src/executors/claude-code.mjs`, `src/sandbox.mjs`, `policy/models.json` and
DISPOSALS.md; for revision 2 it had read the six breadth sweeps, README, THESIS, ROADMAP, the AB-v1 preregistration and its
amendments, DEV60 and DEVCHECK, SOP-Bench notes, the seed ledger and the pinned τ² clone's telecom split, task ids,
registry and solo-mode code. It ran three $0 calculations (`breadth/plan3/power3.py`, `cost4.py`, `harm_guard.py`). It did
**not** read any test or sealed item of any bed, nothing under `beds/sealed/`, and no aggregate of the running SOP-Bench
sealed run. It has seen published aggregate leaderboards and per-task frontier result files only through the sweeps'
summaries. It has seen the dev results of AutomationBench (DEV60, DEVCHECK), which motivate the portfolio dev gate.

---

## 1. Beds and splits

### 1.1 Portfolio, in declared order [P]

The primary pool is the first **ten** beds of this list that pass admission (§1.2), substitutes taking the place of skipped
beds in order, and scouted beds appended at the end by dated amendment (§1.2 step 0). The verdict (§5.7) is computed once,
on the beds complete by **2026-11-18**; it needs **B ≥ 8**, otherwise it is labelled "underpowered, B = k".

| Order | Bed (pin) | Held-out class (PLAN §1) | Cluster | Sealed sample: Haiku arms / A-S / A-O anchors | Margin outcome |
|---|---|---|---|---|---|
| 1 | WorkBench @`49c7dfd00c03d384ec59ea57374f50b766aa5613` | H2-ext if regeneration changes the answers, else H4 | template | 40 held-out templates × 3, + 1 for each held-out multi_domain template ≈ 132 / n_eff 60 / 20 templates | official `is_correct`; co-reported on the state-changing subset |
| 2 | AgentDojo 0.1.35, benchmark v1.2.2 | H3 (≥ 20 authored injections) on H4 user tasks | user task (two-way with injection task as sensitivity) | 58 held-out user tasks × {benign, inj-a, inj-b} = 174 / n_eff 60 / 20 user tasks | **utility** (benign and under attack); security co-reported and in the harm guard |
| 3 | AppWorld 0.1.3.post1, data 0.1.0 | H1e (encrypted official test_normal) | scenario | 56 scenarios × 3 variants = 168 / ≈ 64 (≤ 2 variants per scenario) / 20 scenarios × 1 variant | TGC |
| 4 | τ²-bench telecom @`57e54143`, solo mode (`llm_agent_solo`, `dummy_user`) | H4 (+ v2.0.0-replaced subset flagged) | intent × subtask count × persona cell | 100 (official test 40 + 60 from the pool, ≤ 3 per cell) / ≈ 75 / 20 cells | reward = environment assertions (+ ACTION where defined, after the BG-6 audit) |
| 5 | BFCL v4 multi-turn (`bfcl-eval` 2026.3.23): base, miss_func, miss_param, long_context | H4 | category × API set | 160 (40 per category) / ≈ 69 / 20 | state ∧ response ∧ order checkers |
| 6 | SpreadsheetBench V2, non-chart tasks [TBD-v1: pin] | H4 (released 2026-09) | task | ≥ 60 tasks, ≥ 20 clusters / n_eff 60 / 20 | required cells exact ∧ untouched cells unchanged ∧ final answer exact |
| 7 | NaturalPlan (data sha256 trip `15c4755d…`, meeting `cabd5537…`, calendar `3f34ff27…`), as an agent bed | H2-own (our generator) or H4 fallback | task type × complexity level | ≈ 27 × 10 = 270 / ≈ 77 / 20 | trip exact; meeting simulator score = golden; calendar feasibility checker |
| 8 | EnterpriseOps-Gym csm + itsm + hr (repo @`271f2c35…`, HF @`c8e538ea…`), owner's laptop, **distractor-tool mode** | H4 | domain × task template | 120 / ≈ 69 / 20 | SQL state verifiers (tasks without `response_check`) |
| 9 (cond.) | DABstep-fresh over HF `adyen/DABstep` @`b427f39e…` context data | H2-own | question template | 40 templates × 3 = 120 / ≈ 77 / 20 | exact answer, admitted only if two independent solvers agree (§1.5) |
| 10 (cond.) | first scouted bed (§1.2 step 0) | per bed | per bed | ≥ 20 clusters / n_eff 60 / 20 | per bed, by amendment |
| sub 1 | SpreadsheetBench-912 v0.1 (sha256 `9cf7228b…3399`), only if bed 6 is skipped | H4 | instruction | 60 instructions × cases 2–3; every arm sees case 1 with its answer | both held-out cases pass |
| sub 2 | PlanBench (Blocksworld, Logistics, Depots × plain, mystery, randomized), regenerated, as an agent bed | H2-own | domain × variant × size bin | ≈ 150 | plan valid under VAL or a VAL-parity validator and reaches the goal |
| sub 3 | ToolHop (ToolHop.json sha256 `0a51f71a…a7fab`) | H4 | knowledge domain | 160 | exact `<answer>`; format-only failures reported |

**Not in the primary pool** (§1.7): AutomationBench AB-v1 test and SOP-Bench phase 2 (pool X); enterprise streams (pool V,
own preregistration); own Claude-written beds (pool O); build-once forms of NaturalPlan, PlanBench and SpreadsheetBench-912
(pool B); factory families (pool F); τ² banking_knowledge + airline with a Haiku user simulator (descriptive only); NESTFUL
(need-router negative control only); DS-1000 (dropped); descriptive beds with fewer than 20 clusters (AgentArch, ITBench-Lite,
TaxCalcBench TY24, MCPMark local).

### 1.2 Admission (all before any paid sealed run on that bed) [P]

0. **Scouted beds** (slot 10 and later) are proposed by a session that has seen no breadth arm outcome, against fixed
   criteria: released after 2026-06; executable deterministic oracle; runnable under D16; ≥ 20 clusters; licence recorded.
   They are appended to the order by dated amendment before any of their items is opened.
1. **D16**: pinned install outside the repo, ≤ 500 MB, every download recorded (URL, sha256, size, licence, date).
2. **$0 oracle-validity gate** BG-0…BG-11 (PLAN §5.4) passes, results in §1.6, including BG-8 probed from inside the bed's
   own code-execution path, BG-10 (oracle fixes frozen before any build sees oracle feedback) and BG-11 (hard-violation map).
3. **Contamination probe battery** (§8.1.2) is clean for H4 beds.
4. **Screen**, on public dev items with the minimal facade and no F-kit: a $0 pre-screen from published per-task results
   where they exist, then A-H and A-S on ≥ 30 paired dev tasks. **Headroom**: skipped as *saturated* if both ≥ 0.90, as
   *uninformative* if A-S < 0.10. **Assay**: admitted if A-S − A-H ≥ 0.20 at 30 pairs; if it lies in [0, 0.20), extended to
   60 pairs and admitted if ≥ 0.10; otherwise reported as "no frontier premium here" with all its dev contrasts, and the next
   substitute takes its place.
5. **Dev pilot**, on dev items only, with every arm (A-H, F-H as the kit stands, A-S, A-O on 10–20 dev items, A-HN on beds
   1–3): it estimates discordance, the intra-cluster correlation, the flip rate, cost and meter units per session by arm, each
   arm's 99th-percentile wall time and cost (for §2's caps), harm rates, and Foundry run-store size.
6. **Portfolio dev gate**: sealed A-S and A-O arms start on a bed only if the pooled dev estimate of F-H − A-S over every
   bed piloted so far (beds 1–3 at the first evaluation, ≈ 180 pairs) is ≥ −0.03. Otherwise the F-kit iterates on dev
   (looks counted, §2) and the bed waits: no arm runs on its sealed items, because all arms of a task must interleave (§2).
7. **Depth and cost gate**: with the dev ICC, the planned sample must give ≥ 20 clusters and n_eff ≥ 60 for F-H vs A-S;
   the projected sealed cost must fit the bed's cap (§7); otherwise clusters are cut, never below 20 or n_eff 60; below that
   the bed is skipped. **Opus depth gate**: A-O runs at full A-S depth on a bed only if the pooled dev F-H − A-O over the beds
   piloted so far is ≥ −0.02 and the meter rule allows it (PLAN §9.1); otherwise it runs as a 20-task anchor.

All screen and gate numbers are recorded in §1.6 before the bed's sealed manifest is opened. A bed is never skipped after any
of its sealed outcomes is known.

### 1.3 Splits and sealed manifests [P, details TBD-v1]

**Salt.** Every `breadth-*-v1` ordering below uses the salt **s = the full SHA of the first autosave commit ("WIP: running
agents' changes") made after the commit that freezes these split rules**. Autosave commits are made by the harness with other
tracks' changes, so the breadth author cannot choose or grind them. The rule commit itself names no salt. Orders are
`sha256(s + ':' + bed + ':' + id)`.

**Task order inside a bed.** Sealed tasks run in the order `sha256(s + ':order:' + bed + ':' + task)`; all arms of a task
run together. A bed stopped at its cost cap therefore leaves an unbiased paired subset.

- **WorkBench.** Within each domain, templates by salted hash; the first round(0.42 · n_domain) are dev (5/5/4/3/3/9 = 29),
  the rest held out (40). Sealed instances: `workbench-generate-data` with a seed derived from s [TBD-v1: command and
  verified seed control], 3 per held-out template plus 1 more per held-out multi_domain template; the bed is H2-ext only if
  regenerated instances change the gold answers relative to the shipped ones (checked at $0); fallback: shipped instances of
  held-out templates, H4. Analysis weights by population share (§5.1).
- **AgentDojo.** Per suite, user tasks by salted hash; the first 40% dev (39), the rest held out (58). Sealed injection tasks:
  **≥ 20**, written by a session with no access to the F-kit or any arm output, each validated fail-to-pass by a scripted
  agent, hashed and stored host-only before any arm runs. Attack: `important_instructions` [TBD-v1: confirm at the pin]. Per
  held-out user task: one benign and two attacked units (injections assigned by salted hash).
- **AppWorld.** Official splits. Kit development on train and dev only. Sealed: all 56 test_normal scenarios; the A-S subset
  is ≤ 2 variants per scenario by salted hash, cut to n_eff 60; A-O anchors are 20 scenarios × 1 variant by salted hash,
  without opening content. test_challenge is not touched.
- **τ² telecom.** Dev: the official train split (74). Sealed: the official test split (40) plus 60 tasks from the pool
  outside train and test by salted hash, at most 3 per intent × subtask-count × persona cell; cluster = that cell (design effect
  with m ≤ 3). [TBD-v1: the cell count of the drawn sample must be ≥ 20.]
- **BFCL-MT.** Per category, entries by salted hash; the first 40 sealed, the next 10 dev.
- **SpreadsheetBench V2.** Non-chart tasks by salted hash; 60 sealed (≥ 20 clusters), 20 dev [TBD-v1: pin, task count,
  cluster definition].
- **NaturalPlan.** Dev: a 30% stratified sample of public instances. Sealed: our generator's instances, admitted by the
  faithfulness gate (PLAN rev 2 §4.3); fallback public instances outside the dev sample plus a paraphrased format-drift copy,
  H4.
- **EnterpriseOps-Gym.** Per domain, tasks without `response_check` by salted hash; 20% dev, sealed 40 per domain; mode with
  distractor tools [TBD-v1: the mode name at the pin; task counts resolved].
- **DABstep-fresh.** 40 templates by salted hash, 3 new parameterizations each, generated with a seed derived from s and
  hashed; 1 further parameterization per template for dev.

**Burned items.** Any sealed item that is opened, printed or diagnosed outside the run is burned and listed in a dated
amendment; it never enters another held-out set.

### 1.4 Who authored what

| Artifact | Author | Must not have seen |
|---|---|---|
| F-kit core templates | Opus 5.5 builder session | any sealed item |
| Bed cards, **all** primary and substitute beds, hashed before the first sealed run | Opus 5.5 card session(s); later edits only on that bed's dev evidence, as logged diffs | any sealed item or sealed outcome of any bed |
| AgentDojo sealed injection tasks | a separate session | the F-kit and any arm output |
| NaturalPlan generator, feasibility checker; DABstep solvers (**two, by two separate sessions**); PlanBench validator | builder sessions | sealed generated instances; for DABstep, each other's code |
| Seeds, manifests, salts | scripts (§1.3) | — |
| Analysis script | this design's author or a successor | any sealed outcome |
| Log-audit reader | a session that built nothing | — |
| Scouted-bed proposals | a session that has seen no breadth arm outcome | — |

### 1.5 Oracles

Per bed: oracle path and sha256 [TBD-v1]. Oracle code is used as shipped except the declared changes, each frozen by hash
**before any F-kit dev look or build sees oracle feedback** (BG-10) and gated again by BG-1 and BG-3: NaturalPlan calendar
feasibility checker; SpreadsheetBench evaluator fixes (if sub 1 runs); AgentDojo pairing fix (if a code change is needed);
PlanBench validator (if sub 2 runs); DABstep: two independent solvers must agree on all 10 dev answers and on ≥ 99% of the
recovered public test answers on the templates used, every disagreement explained in writing, and the record must state how
the 450 hidden answers were recovered and the dataset's terms; a disagreement on a sealed parameterization voids that item.
AppWorld side-effect mutants are added to BG-3. τ² telecom's ACTION component passes a BG-6 alternative-valid-answer audit.

### 1.6 Control results and admission log

[TBD-v1: one row per bed: BG-0…BG-11 results, floors (the scripted $0 baselines), mutation score, digests, probe results,
pre-screen and screen numbers, dev-pilot numbers (discordance, ICC, flip rate, cost and meter per session by arm, p99 wall
time and cost per arm, harm rates), portfolio dev gate value, depth and cost gate, A-O full or anchor, admitted or skipped
with reason. Beds 1–3 at the v1 freeze; later beds by dated amendment before their sealed runs.]

### 1.7 Secondary pools (never inside the primary verdict) [P]

| Pool | Members | Rule |
|---|---|---|
| X: extended external | primary beds + AB-v1 test + SOP-Bench phase 2 sealed | AB-v1 enters only if a Haiku + Foundry arm and an A0 of Sonnet or Opus xhigh run on the same test tasks; SOP-Bench only if a dated amendment adds A-S or A-O before any sealed aggregate is read. A frontier arm added after a sealed run started is labelled "non-concurrent comparator". Reported as a sensitivity of node A |
| V: enterprise streams | PLAN §6.6 | PREREG-V-1, own α; never pooled with external beds |
| O: own beds | E8, BUILDER-1 fresh-author set, Tier-A beds on fresh seeds, W-bed; DABstep-fresh if its solvers disagree | own preregistrations; separate forest plot "own beds (Claude-written)" |
| B: build-once | NaturalPlan, PlanBench, SpreadsheetBench-912 in F-build form, against wf-S / wf-O builders with the same dev feedback | own addendum, later |
| F: factory families | PLAN §6 | the factory's own claim (PLAN §6.7) |

---

## 2. Arms

| Arm | Definition | Models (policy ids), effort | Tools | Per-task budget | Runs | Frozen hash |
|---|---|---|---|---|---|---|
| **A-H** | plain executor: `claude -p --output-format stream-json` with the hardened flags (below), the bed's official system prompt where one exists, the bed card, the date note and the synthetic identity, `--strict-mcp-config` with only the bed facade | `claude-haiku-5-5`, `high` | facade tools + sandboxed network-off `python`; no Bash, no network | turn cap = bed's official cap; wall timeout and $ reservation = 1.5 × A-H's dev p99 [TBD-v1] | K = 2 (3 on bed 4) | [TBD-v1] |
| **F-H** | A-H's executor plus the Foundry MCP server and F-kit v1 (PLAN §5.3): Haiku constructs from Opus-written templates, runs, verifies with gating acceptance; F-reuse (beds 1, 2, 3, 4, 7, 9), F-live (5, 6, 8) | `claude-haiku-5-5`, `high`, construction and nodes; templates written once by `claude-opus-5-5` | facade + `python` + Foundry MCP | same turn cap; wall timeout and $ = 1.5 × F-H's dev p99; construction and verification charged to the task | 3 lineages (random stream orders); 2 on beds 3 and 8 | [TBD-v1] |
| **A-S** | A-H with the model changed | `claude-sonnet-5-5`, `high` | as A-H | 1.5 × A-S's dev p99 | K = 2 (3 on bed 4), on the n_eff-60 subset | [TBD-v1] |
| **A-O** | A-H with the model changed | `claude-opus-5-5`, **`xhigh`** (D19) | as A-H | 1.5 × A-O's dev p99 | K = 2 (3 on bed 4); 20-task anchor (one task per cluster) unless the Opus depth gate passes | [TBD-v1] |
| **A-HN** (beds 1–3) | A-H plus a notes file the arm may read and write, carried along each cluster stream in the same random order as an F-H lineage: the naive-memory control | `claude-haiku-5-5`, `high` | as A-H + one notes file | as A-H | K = 2 | [TBD-v1] |
| **F-HM** (beds 1–3 dev; V) | F-H with Mercury 3 as planner and checker, Haiku acting | `mercury-3` + `claude-haiku-5-5` | as F-H | Mercury tokens within D18 (OD-11) | dev only, unless the rule below makes it the frozen Foundry arm | [TBD-v1] |

**Foundry-arm choice rule** [P]: if the owner raises the D18 ceiling enough for every admitted bed (OD-11) and F-HM's pooled
dev success on beds 1–3 exceeds F-H's by ≥ 3 points, F-HM replaces F-H as the Foundry arm on every bed at the v1 freeze;
otherwise F-H is the Foundry arm and F-HM is descriptive. The choice uses dev data only and is recorded before any sealed run.

**Haiku effort.** One dev look (counting toward the ≤ 3) may test A-H, A-HN and F-H at `max` on beds 1 and 2; if A-H rises
by ≥ 5 points at ≤ 2× cost on both, the Haiku arms switch to `max` together before the freeze [P].

**Hardened session configuration, every top-level and nested session** [P]: `--safe-mode --tools <list>
--disable-slash-commands --no-session-persistence --strict-mcp-config`, inside the sandbox (as
`src/executors/claude-code.mjs:302-304` [M]). The runner records each session's init event (tools, MCP servers, skills and
plugins count, system-prompt hash) and refuses a session whose configuration differs from its arm's frozen one, apart from
the declared Foundry server; it checks that `--effort` was accepted (no silent fallback). The CLI is pinned by hash.

**Identity and date** [P]: the synthetic identity and the bed's date note are declared in every arm's prompt, identical
across arms. Before any pilot, the C7 engine fix (strip or replace the account identity) lands and every arm configuration
passes a one-call identity probe (no account address in the reply). Runs before the fix are diagnostic. Per arm, the share of
tool arguments containing the account address is logged, and an outbound send to it scores as a failure.

**Held constant across arms:** bed tools and `python`, environment, reset state, official prompt, bed card, date note,
identity, turn cap, grader, CLI version and hash, engine freeze (without network-capable node capabilities), resource limits
(multiplier recorded). Timeouts and cap hits count as failures, charged at their recorded cost or at the reservation if
unrecorded.

**Interleaving:** tasks run in the salted order of §1.3; per task, arm order is randomized with seed
`sha256(s + ':arm-order:' + bed + ':' + task)` and recorded; all arms of a task run on identical reset worlds in the same wave.
A bed's sealed run starts only when every one of its arms can run interleaved; otherwise the bed waits. Comparator dev runs may
be cached; sealed runs never are.

**What Foundry may use on sealed items:** its own verification, applicability gates and kept workflows from earlier instances
of the same cluster in the same lineage. Never the oracle, gold, the sealed manifest, another lineage's workflows, or anything
written after the freeze.

**Engine:** one named engine freeze for every sealed run of BREADTH-1 [TBD-v1: tag and commit]; CLI version recorded per run.

**Not arms:** the Haiku 4.5 harness-parity anchors (WorkBench dev templates, BFCL dev entries), published per-task frontier
results, cached dev comparators, the need router's routed policy (a derived quantity, §5.6). No frontier harness-parity anchor
is possible under the current policy file (PLAN OD-16); the A arms are labelled "our harness".

---

## 3. Measurements

### 3.1 Primary outcome

Per task and run: binary success by the bed's margin outcome (§1.1). Per task: ȳ = the mean over its runs (F-H: over its
lineages). AgentDojo: utility on benign and attacked units.

### 3.2 Cost per verified success (CPS)

**Run-time CPS** (H2): all list-price USD of the arm on the bed's sealed sample (every run, failures, timeouts, construction,
verification, applicability gates) ÷ the number of oracle-verified successes, **as billed** (CLI `total_cost_usd`,
costBasis = list) **and cache-neutral** (journaled tokens at the policy's uncached prices); the as-billed figure is the test
statistic, the cache-neutral one a sensitivity. Haiku calls above 100K prompt tokens are charged at the higher tier. Zero
successes: add 0.5 and flag. **Completeness check**: for F-H, the sum of every nested and gateway call's journaled tokens at
policy prices must match its recorded cost within 2%; a larger gap is reported and the larger figure used.

**Adaptation cost** (secondary): template and card authoring per bed, with the break-even number of tasks against A-S.

CPS is always reported with its two factors (cost per task ratio; success ratio).

### 3.3 Secondary measurements

- pass^2 on every bed; pass^3 on bed 4.
- **Hard violations** per the BG-11 map: harmful side effects (WorkBench), targeted ASR (AgentDojo), forbidden writes (τ²),
  collateral damage (AppWorld), invariant breaks (EnterpriseOps-Gym), untouched cells changed (SpreadsheetBench V2); per bed,
  whether the margin outcome already fails on each.
- **Sub-goal outcomes**: AppWorld per-assertion and τ² per-subtask results, compared with F-H's own sub-workflow verdicts.
- F-H process: construction failures, self-verification false-pass rate, reuse rate, wrong-reuse rate, deopt and fallback
  rate.
- A-HN vs F-H on beds 1–3 (typed workflow reuse against a notes file); WorkBench reuse streams (20 held-out templates × 10
  instances, Haiku arms and A-HN): success by position in the stream; fault/drift subsets on beds 1–2 (20 extra units each,
  A-H, F-H, A-S).
- **Usage**: meter units per session from `rate_limit_event` (5-hour and 7-day utilisation before and after), sessions,
  turns, input, output and cache tokens per success, wall time.
- **Per arm**: cap hits, timeouts, infrastructure faults and exclusions; any above 5% of a bed's tasks is flagged.
- Gold-solution length per task (horizon covariate). Contamination contrasts (§8.1).

**Transcript retention, the same for every arm**: failures and a seeded 10% sample of passes kept gzipped after the log audit;
the structured record and hash of every run journaled.

### 3.4 Unit of analysis

Within a bed: the cluster (§5.1). Across beds: the bed (§5.2).

---

## 4. Power

[calc, `breadth/plan3/power3.py` → `power3.txt`; mKH with Paule-Mandel τ²; 2,000 replications per cell, 3,000 for size;
A-S n_eff 60 per bed; node C over 20-task Opus anchors on every bed (discordance 0.30); lift F-H − A-H mean 0.10 with τ 0.10;
τ of log CPS 0.4; true CPS ratio vs Sonnet 0.30; δ = 0.10; one-sided 0.025.]

| True F-H − A-S | τ | Opus premium | B | P(node A) | P(A ∧ retention) | P(A ∧ B) | P(A ∧ C) |
|---|---|---|---|---|---|---|---|
| 0 | 0.05 | 0 | 8 / 10 | 0.69 / 0.85 | 0.30 / 0.38 | 0.38 / 0.56 | 0.26 / 0.38 |
| 0 | 0.10 | 0 | 8 / 10 | 0.47 / 0.61 | 0.22 / 0.28 | 0.28 / 0.43 | 0.20 / 0.29 |
| −0.03 | 0.05 | 0.05 | 8 / 10 | 0.47 / 0.60 | 0.16 / 0.21 | 0.26 / 0.40 | 0.02 / 0.04 |
| −0.03 | 0.10 | 0.05 | 8 / 10 | 0.27 / 0.37 | 0.12 / 0.14 | 0.18 / 0.26 | 0.03 / 0.04 |
| −0.05 | 0.05 | 0.05 | 8 / 10 | 0.26 / 0.36 | 0.09 / 0.11 | 0.16 / 0.25 | 0.01 / 0.01 |
| −0.05 | 0.10 | 0.05 | 8 / 10 | 0.16 / 0.20 | 0.07 / 0.08 | 0.11 / 0.15 | 0.01 / 0.02 |

Size: P(node A) = 0.013 (B 8) and 0.018 (B 10) at a true F-H − A-S of −0.10 (τ 0.05); P(A ∧ C) = 0.012 and 0.017 when F-H is
0.10 below Opus. Monte-Carlo SE about 0.003.

**Prior expectation, stated before any sealed run** [P]: the AutomationBench dev evidence puts Haiku + Foundry 2–5 points
below Sonnet alone (dev60 18/60 vs 20/60; devCheck 20/60 vs 23/60). At those effects the most likely verdict of this
experiment is **"Inconclusive"**. The portfolio dev gate (§1.2 step 6) exists so that sealed comparator money is spent only
once the dev gap is ≤ 3 points.

**Harm guard** (§5.5) is not in the table: it is a verdict guard, not a test with its own power. A co-primary non-inferiority
test on harm was rejected because it would pass with probability ≤ 0.10 at a +0.02 margin and 0.45–0.62 at +0.05 with equal
harm rates of 3–15% on six beds [calc, `plan3/harm_guard.txt`].

n_eff = tasks ÷ design effect, DE = 1 + (m − 1)ρ; to be re-estimated from the dev pilots.

**Downgrades declared now:**
- Interim reports at 3 and 6 beds are **descriptive**.
- Per-bed tests are **directional**.
- Node C is a **stretch test**: with a 5-point Opus premium over Sonnet its power is ≤ 0.04.
- If fewer than 8 beds are complete by 2026-11-18, the analysis runs on the beds complete and is labelled "underpowered,
  B = k" with the power from this model.

---

## 5. Analysis

Analysis script: `experiments/breadth/analyze.mjs` [TBD-v1: path, sha256, frozen before any sealed run, unit-tested against
the Python simulations in `breadth/tools-meth/`, `breadth/plan2/` and `breadth/plan3/`]. Gaps under 3 points are noise. No
conclusion from K = 1.

### 5.1 Within a bed

- Task-level paired difference D_t = ȳ_t(F-H) − ȳ_t(X) for comparator X ∈ {A-S, A-O, A-H, A-HN}, on the tasks where both ran.
- Bed estimate θ̂_b = Σ_t w_t D_t / Σ_t w_t with w_t = stratum population share ÷ stratum sample share (corrects WorkBench's
  multi_domain oversampling and the comparator subsets).
- **Variance (primary): cluster-robust CR1**, v_b = G/(G−1) · Σ_c (S_c − m_c θ̂_b)² / n², S_c = Σ_{t∈c} w_t D_t, t on G − 1 df.
- **Sensitivities:** Tango's score test with n_eff = n/DE (ANOVA ICC of D_t, floor 0.10); cluster bootstrap (10,000 replicates,
  clusters resampled within strata) **only where G ≥ 30**; a Bayesian paired interval (`bayes_evals`, MIT) where G < 20; for
  AgentDojo, two-way cluster-robust variance (user task × injection task).
- Every bed reports its 2×2 discordance table (n11, n10, n01, n00) per comparator.

### 5.2 Across beds

- Paule-Mandel τ̂²; weights w_b = 1/(v_b + τ̂²); μ̂ = Σ w_b θ̂_b / Σ w_b; q = Σ w_b (θ̂_b − μ̂)² / (B − 1).
- **SE_mKH = max( sqrt(q / Σ w_b), sqrt(1 / Σ w_b) )**; lower one-sided bound μ̂ − t_{B−1, 0.975} · SE_mKH.
- Prediction interval for a new bed: μ̂ ± t_{B−2, 0.975} · sqrt(τ̂² + SE²); I² = τ̂² / (τ̂² + typical v_b).
- Predictive probability that a new bed is within the margin: F_{t, B−2}((μ̂ + δ) / sqrt(τ̂² + SE²)).
- **Sensitivities** (reported, never substituted): REML τ̂², the unweighted macro mean with t on B − 1 df, DerSimonian-Laird.
- Cost: per bed, ℓ_b = log CPS(F-H) − log CPS(X) with a delta-method variance from the paired task-level costs and successes
  (cluster-robust); pooled on the log scale as above.

### 5.3 Hypotheses and the claim graph

All tests one-sided at 0.025 in total (family-wise), δ = 0.10.

| Id | Statement | Test (pooled over) |
|---|---|---|
| H1-S | μ(F-H − A-S) > −0.10 | lower mKH bound > −0.10 (all admitted beds with comparators) |
| H2-S | CPS(F-H) / CPS(A-S) ≤ 0.5 | upper bound of pooled ℓ < log 0.5 |
| H3 | μ(F-H − A-H) > 0 | lower bound > 0 (all admitted beds) |
| H1-O | μ(F-H − A-O) > −0.10 | lower bound > −0.10, over the A-O tasks (anchors or full) of every admitted bed |
| H2-O | CPS(F-H) / CPS(A-O) ≤ 0.5 | upper bound < log 0.5, same beds |
| H4-S | μ(F-H − A-S) > 0 ("beats Sonnet") | lower bound > 0, admitted beds **except AgentDojo** |
| H4-O | μ(F-H − A-O) > 0 ("beats Opus xhigh") | lower bound > 0, admitted beds **except AgentDojo** |

**Claim graph** (graphical multiple testing with α recycling; the hypotheses inside a node are an intersection-union):
- **Node A** = H1-S ∧ H2-S, tested at α = 0.025.
- If A holds: **node B** = H3 and **node C** = H1-O ∧ H2-O are each tested at 0.0125. If one of them holds, its 0.0125 passes
  to the other, which is then re-tested at 0.025.
- If A, B and C all hold: **node D** = H4-S at 0.025; if D holds, **node E** = H4-O at 0.025.
- Node C needs A-O data on ≥ 5 admitted beds; otherwise its α stays with B and the Opus comparison is descriptive.

### 5.4 Assay sensitivity, retained lift and the wording gate

- **Lift** λ = pooled μ(A-S − A-H), with its interval. Label: **informative** if λ's lower bound > δ; **weakly informative** if
  λ̂ ≥ δ but its lower bound ≤ δ; **uninformative** if λ̂ < δ. The same for A-O versus A-H.
- **Retained-lift ratio** r = μ̂(F-H − A-H) / μ̂(A-S − A-H), with a Fieller interval when λ's lower bound > 0.
- **Retention test** at f = ½: per task L_t = ȳ(F-H) − ½ ȳ(A-S) − ½ ȳ(A-H), pooled by §5.2, lower one-sided 97.5% bound > 0.
- **Wording gate** (no α spent; it only restricts words): a verdict may use "non-inferior" or "matches" for Sonnet only if node
  A holds **and** the retention test passes (for Opus: node C and the retention test with A-O in place of A-S). Otherwise the
  sentence says "within 10 points of …, retaining r̂ (interval) of its premium over Haiku alone".

### 5.5 Harm guard

On the beds whose BG-11 map defines hard violations, h_b = harm rate(F-H) − harm rate(A-S), pooled by §5.2. **No verdict of
§5.7 may read "Supported" if the pooled lower one-sided 97.5% bound of h is above 0** (Haiku + Foundry shown to break more
rules); the verdict then reads "… with more hard violations than Sonnet 5.5 alone" and cannot be "Supported". Non-inferiority
on harm at +0.05 is reported (secondary), with its power at the observed rates.

### 5.6 Secondary analyses (descriptive; Holm-adjusted where a p-value is shown)

1. Per-bed table: θ̂_b with interval for F-H − A-S, F-H − A-O, F-H − A-H, A-H − A-S; per-bed directional tests with Holm.
2. F-H − A-HN on beds 1–3 (is the gain typed workflows or any memory?); WorkBench reuse-stream curves.
3. F-HM on beds 1–3 dev and in V (second cheap model), unless it is the frozen Foundry arm.
4. pass^3 on bed 4 by arm; ICC of task outcomes from the K = 3 subsamples.
5. Hard violations by kind and bed (§3.3); fault/drift subsets.
6. Sub-goal outcomes against F-H's own sub-workflow verdicts; F-H process measures, including the self-verification false-pass
   rate.
7. **Horizon dose-response**: logit P(success) = a_arm + b_arm · log L, L the gold length standardized within bed, cluster-robust
   SE, pooled; arm × log L interaction. A "long-horizon" sentence needs ≥ 2 beds whose gold-length range spans ≥ 4×.
8. **Counterfactual need router**: the frozen router's choice per task (A-H, F-H or escalate: to A-O on anchor tasks, to A-S
   elsewhere); the routed policy's success and CPS, computed from the arms' observed outcomes on identical worlds.
9. **Moderators** (exploratory, at most two): held-out class; the bed's A-S success.
10. Accuracy-versus-cost Pareto hull per bed and pooled, origin included, in dollars, tokens and meter units.
11. Pools X, V, O, B and F beside the primary (§1.7), each labelled. Host study (laptop), within host only, own addendum.

### 5.7 Decision rules (verdict)

Every verdict sentence carries the envelope sentence (PLAN §1), names the effort levels ("Sonnet 5.5 at high", "Opus 5.5 at
xhigh"), the assay label, r and the harm-guard result, and lists which owner shapes (PLAN §3.2) have evidence in this
experiment and which do not. The phrase "the owner's bar" may only be used with the node that supports it (C here; V in
PREREG-V-1).

| Verdict | Rule |
|---|---|
| **Supported against Opus 5.5 xhigh (external tool-use beds)** | A ∧ B ∧ C, harm guard clear. Sentence: "Haiku 5.5 in Foundry is within 10 points of Sonnet 5.5 alone (at high) and of Opus 5.5 alone (at xhigh) pooled over every bed, at ≤ ½ their cost per verified success, and Foundry lifts Haiku", with "non-inferior" only under the wording gate (§5.4), μ̂ with interval, τ̂, the prediction interval |
| **Supported against Sonnet** | A ∧ B, not C, harm guard clear. Names Sonnet only and states "not shown against Opus xhigh" |
| **Cheap system, Foundry's share not shown** | A (with or without C), not B |
| **…, beats** | add "and better than Sonnet 5.5 alone" if D holds; "and better than Opus 5.5 xhigh" if E holds (AgentDojo excluded) |
| **… with exceptions** | any supported verdict where at least one bed is *clearly inferior* (its own upper 97.5% bound for F-H − A-S below −0.10): the envelope excludes that bed's domain and shape |
| **… with more hard violations** | §5.5 guard tripped: replaces "Supported" |
| **Refuted (within the envelope)** | the pooled upper 97.5% bound of F-H − A-S below −0.10, or the pooled CPS-ratio lower bound above 1 |
| **Inconclusive** | anything else |

### 5.8 Robustness (stated in the same sentence as the verdict; they do not change it unless marked)

- **H1e/H2-ext/H3-only** (H4 and H2-own beds removed): if node A fails here while it holds on all beds, the verdict sentence
  adds "only with public or own-generated beds included" and may not use the wording-gate words **(this one changes the
  wording)**;
- the prediction interval's lower bound against −0.20, and the predictive probability for a new bed;
- leave-one-bed-out node A;
- node C without the laptop bed (8);
- failures from timeouts excluded (per arm);
- cache-neutral CPS; CPS with adaptation cost added;
- AgentDojo with two-way clustering; WorkBench on the state-changing subset;
- REML, macro-t and DL pooling.

### 5.9 Missing data

A task with an infrastructure fault (harness crash, rate-limit stop, disk full, Docker fault; not a model timeout) is re-run
from a fresh reset in the same or the next wave until it clears, at most 3 times; if it still faults it is excluded from
**every** arm of that bed and listed per arm. Model timeouts and cap hits are failures (§2).

---

## 6. Stopping, kill rules and falsifiers

- **No efficacy stop and no futility look**, inside a bed or across beds. (Revision 2's futility cut was calibrated on 202
  independent pairs; at the planned n_eff its false-stop rate was 0.05–0.14 [C-obs].)
- **Portfolio dev gate** (§1.2 step 6): before any sealed comparator run; not a look at sealed data.
- **Portfolio interim reports** at 3 and 6 complete beds: descriptive. A non-binding refutation stop: if the pooled upper
  97.5% bound for F-H − A-S is below −0.10 at an interim, comparator arms on not-yet-started beds may be cancelled and
  "Refuted (within the envelope)" issued on the complete beds.
- **Cost:** a bed stops at its cap (§7) and enters the pool with the tasks completed in salted order, labelled.
- **Invalid evaluator:** a bed whose oracle is found invalid after its sealed run is excluded and the next substitute is run;
  the finding is reported (AGENTS.md: an invalid evaluator blocks claims).
- **Leakage:** if any arm or builder read a sealed item, gold, or a grader output (§8.1), that bed's sealed run is void and its
  items are burned.
- **Deadline:** analysis on the beds complete at 2026-11-18 23:59Z.
- **ROADMAP §4.3 falsifiers that apply (C1/C2):** "non-inferiority fails"; "held-out families drop more than 5 points" (a
  dev-to-sealed drop of F-H above 5 points on a bed is reported as a falsifier signal); "wrong reuse exceeds 5%" (pooled F-reuse
  wrong-reuse rate).
- **Interim looks change neither the stopping rules nor the verdict.**

---

## 7. Cost caps

List price; per-task figures are [I] until the dev pilots replace them (PLAN §10, `plan3/cost4.txt`).

| Bed | Planned sealed $ | Cap (stops the bed) |
|---|---|---|
| 1 WorkBench | ≈ 24 | 35 |
| 2 AgentDojo | ≈ 24 | 35 |
| 3 AppWorld | ≈ 283 | 380 |
| **Beds 1–3** | **≈ 331** | **450** |
| 4 τ² telecom (K = 3) | ≈ 206 | 280 |
| 5 BFCL-MT | ≈ 27 | 40 |
| 6 SpreadsheetBench V2 | ≈ 63 | 90 |
| 7 NaturalPlan | ≈ 16 | 25 |
| 8 EnterpriseOps-Gym | ≈ 246 | 340 |
| 9 DABstep-fresh (cond.) | ≈ 57 | 80 |
| 10 scouted (cond.) | ≈ 27 [I] | by amendment |
| **Beds 4–10** | **≈ 642** | **≈ 855 + slot 10** |
| Sealed extras: A-HN (beds 1–3) ≈ 48; WorkBench reuse streams ≈ 17; fault/drift ≈ 7; need router ≈ 2 | ≈ 75 | 105 |

Screens, dev pilots, probes, kit development and bed cards are separate small experiments with their own caps (beds 1–3
≈ $180, beds 4–10 ≈ $220, all bed cards ≈ $65, factory build ≈ $30). If the Opus depth gate passes on a bed, its plan and cap
rise by a dated amendment recorded before its sealed run. The policy's $500 single-experiment pause (`policy/models.json`
`spend`) applies per stage: PLAN §11 OD-1 records the decision and the README note (dollars and meter weeks) before the first
stage above it starts. Every cost and every 429 is recorded. The meter rules of PLAN §9.1 (dose test, 5h ≤ 0.60 and 7d ≤ 0.80
at wave start, ≤ 35% of the 7-day window per week) bind every wave.

---

## 8. Threats to validity and contamination checks

### 8.1 Contamination and leakage

1. **Release ledger.** Per bed: public release, last data change, public-answer status, canary presence, class (PLAN §1). No
   knowledge cut-off is published for Haiku 5.5, Sonnet 5.5 or Opus 5.5; every public item older than 2026-08 is treated as
   possibly seen; vendor post-training toward reported benchmarks is possible.
2. **Probe battery** per bed (≈ $5–15) on **≥ 100 non-sealed items** (dev plus unused public pools), for **Haiku 5.5,
   Sonnet 5.5 and Opus 5.5**: (a) slot guessing on masked task fields (TS-Guessing); (b) verbatim continuation of task-file
   lines; (c) canary completion where a canary exists; (d) paraphrase comparison (success on original vs paraphrased dev
   items). Exact one-sided tests at 0.05 against the declared chance or floor rate. A flagged H4 bed is not admitted; a flagged
   H1e–H3 bed is admitted with the flag reported. Revision 2's gold-action probe is dropped (it cannot succeed on agentic beds
   whether or not they were memorized).
3. **Fresh vs public, pooled difference in differences** (WorkBench shipped vs regenerated; τ² v2.0.0-replaced vs unchanged;
   NaturalPlan public vs generated): per arm, gap = success(public) − success(fresh) on ≥ 60 items per side per bed; signal =
   pooled (gap F-H − gap A-S), one-sided against 0.05.
4. **Card sourcing and library leakage scan**: every bed-specific statement in a bed card cites a public document line;
   F-kit templates, cards and kept workflows are scanned for literals of sealed items (hashed n-grams of task text and gold); a
   hit voids the lineage on that bed.
5. **Network-off** bed processes and arms; no benchmark files reachable from arm workdirs **or from the bed's own code-execution
   path** (BG-8).
6. **Log audit of every sealed run**: scripted greps over every transcript as it closes (benchmark name, HuggingFace,
   repository URLs, gold file names); a session that built nothing reads all failures and a seeded 10% of passes, the same for
   every arm, and may only flag. **Deterministic reclassification rule** [P], applied by script to every arm alike: a sealed
   pass becomes a failure if and only if its transcript shows (a) a read of any path on the bed's gold, manifest or verdict
   denylist, (b) a tool argument containing a URL or hostname on the bed's denylist (benchmark repository, dataset host,
   leaderboard), or (c) a read of any file outside the arm workdir and the facade-declared paths. Reader flags outside (a)–(c)
   are reported, never applied, unless they reveal an oracle bypass, which voids the bed. No bed result is final before its
   audit.
7. **H1e/H2-ext/H3-only analysis** (§5.8).

### 8.2 Oracle weaknesses known in advance

WorkBench do-nothing floor 18.0% (paired differences cancel it; the state-changing subset is co-reported) and an untested
generator; AgentDojo injection registration (8 workspace pairings unresolved); NaturalPlan calendar exact match (replaced);
AppWorld evaluated only through `world.evaluate`; τ² telecom's ACTION component on 32 tasks (BG-6 audit); BFCL's multi-turn
driver through `claude -p` + MCP (a $0 check before admission; a category that fails is dropped); SpreadsheetBench V2 chart
tasks excluded (VLM-judged); bed 9's oracle is our solvers (two-solver agreement); EnterpriseOps-Gym `response_check` tasks
excluded [S-obs].

### 8.3 Other threats

- **Shared-harness artefacts** (C7 identity, AM-9 date, flags, cost accounting) move every bed alike and are not covered by
  τ: §2's identity, date and session rules; the init-event check; the completeness check.
- **The Foundry arm differs per bed** only through the bed card, which every arm receives; a bed needing code beyond its card
  is labelled "bed-specific F".
- **Comparator strength.** A-S at `high` (the setting of the existing Sonnet numbers), A-O at `xhigh` (D19); both have the code
  tool and the card. No effort is substituted after the fact.
- **Shared noise compresses gaps** toward "within the margin" (simulator noise, shared timeouts, reservations, faults, flaky
  oracles): per-arm caps from each arm's dev p99, per-arm reporting, the timeout-excluded sensitivity, faults re-run until
  cleared.
- **Harness parity.** The Haiku 4.5 anchors on WorkBench and BFCL compare our plain executor with published per-task results; a
  disagreement above 10 points is reported as a harness difference. No frontier parity anchor exists under the current policy.
- **Infrastructure noise.** Interleaved arms on identical reset worlds; CLI version, engine hash, resource limits and multiplier
  recorded per run (Anthropic reports a 6-point gap between resource configurations [doc]).
- **Not leaderboard entries.** F-H results are never submitted as standard leaderboard entries (ROADMAP §4.3); AppWorld per-task
  test results stay out of git (its terms); SOP-Bench (pool X) is CC BY-NC: per-row results stay out of git; transcripts that may
  carry the account address stay out of git (D17).

---

## 9. What gets reported

In `research/breadth-20261021/REPORT-INTERIM-{1,2}.md` (descriptive) and `REPORT.md` (the verdict), every number with its
command, K and cost:

1. The admission log (§1.6): every bed considered, scouted beds and how they were found, gate results, floors, mutation
   scores, probes, screens, dev-pilot numbers, the portfolio dev gate value, depth gates, admitted or skipped with reason;
   substitutes used.
2. Per bed and arm: tasks, clusters, instances per cluster, success with the cluster-robust interval, pass^2 (pass^3 on bed 4),
   CPS as billed and cache-neutral with its two factors, tokens, sessions, meter units, wall time, cap hits, timeouts,
   infrastructure faults and exclusions (flag above 5%); hard violations; the 2×2 discordance tables.
3. Per bed: θ̂_b for F-H − A-S, F-H − A-O, F-H − A-H, F-H − A-HN and A-H − A-S with intervals.
4. Pooled: μ̂ with the mKH interval for each hypothesis, τ̂, I², the prediction interval, the predictive probability, the forest
   data, the claim-graph path taken, every robustness analysis of §5.8, the assay label, r, the retention test, the harm guard.
5. The verdict from §5.7, verbatim, with its envelope sentence, the owner-shape coverage line and the power of each node at the
   observed τ̂.
6. Secondary analyses (§5.6), labelled descriptive; pools X, V, O, B and F, labelled.
7. Contamination results (§8.1), log-audit findings and reclassifications by rule, harness-parity results, oracle weaknesses,
   the identity-probe and date-note results.
8. Raw failures: every failed sealed run's verdict reason in aggregate (per-task detail host-only where a licence or benchmark
   rule requires it), and negative results in `docs/RESEARCH.md`.
9. Every deviation and amendment, dated, with the items burned.
10. Published frontier numbers used for screening, labelled with model and date, never as our arms.
11. Architect model, executor model, planner/checker model (if F-HM), tools, runtime and human assistance, separately.

---

## 10. Deviations

Any change after the v1 commit goes to the Amendments section with date and reason. A change to arms, beds, splits,
outcomes, hypotheses, the margin, the claim graph or the analysis script after any sealed outcome of the affected bed is known
downgrades the affected result to diagnostic.

---

## 11. Freeze checklist (v0 → v1)

- [ ] Engine freeze tag and commit (no network-capable node capabilities); CLI version and hash; quota-meter capture in the
      runner; day-1 dose test recorded (dollars per 0.01 tick, both windows).
- [ ] C7 engine fix landed; identity probe passed for every arm configuration; date note per bed declared and tested on dev.
- [ ] Facade code hash (incl. the shared `python` tool); per-bed adapter hashes; init-event check in the runner; installs
      recorded under D16; equal-retention run-data rule in the runner.
- [ ] §1.6 admission rows for beds 1–3 at least, incl. BG-0…BG-11, probe battery, screens and the portfolio dev gate; later
      beds by dated amendment **before** their sealed runs.
- [ ] Split salt recorded (the autosave commit SHA of §1.3) and every manifest derived from it: WorkBench seeds and instance
      hashes; AgentDojo injection-task hashes (≥ 20); AppWorld scenario, A-S variant and anchor lists; NaturalPlan and DABstep
      generated-instance hashes when those beds come up; τ² task list hash and cell count ≥ 20.
- [ ] F-kit v1 core hash; **all** bed-card hashes (primary and substitutes) before the first sealed run; per-bed dev-look log
      (≤ 3 looks each, Haiku-effort look included); Foundry-arm choice (F-H or F-HM) recorded with its dev numbers.
- [ ] Arm definitions frozen (§2 hashes); per-arm turn caps, wall timeouts and $ reservations from the dev p99; resource
      limits.
- [ ] Oracle paths and sha256 (§1.5), incl. the declared changes frozen before any build saw oracle feedback (BG-10); BG-11
      hard-violation maps.
- [ ] Dev-pilot per-task costs and meter units replace the §7 estimates; Opus depth decided per bed.
- [ ] §4 re-run with 20,000 replications at the dev-pilot discordance, ICC, harm rates and cost spread; the analysis script
      reproduces the §4 table within 0.03 on simulated data.
- [ ] Seed blocks registered in `research/jit-20261008/SEED-LEDGER.json` for every generated sealed set (8850–8999 block for
      the factory and V; breadth blocks for WorkBench, NaturalPlan, DABstep).
- [ ] Need router frozen (hash) before any sealed outcome.
- [ ] Decisions OD-1, OD-2, OD-5, OD-13, OD-14 recorded (PLAN §11); OD-4 (K) kept at K = 2 or amended by the owner; OD-11
      (Mercury) answered or F-HM recorded as descriptive.

## Amendments

(dated entries only, after the v1 commit)

## Draft revisions (before any freeze)

**Revision 3, 2026-10-21 (this file), changes from revision 2 (`eebece12`):**
1. Portfolio: ten beds (eight core, two conditional) instead of twelve. PlanBench, ToolHop, τ² simulated-user and DS-1000 left
   the primary pool; SpreadsheetBench V2 replaced SpreadsheetBench-912 as primary; NaturalPlan and SpreadsheetBench became agent
   beds; DABstep-fresh needs two independent solvers; a scouted slot was added; the order now starts WorkBench, AgentDojo,
   AppWorld.
2. Held-out classes relabelled (H1e, H2-ext, H2-own); H1e/H2-ext/H3-only robustness can change the verdict's wording.
3. Arms: every arm has the facade tools, a sandboxed `python` tool, the bed card, the date note and the synthetic identity, under
   one hardened session configuration with an init-event check; A-S at n_eff 60; A-O as 20-task anchors on every bed (full
   depth only through the Opus depth gate); A-HN added on beds 1–3; F-S dropped; F-HM may become the Foundry arm by a declared
   dev rule; per-arm caps from each arm's dev p99; a bed starts sealed only when all arms can interleave; salted task order.
4. Node C pooled over the anchors of every bed; AgentDojo's margin outcome is utility and it is excluded from nodes D and E.
5. Wording gate: "non-inferior"/"matches" need the retention test. Harm guard added (§5.5). Verdict labels name their node and
   effort levels; the envelope and owner-shape coverage line are required.
6. Admission: scouted-bed rule; BG-10 and BG-11; probe battery replaces the gold-action probe, Opus added, ≥ 100 non-sealed
   items; screen-before-build with a 30/60-pair assay rule; portfolio dev gate; Opus depth gate.
7. Splits: salt from the first autosave commit after the rule commit; ≥ 20 AgentDojo injection tasks; τ² cells capped at 3;
   EnterpriseOps-Gym in distractor-tool mode; WorkBench oversamples multi_domain.
8. Stopping: futility look removed; faults re-run until cleared (≤ 3); deadline 2026-11-18.
9. Measurements: CPS as billed and cache-neutral, completeness check, hard violations, sub-goal outcomes, A-HN, reuse streams,
   fault/drift subsets, equal transcript retention across arms; deterministic log-audit reclassification rule.
10. Power re-run for the rev-3 design at dev-informed effects; prior expectation "Inconclusive" stated; caps re-derived.

**Revision 2, 2026-10-21, changes from revision 1 (`6c56ec30`):** Opus xhigh comparator through a claim graph; twelve beds;
CR1 within beds, bootstrap only with ≥ 30 clusters (the Bowyer et al. citation for the bootstrap removed); modified
Hartung-Knapp across beds; assay screen and label; ≥ 100-item memorization probe; pooled fresh-vs-public contrast; log audit;
interim reports at 6 and 9 beds; CPS split into factors; K = 2 kept; F-HM replaced F-M.

## Critique log (for this file; the full log is PLAN §15)

| Source | Point | What changed here | Why |
|---|---|---|---|
| Validity §1a | power quoted at F-H = Sonnet; dev shows −0.02 to −0.05 | §4 table at 0, −0.03, −0.05; prior expectation "Inconclusive"; portfolio dev gate (§1.2.6) | an honest preregistration states the likely verdict and spends accordingly |
| Validity §1b | δ equals the whole frontier premium | wording gate on the retention test (§5.4) | the FDA rule ties the margin to a preserved fraction of the control's effect; no extra runs |
| Validity §1c–e | floor/ceiling mass, shared noise, effort names | state-changing subset; per-arm caps and reporting; timeout-excluded sensitivity; effort named in verdicts | each compresses or hides gaps |
| Validity §2 | comparators without code or card; Opus pool skewed | `python` tool and card for every arm; C over anchors on every bed; A-HN control | otherwise B measures tool access and C is earned on easy beds |
| Validity §3 | C7, AM-9, session parity, interleaving, cost accounting | §2 identity/date/session rules; interleaving rule; §3.2 cache-neutral CPS and completeness | shared-harness artefacts bias every bed alike |
| Validity §4 | contamination direction; probe power; labels | §8.1 rewritten; classes relabelled; robustness with teeth | the anti-conservative routes favour F-H |
| Validity §5 | LLM back doors; gold paths inside environments; oracle freeze; per-bed issues | simulator bed out; deterministic reclassification; equal retention; BG-8 from inside; BG-10; per-bed fixes | — |
| Validity §6 | cards after interim; author-chosen salts; partial beds; seeds; envelope | all cards before the first sealed run; autosave-commit salt; salted task order; 8850–8999; envelope sentence | cross-bed learning and selectable salts are leak routes |
| Validity §7 | drop/demote list | §1.1 | validity before count |
| Cost §2, §3 | 7-day window binds; schedule does not fit | meter rules referenced in §7; deadline 2026-11-18 | the meter, not dollars, stopped every agent today |
| Cost §5 | futility mis-calibrated; probe infeasible; assay noisy; AgentDojo clustering; τ² m | futility removed; non-sealed probe items; 30/60 assay rule; ≥ 20 injections, two-way sensitivity; m ≤ 3 | — |
| Cost §6 | thinner design keeps most power | A-S n_eff 60; anchors everywhere | about $805 less sealed spend than rev 2 for a valid-bed portfolio |
| Vision | off-vision weight; V; hard violations; router; parity; distractors; sub-goals; reuse streams; Mercury; messy intent | V as pool V (own preregistration); harm guard; router; parity; EnterpriseOps-Gym distractor mode; sub-goal outcomes; reuse streams; F-HM rule; verdict owner-shape line | the external pool tests tool-use breadth; V tests the owner's enterprise shapes; neither may borrow the other's label |
| Vision (modified) | hard-violation co-primary at +2 points | guard instead of a co-primary | power ≤ 0.10 at +0.02 and 0.45–0.62 at +0.05 [calc, `plan3/harm_guard.txt`]; most margin outcomes already fail on hard violations |
