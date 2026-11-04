# PREREG-AB-v1 amendment 1: group-sequential dev comparisons, strict pass first, then partial credit in a fixed sequence

**Status: FROZEN 2026-10-21.** Plan `SEQUENTIAL-PLAN-v1.json`, plan sha256
`3cd586bd7994a4a4bd0de00e771568516eeda808dc45b0297575d9a659cd2ea4`, pinned in
`experiments/autobench/sequential.mjs` `FROZEN_PLAN_SHA256`. This is entry **AM-12** of [PREREG-AB-v1.md](PREREG-AB-v1.md) §16
and is in force **before the next paid dev comparison**. Development evidence only: nothing here is a capability result.

History:
- Written as a DRAFT on 2026-10-21 by an Opus 5.5 subagent in a worktree, for register A4
  (`research/compromises-20261021/REGISTER.md`) and action 7 of `research/compromises-20261021/FIXES.md` §2.
- Revised the same day after review (one blocker, two majors; §10).
- Decided by the orchestrator the same day as **D23** (`research/decisions-20261021.md`, under the owner's blanket
  permission): fixed-sequence testing, stopping on strict pass only, and the per-arm first look (§7).
- Frozen the same day by the §9 checklist, by an Opus 5.5 subagent on branch `worktree-wf_630f3979-599-4`. The D23 changes
  are in §2.5–§2.6, §3–§7 and §9, each marked "(D23, 2026-10-21)". The DRAFT text they replace is kept in git history
  (commit `e6bbe1f9`).

## 0. What the author had seen

- The stored dev60 rows of A0, A1, A1-C and the Sonnet arms (per-task devTrain grades: `runs/a0-dev60*`,
  `runs/a1-dev60*`, `runs/a1c-dev60-dn`, `runs/a0s-dev60-dn`, `runs/a1s-dev60-dn*`), DEV60-A0-A1.md and DEVCHECK.md
  (devCheck aggregates only).
- Task **names** of every recorded run (`runs/*/summary.json`, `launch.json` and `sequential-look.json` under the main
  tree, every worktree under `.claude/worktrees/`, and the live root `/var/tmp/foundry-work/autobench/*`), SPLIT-v1.json
  and EXPOSURE-20261015.json.
- Not opened: any `results.sealed.jsonl` (devCheck or test), any test-split task text, any assertion.
- The partial-credit metric is proposed **after** it was seen to win on stored rows (Sonnet + A1 vs Sonnet: partial
  credit exact p = 0.0036 against strict McNemar p = 0.077). That is the forking-path risk FIXES A4 names; the remedy
  is to freeze it now, before the next comparison, and to keep strict pass as the headline. D23 goes further: partial
  credit is now only a gated secondary test (§2.5), so it can no longer produce a claim on its own.
- **Added at the freeze (2026-10-21):** the freezer read nothing new of grades or task content. It read task **names**
  only, from:
  - every live `launch.json` (`/var/tmp/foundry-work/autobench/*`);
  - the task-named directories of every run root, and every git worktree's runs (including
    `/var/tmp/foundry-work/kit-e1`, which has none);
  - A1-C v2's adopted `a1c-v2/HELDOUT-LOOK2.json` and its withdrawn first list `HELDOUT60-A1CV2.json` (in git history at
    `5559247e`), both on branch `worktree-wf_3674d3bc-0a7-12`;
  - the AutomationBench task names in the need-router set `router1/SET.jsonl` (branch `worktree-wf_0f86d12b-ab5-1`),
    extracted by script: no request text was printed or read.
  Also the headers of `A1C-V2-DESIGN.md` §0(b) and `RESULT-ROUTER-1.md`.

## 1. Scope

Dev-phase comparisons on **devTrain** (§5): any arm against A0, or two arms, on tasks the arm was not developed on.
Unchanged: devCheck (§5: at most 3 looks, aggregates only, G1-G4), the test run (§6), the measurements and analysis
of §9, and the decision rules of §10. This amendment adds no devCheck look, never selects a devCheck task, and changes
no file of the A1 or A1-C harness manifest (§2.3).

## 2. Design

**2.1 Unit.** Paired by task at k = 1, one rollout per task per arm, as in §2. Power is bought with new tasks, not
repeats: at 120 runs per arm, power is 0.70 as 120 tasks × k = 1 against 0.58 as 60 × k = 2 (FIXES A4, reproduced by
the skeptic). k ≥ 2 stays reserved for pass^k claims and the §6.2 K rule.

**2.2 Looks and per-arm exposure.** A frozen plan (`experiments/autobench/sequential.mjs plan`) fixes three disjoint task
lists:

| Look | Tasks | Source |
|---|---|---|
| 1 | 60 | the dev60 task list (devTrain, `--subset 60 --seed 21`); the stored dev60 A0 rows are its control ($0) |
| 2 | 60 | 10 per domain from the unexposed devTrain pool, in `sha256('ab-seq-v1:' + task)` order |
| 3 | 23 | the rest of that pool (2/1/7/5/1/7 by domain) |

- *Unexposed pool* = devTrain (240) minus the forced set (103, §1.2), minus the dev tasks the families agent briefed
  (AM-2; 11 in devTrain), minus look 1, minus every task any recorded run names (8 more). At the freeze: **83 tasks**.
  The numbers come from the frozen plan `SEQUENTIAL-PLAN-v1.json` (plan sha256 `3cd586bd…2ea4`). Its look list hashes are
  `0358b32e…` (look 1), `a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f` (look 2) and `ae2200f3…`
  (look 3), unchanged from the DRAFT plan `SEQUENTIAL-PLAN-v1.DRAFT.json` (`756d7d3a…`, kept as the reviewed DRAFT). The
  exposure roots it scanned are listed in the file. Look 2's list and hash are exported to
  [LOOK2-TASKS.json](LOOK2-TASKS.json) (`sequential.mjs export-look 2`).
- **Freeze recheck of exposure (2026-10-21).**
  - The scan now also reads the task-named directories under each run's `prep/`, `w/` and `host/`, which catches a run
    that died before writing `launch.json` or `summary.json`. It also covers every git worktree, not only
    `.claude/worktrees/*`.
  - A separate names-only sweep (every JSON/JSONL file and every task-named directory under `/var/tmp/foundry-work`, and
    the research trees of the main tree and every worktree) finds no look-2 or look-3 task in any run record.
  - The only devTrain tasks outside look 1, the forced set and the AM-2 briefings that any run names are the 8 smoke-run
    tasks the DRAFT already excluded (`a1-smoke-scripted`, `sr-smoke-scripted`).
  - The runs since the DRAFT use exposed tasks only. `a1csp-dev60-38` used 38 dev60 tasks; `m3-a1c-dev60-dn(-fill)` and
    the `m3-*` smokes used dev60 tasks; the devCheck runs used devCheck tasks. None of them shrinks the pool.
  - **The pool is unchanged at 83, and the look lists are identical to the DRAFT's.**
- **Disclosed at the freeze: task names seen outside AutomationBench runs.** Neither item is a run or an arm under this
  plan, so the pool rule (§2.2) does not remove these tasks.
  1. The need-router study ROUTER-1 (branch `worktree-wf_0f86d12b-ab5-1`, unmerged) used the request text of 30
     AutomationBench devTrain tasks as classifier items (source `ab-devtrain`), plus 10 `simple.*` tasks outside the
     split. Eight are in this plan: 5 in look 2 and 3 in look 3. Those 8 were labelled by an agent and classified by Haiku
     and Mercury.
     - No AutomationBench arm uses the need router.
     - Under the per-arm rule below, **an arm that uses the need router, its labels or its thresholds counts as developed
       on those 8 tasks.**
  2. A1-C v2's first build named a held-out list of 60 tasks. The builder chose it without a rule; it was never run and
     is now withdrawn. It overlapped look 2 (42 tasks) and look 3 (18 tasks).
     - A1-C v2's design records that no task content was shown in that build.
     - A1-C v2 adopted look 2 (identical list and hash) as its held-out evaluation.
  3. *Correction of disclosure 2 (dated note, 2026-10-28, under D29 (1); the facts are PREREG-A1CV2-P1 §12.1 on branch
     `worktree-wf_3674d3bc-0a7-12`).* The statement above that no task content was shown in A1-C v2's build is wrong.
     Look-2 content reached A1-C v2's development record in three ways:
     - an anatomy agent's `sed` overrun printed the definition header and opening request sentences of one look-2 task,
       `finance.intercompany_balance_recon`;
     - an overfit-critic agent's aggregates over a 91-task pool that holds all 60 look-2 and all 23 look-3 tasks reached
       the spec's prompt (aggregates only; no per-task value is in the code);
     - the need router's use of five look-2 request texts (disclosure 1): `finance.qb_estimate_conversion`,
       `hr.recognition_nominations`, `sales.calendly_sequential_meetings`, `sales.dependency_chain` and
       `support.helpscout_customer_merge` (D25).

     That exposes 6 look-2 tasks by content (1 + 5); looks 2 and 3 are also exposed through the critic's aggregates.
     D29 (1) keeps first look 2 for every A1-C arm, as frozen. PREREG-A1CV2-P1 §9.5 preregisters a sensitivity analysis
     without those 6 tasks, read beside the confirmatory test. The plan, its hash and its look lists do not change.
- **Per-arm exposure (first look).** An arm developed, tuned or probed on any task of a look starts its statistic at
  the first look after it, on its own O'Brien-Fleming schedule, recomputed for the looks it uses. The plan carries one
  schedule per possible first look. Each metric has its own boundary at two-sided α 0.05 (D23, §2.5), so both metrics
  have the same nominal levels:

  | First look | Looks used | Cumulative tasks | Nominal two-sided level, strict pass and partial credit (each at α 0.05) |
  |---|---|---|---|
  | 1 | 1, 2, 3 | 60 / 120 / 143 | 0.00173 / 0.0267 / 0.0424 |
  | 2 | 2, 3 | 60 / 83 | 0.0180 / 0.0443 |
  | 3 | 3 | 23 | 0.0500 (a single look) |

  The DRAFT's levels (α 0.025 per metric, Bonferroni) were 0.000388 / 0.0121 / 0.0215 and 0.00732 / 0.0226. A plan with
  those levels is now refused (`readPlan`).

  **Declared now:** A1, A1-C, A1-C v2 and every variant of them (Sonnet, Mercury, any node-model mix) were developed or
  probed on dev60 (B4; §3, §5), so each **starts at look 2**. First look 1 is for an arm with no dev60 exposure, and
  its look-1 treatment rows must come from a run launched under the plan; stored dev60 treatment rows are in-sample and
  are read only as an illustration (`analyze --illustration`). An arm's first look is written into the sidecar of each
  of its look runs before the run starts (§2.3), and `analyze --first-look F` refuses rows whose sidecar declares
  another.
- **Deviation from FIXES A4 / action 7.**
  - FIXES planned looks 2-3 as two batches of 60 from "137 unexposed dev-train tasks". 137 is devTrain minus the forced
    set; it does not subtract the 37 non-forced dev60 tasks, the AM-2 briefings or the smoke runs. Only one more full
    batch of 60 exists; look 3 holds the 23 left.
  - FIXES said look 1 is "the stored dev60 rows ($0)" for the comparison. Every arm with stored dev60 rows was
    developed on dev60, so for its treatment those rows are in-sample (type-I, not only power, is affected). Look 1's
    $0 part is now the control only; dev60-developed arms start at look 2.
  - FIXES said "via `run.mjs --subset 60 --seed S`": a seeded stratified subset of devTrain cannot guarantee disjoint,
    unexposed batches, so each look's runs are launched from the plan's explicit task list (§2.3).
- **Never devCheck.** SPLIT-v1's devCheck list must hash to §1.1's `74cf7615…25a7`; the plan, every look run and the
  analysis each refuse a devCheck task (`assertNoDevCheck`), and `assertDevOnly` refuses test tasks in every look run
  whatever run.mjs flags are passed. A sealed run directory is never read.

**2.3 Running a look.** `run.mjs` is **not changed**: it is in both the A1 and the A1-C harness manifests
(`harness/foundry.mjs` and `harness/codeowned.mjs` `manifestFiles()`), so any byte change would stop the
devCheck-evaluated a1c-v1 and the a1-v1 candidate from recomputing their frozen hash (§5, §6.1). The guard lives in
`experiments/autobench/sequential.mjs`:

    node experiments/autobench/sequential.mjs look N --plan SEQUENTIAL-PLAN-v1.json --role treatment --arm NAME \
         --first-look F --exec -- --run-id ID <run.mjs arm options>

- It refuses a DRAFT plan (the frozen plan's hash is pinned in `FROZEN_PLAN_SHA256`), a task selection (`--tasks`,
  `--pool`, `--subset`, `--seed`, `--domains`), `--test-run`, `--no-copy` and `--dry-run`, and requires `--run-id`.
- It checks look N's task list (never devCheck, dev only, the plan's list and hash), then writes a
  `sequential-look.json` sidecar (plan hash, look, task hash, role, arm, declared first look, nominal levels, run.mjs and
  sequential.mjs hashes, the run options) into the run's live directory and its repo copy, and only then starts
  `run.mjs --tasks <look N> …`. A resume (`-- --resume`) must find the same sidecar; a fill of faulted tasks is a resume
  of the same run, not a new run. After the run, the repo copy's tasks must be look N's.
- `analyze` refuses any look-run directory without a matching sidecar, except the stored dev60 A0 rows as look 1's
  control, and any directory holding a task outside its look.

**2.4 Control.** A0's outcomes are stored per look and reused as the control for every later comparison (FIXES A4:
about $2.5 per comparison instead of $5). Look 1's control is an existing dev60 A0 run under the treatment's
conditions (with `--date-note` since AM-9: `a0-dev60-dn`; the CLI version is matched where a run exists, e.g.
`a0-dev60-dn-v306`, and disclosed where not). A0 runs once on looks 2 and 3 (`look N --role control --arm A0`). The
analysis command names each look's control and treatment runs.

**2.5 Metrics and multiplicity (D23, 2026-10-21): strict pass first, partial credit only after it.**
- *Strict pass* (hypothesis H_S, the headline): exact two-sided McNemar on the cumulative discordant pairs (as §9.2),
  at two-sided α 0.05, with its own classical O'Brien-Fleming boundary over the arm's schedule (§2.2).
- *Partial credit* (H_PC, secondary):
  - The test: the official `partial_credit`, paired two-sided sign-flip permutation test on the cumulative per-task
    differences. It is exact over all sign vectors when at most 24 differences are non-zero; otherwise it uses 100,000
    seeded draws (`ab-seq-look<N>`) with p = (hits + 1)/(B + 1).
  - Its level: two-sided α 0.05, with its own O'Brien-Fleming boundary over the same schedule.
  - **The gate: H_PC is tested only at a look where H_S is rejected** (fixed-sequence testing, option (c) of §7).
- *Why the family-wise error stays at 0.05 (closed testing), over both metrics and every look:*
  - If H_S is true, any rejection requires H_S to be rejected first, so the probability is at most P(reject H_S) ≤ 0.05.
  - If H_S is false and H_PC is true, H_PC is rejected only where it crosses its own α-level group-sequential boundary,
    so the probability is at most 0.05.
  - H_PC needs a group-sequential boundary of its own. Testing it at the nominal 0.05 at the look where H_S stops does
    **not** keep the family-wise error:
    - Hung, Wang & O'Neill 2007.
    - Glimm, Maurer & Bretz 2010, *Statistics in Medicine* 29:219–228.
    - Tamhane, Mehta & Liu 2010, *Biometrics* 66(4):1174–1184.
    - Tamhane et al. 2018, *Biometrics* 74(1):40–48, extend the result to more than two looks.
  - Provenance of the citations: bibliographic details and the summaries of the claim were checked by web search on
    2026-10-21 (IDEAS/RePEc listings and a CRAN reference list). The full texts were not read. The venue of Hung et al.
    (*Journal of Biopharmaceutical Statistics* 17) is from memory and was not re-checked.
  - Both halves of the argument are checked by simulation on the stored outcomes (§4).
- *The boundary shape for H_PC is fixed now:* O'Brien-Fleming, the same as H_S. Other α-level group-sequential shapes
  are also valid; the choice is not revisited after any data.
- *Against the DRAFT:* strict pass gets the full α instead of 0.025, so on 60/83 its levels are 0.0180 / 0.0443 instead
  of 0.0073 / 0.0226. Partial credit can no longer produce a claim without strict pass (§3 quantifies both effects).
- *Never completed:* a task-run without a final grade and without a fault flag scores 0 and is listed per look in the
  analysis output (§6.3). A task-run with a fault flag is not an outcome; the look stays incomplete until it is re-run.

**2.6 Decision at each look (D23, 2026-10-21)**, from the arm's first look on (`sequential.mjs lookRule`, which the
analysis and the simulation share):
- **Effect on strict pass:** strict pass is rejected with the treatment ahead. That needs the McNemar p below the look's
  nominal level and a difference of at least 3 points (ROADMAP §4.3 floor).
  - The comparison ends, and a statement that the arm raises the **strict pass rate** is allowed.
  - Partial credit is then tested once, at that look, on the cumulative rows. It is rejected if its p is below its own
    nominal level at that look and the mean difference is at least 0.03.
  - A partial-credit claim needs that rejection, with the treatment ahead.
- **Harm on strict pass:** strict pass is rejected with the control ahead. Reported first; it ends the comparison.
  Partial credit is tested as above and reported.
- **Partial credit alone never decides and never ends a comparison** (D23 (2)).
  - At a look where strict pass is not rejected, partial credit is not tested.
  - If its p is below its boundary anyway, in either direction, the analysis prints it as "beyond the boundary, NOT
    TESTED". That line is descriptive and is flagged for review, but it ends nothing.
  - `analyze --stop-on either` (the DRAFT's rule) is refused; `analyzeLooks` refuses `stopOn: 'either'`.
- **Continue:** strict pass is not rejected and a later look exists.
- **Final look, no resolvable difference on strict pass:** nothing was rejected by the last look, and partial credit was
  not tested. This is the expected outcome for small effects (§3), declared now.

**2.7 Reported at every look, never deciding.**
- The Beta-mixture e-value of the strict discordant pairs. It is anytime valid; an unplanned look may cite only E ≥ 20.
- Wilson intervals per arm.
- Paired Bayes intervals for both metrics: Dirichlet on the 2×2 table for strict pass, Bayesian bootstrap for partial
  credit. Never CLT bars at n < 200.
- The partial-credit p at every look, marked "(gated)" at a look where it is not tested (§2.6).

## 3. Power note: the A1 effect size is in-sample

A1 was developed on the dev60 tasks, so its dev60 effect (+15 points strict with the date note, +0.15 partial credit)
is inflated for any new task, and every power figure below is optimistic for the next, smaller improvement.

**Re-simulated under D23 (2026-10-21).**
- Method: `sequential.mjs simulate --plan SEQUENTIAL-PLAN-v1.json --first-look F --h1 --h1-scale s`. Tasks are resampled
  from the stored dev60 rows; the treatment draws from the A1 runs with probability s and otherwise from A0; the
  control draws from A0.
- Decisions use `lookRule`, the analysis' own rule, including the 3-point floor.
- Normal form: 20,000 runs. The analysis' permutation test: 3,000 runs.
- *Strict claim:* strict pass is rejected with the treatment ahead. *Both:* partial credit is also rejected through the
  gate.

| True effect, as a share of the in-sample A1 effect | From look 2 (60/83): strict claim, normal / permutation | Both, normal / permutation | Mean tasks | Fixed n = 83, same rule: strict claim (both) | From look 1 (60/120/143): strict claim (both) | Mean tasks | DRAFT rule from look 2: strict at 0.025 / either metric |
|---|---|---|---|---|---|---|---|
| 1 | **0.817** / 0.824 | 0.718 / 0.732 | 72 | 0.831 (0.800) | 0.972 (0.888) | 112 | 0.734 / 0.925 |
| 2/3 | **0.521** / 0.530 | 0.361 / 0.380 | 78 | 0.540 (0.432) | 0.799 (0.645) | 126 | 0.426 / 0.637 |
| 1/3 (about +5 points strict) | **0.174** / 0.161 | 0.073 / 0.074 | 82 | 0.172 (0.090) | 0.324 (0.161) | 138 | 0.116 / 0.211 |

- **What D23 changed.**
  - The chance of a strict-pass claim, the owner's headline, rises by 6 to 10 points against the DRAFT's 0.025 strict
    test (from look 2: 0.734 → 0.817, 0.426 → 0.521, 0.116 → 0.174).
  - The chance that a comparison ends with *any* claim falls (0.925 → 0.817 at the full in-sample effect). Partial
    credit, the more sensitive metric, can no longer win alone; it follows strict pass only.
  - The DRAFT's "either" column is recomputed with the floor and the direction, and it reproduces the DRAFT's table
    (0.925 / 0.640 / 0.208).
- A dev60-developed arm has 83 new tasks, not 143. A one-third-size effect (about +5 points strict) gets a strict claim
  about one time in six.
- The O'Brien-Fleming schedule keeps nearly the fixed-n power while stopping early when the effect is large.
- The permutation column agrees with the normal form within Monte Carlo error (SE about 0.009 at 3,000 runs).

## 4. Type-I check (FIXES A4 T2; $0, development evidence)

**Re-simulated under D23 (2026-10-21).**
- Under H0, an A/A comparison: both arms draw each task's outcome from the same pooled stored outcomes, and tasks are
  resampled from dev60.
- Command: `sequential.mjs simulate --plan SEQUENTIAL-PLAN-v1.json --first-look F [--pc-test permutation]`, with decisions
  by `lookRule`, the analysis' own rule. Commit `7c501a4a`, 20,000 runs per cell.
- The permutation form runs the analysis' own sign-flip test, stopped by Besag-Clifford (h 20 unless stated).
- `experiments/autobench/test/sequential.test.mjs` T2 asserts the same properties at fewer runs.

| Look schedule | Family-wise error: normal form / permutation | Partial credit rejected through the gate: normal / permutation | Partial credit alone at its own 0.05 boundary, ungated: normal / permutation h 20 / permutation h 200 (paired with h 20) | The DRAFT rule (either metric at 0.025 each): normal / permutation |
|---|---|---|---|---|
| 60/83 (from look 2: every current arm) | **0.026** / 0.025 | 0.0062 / 0.0066 | 0.047 / 0.051 / 0.051 | 0.033 / 0.035 |
| 60/120/143 (from look 1) | **0.032** / 0.030 | 0.0075 / 0.0076 | 0.049 / 0.052 / 0.052 | 0.035 / 0.037 |
| 60/120/180/240 (FIXES's 4-look form) | **0.034** / – | 0.0079 / – | 0.050 / – / – | 0.036 / – |

- **Family-wise error.** Under H0 it equals strict pass's own (0.025–0.034): every rejection starts with strict pass, and
  T2 asserts the equality. The exact McNemar is conservative. Partial credit is rejected through the gate 0.6–0.8% of the
  time.
- **The ungated column is the other half of the closed-testing argument.** It covers the partial null, where strict pass
  truly differs and partial credit does not.
  - The normal form holds 0.05 (0.047–0.050).
  - The analysis' permutation test runs at 0.051 on 60/83 and 0.052 on 60/120/143 (MC SE 0.0015 each).
  - Raw estimates, kept:
    - 60/83: 0.0498 (20,000 runs, before `7c501a4a`); 0.0522 (h 20) and 0.0505 (h 200) in a scratch per-look
      diagnostic, 20,000 each; 0.0508 (h 20) and 0.0511 (h 200), paired, above.
    - 60/120/143: 0.0557 (10,000 runs, before `7c501a4a`); 0.0537 (T2, 3,000); 0.0520 (h 20) and 0.0503 (h 200) in the
      scratch diagnostic; 0.0520 (h 20) and 0.0517 (h 200), paired, above.
  - Pooled over the independent runs: **about 0.051 ± 0.001 on 60/83**, within simulation error of 0.05, and **about
    0.052 ± 0.001 on 60/120/143**, about 0.002 above it.
- **Diagnosis of that excess.**
  - It is not the simulation's Monte Carlo p: paired runs at h 20 and h 200 agree (0.0520 against 0.0517).
  - It is not an invalid p at a single look: at n = 60 over 200,000 runs, P(p < c) is 0.0018 / 0.0183 / 0.0450 /
    0.0505 at c = 0.00173 / 0.018 / 0.0443 / 0.05 (h 200), within about 1.5 SE of nominal.
  - It comes from the boundary: its nominal levels come from normal theory, and the exact sign-flip statistic (discrete,
    with a mean of 22.6 non-zero differences at n = 60) spends its level differently across looks. The normal form, for
    example, crosses look 1 at 0.0006 against a nominal 0.0017, and the exact test at 0.0015–0.0018.
- **Consequence, declared now.**
  - On the 60/83 schedule that every current arm uses, the procedure holds 0.05 within simulation error.
  - On 60/120/143 (an arm with no dev60 exposure; none is declared), the worst case for partial credit is about 0.052.
    That case is reachable only in the partial null, and there a partial-credit rejection also needs a strict-pass
    rejection first.
  - It is recorded as a known approximation; nothing is re-tuned after the fact.

**T3, the paid A/A check (the same arm run twice; FIXES A4, about $1), was not run.** A $0 stand-in exists in stored
rows: A0 with the date note on the same 60 dev60 tasks twice, six days apart (`a0-dev60-dn` on CLI 2.1.300,
`a0-dev60-dn-v306` on CLI 2.1.306). Read as a single final look at α 0.025 per metric (the DRAFT): strict 9 vs 9 (4:4,
McNemar p 1.0, e-value 0.41), partial credit -0.033 (permutation p 0.48); nothing crosses. Read under D23 (one look
at α 0.05): strict pass is not rejected, so partial credit is not tested (p 0.48, descriptive). The CLI version differs
between the two runs, so this is a near-A/A; the paid T3 on look-2 tasks remains the clean check and should run before
the first look-2 comparison is read, if the budget allows (it is A0 on look 2 twice; the first of the two is the stored
control).

## 5. Look 1 on stored rows (ILLUSTRATION, not a sequential look)

A1 vs A0, date note, dev60: strict 18 vs 9 (12:3, McNemar p 0.035, e-value 4.5), partial credit p 0.006.
- Under this amendment these rows are never a look for A1: A1 was developed on them and starts at look 2.
- *Read under D23 (2026-10-21):*
  - Against look 1's nominal 0.00173 (first look 1), strict pass is not rejected and partial credit is not tested.
  - Read as a single fixed look at α 0.05, strict pass is rejected (p 0.035, +15 points). That opens partial credit,
    which is rejected too (p 0.006).
- *The DRAFT's readings, for the record:* against 0.000388 nothing crossed; as a single fixed look at 0.025 per metric,
  partial credit alone crossed.
- Every reading is from development data the arm was built on: an illustration of the rule, never a result.

## 6. Coordination and merge effects

- **A1-C v2 (#79, #87)** plans a "paid dev eval on 60 devTrain tasks disjoint from dev60". Run it as **look 2 of this
  plan with first look 2**: `sequential.mjs look 2 --role treatment --arm 'A1-C v2' --first-look 2 --exec -- --run-id …`,
  and A0 on look 2 once as `--role control --arm A0`. (DRAFT note, now moot: any devTrain run on other unexposed tasks
  before the freeze would have shrunk the pool. None ran, and the frozen look lists equal the DRAFT's; §2.2.)
- **Coordination decided in D23 (2026-10-21).**
  - A1-C v2's held-out evaluation runs on **look 2's task list**: [LOOK2-TASKS.json](LOOK2-TASKS.json), 60 tasks, 10 per
    domain, list sha256 `a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f`. It is the same list A1-C v2
    adopted as `a1c-v2/HELDOUT-LOOK2.json` on branch `worktree-wf_3674d3bc-0a7-12`.
  - **A0 is the look-2 control.**
  - **A1-C v2 against A0 is this plan's confirmatory test** at look 2's boundary (first look 2): strict pass at 0.0180,
    then partial credit at 0.0180 only if strict pass is rejected. If nothing is rejected, look 3 (23 tasks; cumulative
    83) follows at 0.0443.
  - **A1-C v2 against A1-C v1** (exact McNemar on look 2) is reported beside it and spends none of this plan's α. A1-C v1
    (`A1-C`) was developed on dev60, so its own look-2 rows also have first look 2.
  - Every look run must start through `sequential.mjs look 2 --exec`, using the code of this frozen plan, so that it
    carries the `sequential-look.json` sidecar. A run started with `run.mjs --tasks …` directly has no sidecar, and
    `analyze` reads it only as `--illustration`.
  - **Reference arms on look 2 (dated note, 2026-10-28).** Two arms ran on look 2's 60 tasks after the freeze. Neither
    is a control or a treatment of this plan, and neither enters the confirmatory test, which stays A1-C v2 against A0
    at look 2's boundary (D23, D25):
    - `a0o-look2-1`: Opus 5.5 at effort xhigh alone (A0, no harness), under D26. The orchestrator launched it from the
      main tree; it finished on 2026-10-22 at 02:38Z.
    - `a1s-look2`: Sonnet 5.5 + A1 (foundry a1-v1), the VL-1 fork, under D27 and PREREG-VL1 §3. It was launched from the
      a1c-v1 pin and finished on 2026-10-22 at 03:34Z.

    *Their sidecars.* Both were started with `run.mjs` directly, so neither had a sidecar.
    - On 2026-10-28, `sequential.mjs record-reference` wrote a `sequential-look.json` into each live directory
      (`/var/tmp/foundry-work/autobench/<id>/`). Each sidecar records role `reference`, plan `3cd586bd…`, look 2, list
      hash `a8c1ed5c…` and first look 2. It is marked `confirmatory: false`, carries no nominal levels, and has a
      `retroactive` record naming the decision. The repo copy `runs/a0o-look2-1` has no sidecar.
    - `analyze` refuses a reference run as either side: the role does not match, and `verifyLookRuns` refuses a
      reference side outright.

    *Exposure.* A run of this plan's own looks is not prior exposure.
    - The rule: the scan (`seenTasks` given the frozen plan) treats two kinds of run as planned look runs, not exposure:
      a run whose sidecar matches the plan (control, treatment or reference), and a copy of one without a sidecar (same
      run id, the look's list). `plan` applies this by default since 2026-10-28; `--planned none` restores the old count.
    - The check: re-deriving the plan from the live record on 2026-10-28 gives the frozen looks (pool 83; 60 / 60 / 23).
    - Without it, the two reference runs counted as exposure and moved look 3's 23 tasks into look 2. That failed five
      tests of `sequential.test.mjs` after the merge.
    - The tests no longer read the live record. They read the frozen plan file and a committed snapshot of the exposure
      record at the freeze (`experiments/autobench/test/fixtures/exposure-at-freeze-3cd586bd.json`). The snapshot was
      reconstructed from task names only, and it recomputes plan `3cd586bd…` byte for byte.

    *The per-arm rule (§2.2) still applies.* An arm developed, tuned or probed with these runs' transcripts, worlds or
    results counts as developed on look 2, so its first look is 3. PREREG-A1CV2-P1 §12.2 records two slips in A1-C v2's
    build: three per-task results and the aggregate of `a0o-look2-1` were printed, after v2's last behavioural edit.
  - **Merge order:** this branch also changes `experiments/agentv/run.mjs` (the B7 banner), which PREREG-OT0-AMEND-1
    pins. Merge it after the OT-0 re-run.
- **run.mjs is unchanged** (e6a23ca), so §5, §6.1 and §7 of PREREG-AB-v1 are untouched: the a1c-v1 and a1-v1 manifest
  hashes still recompute, and older runs resume without `--accept-runner-change`.
  `experiments/autobench/test/sequential.test.mjs` asserts that every harness-manifest file is byte-identical to e6a23ca.
  *Dated note (2026-10-28):*
  - `experiments/autobench/bridge.py`, a manifest file, changed at `2f02281`. The change is `pin_timezone`: the serve
    time zone comes from a row's `info.tz`, which no official task carries. It is recorded in PREREG-VL1 (the arms table)
    and `research/mercury-20261021/A1C-MERCURY-PARTIAL.md`.
  - The A1 and A1-C arms run from the pinned checkout: tag `a1c-v1-look2` on `a1c-v1` (`aada200`). There, every manifest
    file is still e6a23ca's.
  - The test now asserts three things:
    - `run.mjs` is e6a23ca's;
    - every other manifest file is e6a23ca's or carries exactly the bytes of a recorded change (only `bridge.py` at
      `2f02281`: `285be4f5…` before, `caf3ddd6…` after);
    - every manifest file is e6a23ca's at the pin, and in its checkout when present.
- Merge effects outside AutomationBench (from the shared stats core, `experiments/lib/stats.mjs`, and its re-export in
  `experiments/jit/stats.mjs`): the need-router label-engine stamp hashes `experiments/jit/stats.mjs` and the
  `experiments/lib` tree (`research/need-router-20261014/prereg/stages.json` `engineStamp.labelEngine`), so a need-router
  stage started before the merge cannot resume after it (`label-run.mjs` ENGINE_CHANGED). On 2026-10-21 no stage holds a
  `STAMP.json`, so none is affected today; merge between stages.

## 7. Owner decisions (departures from FIXES A4 that needed sign-off before the freeze)

**Decided 2026-10-21 by the orchestrator as D23** (`research/decisions-20261021.md`, under the owner's blanket
permission; reversible by the owner):
- **(1) Fixed-sequence testing, option (c).** Strict pass is tested first at the full α 0.05, with its own
  group-sequential boundaries. Partial credit is tested at 0.05, with its own boundaries, only if strict pass crosses.
  The family-wise error stays at 0.05 without halving the strict test (§2.5).
- **(2) Stopping on strict pass only.** A comparison never ends on partial credit alone (§2.6).
- **(3) The per-arm first look is accepted.** A1, A1-C, A1-C v2 and their variants start at look 2 (§2.2).
- *Why:* the owner's headline is the strict pass rate ("pass rate still too low"); the fixed sequence spends the full α
  on it, and partial credit stays a secondary signal.

The options as the DRAFT put them, kept as the record:

1. **Bonferroni split.** α 0.025 per metric halves the strict headline's α against FIXES's nominal levels: on the 60/83
   schedule strict pass alone at 0.05 would have nominal levels 0.0180 / 0.0443, against 0.0073 / 0.0226 at 0.025 (on
   60/120/143: 0.0017 / 0.0267 / 0.0424 against 0.00039 / 0.0121 / 0.0215).
   Alternatives: (a) keep the split (the DRAFT); (b) strict pass at the full 0.05 as the only confirmatory test, with
   partial credit reported beside it at no α (exploratory); (c) a fixed-sequence test (strict at 0.05 first, partial
   credit at 0.05 only if strict crosses), which keeps the family-wise 0.05 without halving strict.
2. **Stopping on partial credit alone** (§2.6): `either` (the DRAFT) or `strict`.
3. **Per-arm first look** (§2.2): dev60-developed arms start at look 2. This replaces FIXES's "look 1 = stored dev60
   rows" for those arms and is the review's fix for an in-sample look 1.

## 8. Cost

A0 on look 2 is about $0.8-0.9 and on look 3 about $0.3 (Haiku, about $0.015 per task); a Haiku treatment arm costs
about the same to 2x per look. Both are inside the §5 dev budget as raised by AM-10. The A1-C v2 held-out evaluation and
its A0 control also fall under D22's +$40 for non-frontier dev arms (`research/decisions-20261021.md`).

## 9. Freeze checklist (orchestrator)

1. Decide §7 (1)-(3) and record the decisions here.
2. Re-run `node experiments/autobench/sequential.mjs plan --freeze --write research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json`
   after the last devTrain run that is not part of this design; set `FROZEN_PLAN_SHA256` in
   `experiments/autobench/sequential.mjs` to the printed hash, and commit both; record the hash here.
3. If the plan differs from the DRAFT (`756d7d3a…`), update §2.2's tables and §3/§4 (`sequential.mjs simulate --plan …
   --first-look F [--h1 --h1-scale s] [--pc-test permutation]`).
4. Change the status line to FROZEN with the date and commit, and add a one-line AM-12 entry to PREREG-AB-v1 §16
   pointing here.
5. Optional, ≤ $1: the T3 A/A check (§4).

**Done 2026-10-21** (Opus 5.5 subagent, branch `worktree-wf_630f3979-599-4`):
1. The decisions are recorded in §7 (D23) and implemented in `sequential.mjs`:
   - each metric at α 0.05 with its own O'Brien-Fleming boundary (`ALPHA`, `boundariesFor`);
   - the fixed sequence and the stop on strict pass, in `lookRule`, which `analyzeLooks` and `simulateSchedule` share;
   - `PROCEDURE` and `ALPHA` are written into the plan and checked by `readPlan`;
   - `--stop-on either` is refused.

   Tests with teeth in `experiments/autobench/test/sequential.test.mjs`:
   - "boundaries (D23)", "gatekeeping order (D23)" and "stopping (D23)" each fail on the DRAFT code (`e6bbe1f9`) on
     behaviour: the strict test spends 0.025, the look-2 level is 0.0073, and the DRAFT stops on partial credit alone;
   - T2 and "power" are rewritten for the fixed sequence.
2. `plan --freeze --write research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json` was run after the exposure recheck
   (§2.2). Plan sha256 `3cd586bd7994a4a4bd0de00e771568516eeda808dc45b0297575d9a659cd2ea4` is pinned in
   `FROZEN_PLAN_SHA256`. The file itself has sha256 `56e8d3cf5f19ebf7268d49fed99d9ae85afb3c031b873979df02777aa53dc261`.
3. The plan differs from the DRAFT (`756d7d3a…`) only in its levels, its `alpha`/`procedure` fields, the schema
   (`sequential-plan/v3`) and the exposure roots it lists. The pool (83) and the three look lists are identical.
   §2.2's tables and §3–§5 are updated.
4. The status line is FROZEN; AM-12 is added to PREREG-AB-v1 §16. Look 2 is exported to `LOOK2-TASKS.json`.
5. T3 was not run. It remains optional and should run before the first look-2 comparison is read, if the budget allows.

Commits on `worktree-wf_630f3979-599-4` (not pushed):
- `68fa1245`: the D23 implementation; it computed the frozen plan, and `plan --freeze` reproduces the same hash.
- `7c501a4a`: the simulation's own sign-flip stream and `--bc-h`/`--bc-max`.
- The freeze commit: pin, plan, `LOOK2-TASKS.json`, this amendment, AM-12.

The normal-form simulations reproduce byte for byte on the committed code.

## 10. Review record (2026-10-21)

The first draft changed `run.mjs` (a `--sequential-look` flag), which is in both harness manifests (blocker); read
look 1's stored dev60 rows into the statistic of arms developed on them, and could not analyse an arm from look 2
(major); and the review listed weaker plan and exposure checks, silent zero scores, a T2 that simulated only the normal
form and two unflagged departures from FIXES (minors). This revision reverts `run.mjs`, moves the guard and a sidecar
into `sequential.mjs`, adds per-arm first looks with recomputed schedules, recomputes and pins the plan, throws on
unreadable exposure records and scans every worktree, lists never-graded task-runs, runs T2 with the permutation test,
and flags the departures in §7.

Freeze (2026-10-21):
- D23 was implemented and the plan frozen (§9).
- The exposure scan was widened to task-named run directories and to git worktrees outside `.claude/worktrees`. It
  changed nothing in the pool.
- The two disclosures of §2.2 were added: ROUTER-1's use of 8 planned tasks' request text, and A1-C v2's withdrawn list.
