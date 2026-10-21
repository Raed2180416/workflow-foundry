# PREREG-AB-v1 amendment 1 (DRAFT): group-sequential dev comparisons with a co-primary partial-credit metric

**Status: DRAFT, not frozen.** Written 2026-10-21 by an Opus 5.5 subagent in a worktree, for register A4
(`research/compromises-20261021/REGISTER.md`) and action 7 of `research/compromises-20261021/FIXES.md` §2, and revised
the same day after review (one blocker, two majors; §10). The orchestrator freezes it by the checklist in §9; until then
it binds nothing, and `sequential.mjs look --exec` refuses to start a paid look. Once frozen it is entry **AM-12** of
[PREREG-AB-v1.md](PREREG-AB-v1.md) §16 and must be in force **before the next paid dev comparison**. Development
evidence only: nothing here is a capability result.

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
  is to freeze it now, before the next comparison, and to keep strict pass as the headline.

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
  (AM-2; 11 in devTrain), minus look 1, minus every task any recorded run names (8 more). Today: **83 tasks**. The
  numbers come from the DRAFT plan `SEQUENTIAL-PLAN-v1.DRAFT.json` (plan sha256 `756d7d3a…`, look list hashes
  `0358b32e…`, `a8c1ed5c…`, `ae2200f3…`; the exposure roots it scanned are listed in the file).
- **Per-arm exposure (first look).** An arm developed, tuned or probed on any task of a look starts its statistic at
  the first look after it, on its own O'Brien-Fleming schedule, recomputed for the looks it uses. The plan carries one
  schedule per possible first look:

  | First look | Looks used | Cumulative tasks | Nominal two-sided level per metric |
  |---|---|---|---|
  | 1 | 1, 2, 3 | 60 / 120 / 143 | 0.000388 / 0.0121 / 0.0215 |
  | 2 | 2, 3 | 60 / 83 | 0.00732 / 0.0226 |

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

**2.5 Metrics: two co-primary tests, strict pass stays the headline.**
- *Strict pass:* exact two-sided McNemar on the cumulative discordant pairs (as §9.2).
- *Partial credit:* the official `partial_credit`, paired two-sided sign-flip permutation test on the cumulative
  per-task differences: exact over all sign vectors when at most 24 differences are non-zero, otherwise 100,000
  seeded draws (`ab-seq-look<N>`), p = (hits + 1)/(B + 1).
- *Multiplicity:* each metric gets two-sided α = 0.025 (Bonferroni), and each has its own classical O'Brien-Fleming
  boundary over the arm's schedule (§2.2), so the family-wise type-I over both metrics and all looks is at most 0.05.
  This halves the strict headline's α against FIXES's nominal levels: an owner decision (§7).
- *Never completed:* a task-run without a final grade and without a fault flag scores 0 and is listed per look in the
  analysis output (§6.3). A task-run with a fault flag is not an outcome; the look stays incomplete until it is re-run.

**2.6 Decision at each look** (the arm's first look onward):
- **Effect:** a metric's p is below its look's nominal level with the treatment ahead, and the difference is at least
  3 points on strict pass or 0.03 mean partial credit (ROADMAP §4.3 floor). The label names the metric(s).
  A statement that the arm raises the **strict pass rate** needs the strict test to cross; a partial-credit crossing
  alone is reported as "effect on partial credit, strict pass not resolved".
- **Harm:** a metric crosses with the control ahead. Reported first, and always ends the comparison.
- **Stopping (owner decision, §7).** DRAFT rule `--stop-on either`: the first decisive crossing of either metric ends
  the comparison, so a partial-credit effect can end it before strict pass resolves. Alternative `--stop-on strict`:
  a partial-credit effect is recorded at the look it crossed and the comparison continues until strict pass decides,
  harm crosses, or the last look. The family-wise type-I is the same under both (the error event is "either metric
  crosses at some look").
- **Continue:** nothing decides and a later look exists.
- **Final look, no resolvable difference:** nothing decided by the last look. This is the expected outcome for small
  effects (§3), declared now.

**2.7 Reported at every look, never deciding.** The Beta-mixture e-value of the strict discordant pairs (anytime
valid; an unplanned look may cite only E ≥ 20); Wilson intervals per arm; paired Bayes intervals for both metrics
(Dirichlet on the 2×2 table for strict pass, Bayesian bootstrap for partial credit), never CLT bars at n < 200.

## 3. Power note: the A1 effect size is in-sample

A1 was developed on the dev60 tasks, so its dev60 effect (+15 points strict with the date note, +0.15 partial credit)
is inflated for any new task, and every power figure below is optimistic for the next, smaller improvement. Simulated
by `sequential.mjs simulate --h1` (tasks resampled from the stored dev60 rows; treatment from the A1 runs, control from
the A0 runs), 20,000 runs:

| True effect, as a share of the in-sample A1 effect | From look 2 (60/83): power | Mean tasks | Fixed n = 83, same rule | From look 1 (60/120/143): power | Mean tasks |
|---|---|---|---|---|---|
| 1 | 0.925 | 69 | 0.929 | 0.996 | 111 |
| 2/3 | 0.640 | 77 | – | 0.886 | 125 |
| 1/3 (about +5 points strict) | 0.208 | 82 | 0.214 | 0.365 | 138 |

A dev60-developed arm has 83 new tasks, not 143: a one-third-size effect is detected about a fifth of the time. The
O'Brien-Fleming schedule keeps nearly the fixed-n power while stopping early when the effect is large.

## 4. Type-I check (FIXES A4 T2; $0, development evidence)

Under H0 (an A/A comparison: both arms draw each task's outcome from the same pooled stored outcomes; tasks resampled
from dev60), `experiments/autobench/test/sequential.test.mjs` T2:

| Look schedule | Co-primary rule, normal form (20,000 runs) | Strict alone at 0.025 | Partial credit alone at 0.025 | Co-primary rule, permutation test (3,000 runs) |
|---|---|---|---|---|
| 60/120/143 (from look 1) | 0.033 | 0.014 | 0.022 | 0.036 |
| 60/83 (from look 2) | 0.032 | 0.013 | 0.022 | 0.034 |
| 60/120/180/240 (FIXES's 4-look form) | 0.036 | 0.015 | 0.024 | – |

Every schedule stays at or below 0.05 two-sided. The exact McNemar is conservative; the partial-credit test runs near
nominal. The last column runs the analysis' own partial-credit test (the sign-flip permutation, Besag-Clifford stopped:
a valid permutation p, which tracks the analysis' fixed-B Monte Carlo p), so T2 certifies the rule the analysis applies,
not only its large-sample form.

**T3, the paid A/A check (the same arm run twice; FIXES A4, about $1), was not run.** A $0 stand-in exists in stored
rows: A0 with the date note on the same 60 dev60 tasks twice, six days apart (`a0-dev60-dn` on CLI 2.1.300,
`a0-dev60-dn-v306` on CLI 2.1.306). Read as a single final look at α 0.025 per metric: strict 9 vs 9 (4:4, McNemar
p 1.0, e-value 0.41), partial credit -0.033 (permutation p 0.48); nothing crosses. The CLI version differs between the
two runs, so this is a near-A/A; the paid T3 on look-2 tasks remains the clean check and should run before the first
look-2 comparison is read, if the budget allows (it is A0 on look 2 twice; the first of the two is the stored control).

## 5. Look 1 on stored rows (ILLUSTRATION, not a sequential look)

A1 vs A0, date note, dev60: strict 18 vs 9 (12:3, McNemar p 0.035, e-value 4.5), partial credit p 0.006. Neither is
below look 1's nominal 0.000388. Under this amendment these rows are never a look for A1: A1 was developed on them and
starts at look 2. The same rows read as a single fixed look at α = 0.025 cross on partial credit only. Both readings are
from development data the arm was built on.

## 6. Coordination and merge effects

- **A1-C v2 (#79, #87)** plans a "paid dev eval on 60 devTrain tasks disjoint from dev60". Run it as **look 2 of this
  plan with first look 2**: `sequential.mjs look 2 --role treatment --arm 'A1-C v2' --first-look 2 --exec -- --run-id …`,
  and A0 on look 2 once as `--role control --arm A0`. Any devTrain run on other unexposed tasks before the freeze shrinks
  the pool: the plan is recomputed at freeze and look 3 may vanish (a 1-look schedule from look 2 is then a fixed n = 60
  test at 0.025 per metric).
- **run.mjs is unchanged** (e6a23ca), so §5, §6.1 and §7 of PREREG-AB-v1 are untouched: the a1c-v1 and a1-v1 manifest
  hashes still recompute, and older runs resume without `--accept-runner-change`.
  `experiments/autobench/test/sequential.test.mjs` asserts that every harness-manifest file is byte-identical to e6a23ca.
- Merge effects outside AutomationBench (from the shared stats core, `experiments/lib/stats.mjs`, and its re-export in
  `experiments/jit/stats.mjs`): the need-router label-engine stamp hashes `experiments/jit/stats.mjs` and the
  `experiments/lib` tree (`research/need-router-20261014/prereg/stages.json` `engineStamp.labelEngine`), so a need-router
  stage started before the merge cannot resume after it (`label-run.mjs` ENGINE_CHANGED). On 2026-10-21 no stage holds a
  `STAMP.json`, so none is affected today; merge between stages.

## 7. Owner decisions (departures from FIXES A4 that need sign-off before the freeze)

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
about the same to 2x per look. Both are inside the §5 dev budget as raised by AM-10.

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

## 10. Review record (2026-10-21)

The first draft changed `run.mjs` (a `--sequential-look` flag), which is in both harness manifests (blocker); read
look 1's stored dev60 rows into the statistic of arms developed on them, and could not analyse an arm from look 2
(major); and the review listed weaker plan and exposure checks, silent zero scores, a T2 that simulated only the normal
form and two unflagged departures from FIXES (minors). This revision reverts `run.mjs`, moves the guard and a sidecar
into `sequential.mjs`, adds per-arm first looks with recomputed schedules, recomputes and pins the plan, throws on
unreadable exposure records and scans every worktree, lists never-graded task-runs, runs T2 with the permutation test,
and flags the departures in §7.
