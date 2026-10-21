# PREREG-AB-v1 amendment 1 (DRAFT): group-sequential dev comparisons with a co-primary partial-credit metric

**Status: DRAFT, not frozen.** Written 2026-10-21 by an Opus 5.5 subagent in a worktree, for register A4
(`research/compromises-20261021/REGISTER.md`) and action 7 of `research/compromises-20261021/FIXES.md` §2. The
orchestrator freezes it by the checklist in §8; until then it binds nothing. Once frozen it is entry **AM-12** of
[PREREG-AB-v1.md](PREREG-AB-v1.md) §16 and must be in force **before the next paid dev comparison**. Development
evidence only: nothing here is a capability result.

## 0. What the author had seen

- The stored dev60 rows of A0, A1, A1-C and the Sonnet arms (per-task devTrain grades: `runs/a0-dev60*`,
  `runs/a1-dev60*`, `runs/a1c-dev60-dn`, `runs/a0s-dev60-dn`, `runs/a1s-dev60-dn*`), DEV60-A0-A1.md and DEVCHECK.md
  (devCheck aggregates only).
- Task **names** of every recorded run (repo `runs/*/summary.json` and `launch.json`, and the live root
  `/var/tmp/foundry-work/autobench/*`), SPLIT-v1.json and EXPOSURE-20261015.json.
- Not opened: any `results.sealed.jsonl` (devCheck or test), any test-split task text, any assertion.
- The partial-credit metric is proposed **after** it was seen to win on stored rows (Sonnet + A1 vs Sonnet: partial
  credit exact p = 0.0036 against strict McNemar p = 0.077). That is the forking-path risk FIXES A4 names; the remedy
  is to freeze it now, before the next comparison, and to keep strict pass as the headline.

## 1. Scope

Dev-phase comparisons on **devTrain** (§5): any arm against A0, or two arms, on tasks the arms were not developed on.
Unchanged: devCheck (§5: at most 3 looks, aggregates only, G1-G4), the test run (§6), the measurements and analysis
of §9, and the decision rules of §10. This amendment adds no devCheck look and never selects a devCheck task.

## 2. Design

**2.1 Unit.** Paired by task at k = 1, one rollout per task per arm, as in §2. Power is bought with new tasks, not
repeats: at 120 runs per arm, power is 0.70 as 120 tasks × k = 1 against 0.58 as 60 × k = 2 (FIXES A4, reproduced by
the skeptic). k ≥ 2 stays reserved for pass^k claims and the §6.2 K rule.

**2.2 Looks.** A frozen plan (`experiments/autobench/sequential.mjs plan`):

| Look | Tasks | Source | Cumulative | Nominal two-sided level per metric |
|---|---|---|---|---|
| 1 | 60 | the stored dev60 rows (devTrain, `--subset 60 --seed 21`), $0 | 60 | 0.000388 |
| 2 | 60 | 10 per domain from the unexposed devTrain pool, in `sha256('ab-seq-v1:' + task)` order | 120 | 0.0121 |
| 3 | 23 | the rest of that pool (2/1/7/5/1/7 by domain) | 143 | 0.0215 |

- *Unexposed pool* = devTrain (240) minus the forced set (103, §1.2), minus the dev tasks the families agent briefed
  (AM-2; 11 in devTrain), minus look 1, minus every task any recorded run names (8 more). Today: **83 tasks**. The
  numbers above come from the DRAFT plan `SEQUENTIAL-PLAN-v1.DRAFT.json` (plan sha256 `97cc2f8c…`, look list hashes
  `0358b32e…`, `a8c1ed5c…`, `ae2200f3…`).
- **Deviation from FIXES A4 / action 7.** FIXES planned looks 2-3 as two batches of 60 from "137 unexposed dev-train
  tasks". 137 is devTrain minus the forced set; it does not subtract the 37 non-forced dev60 tasks, the AM-2
  briefings or the smoke runs. Only one more full batch of 60 exists; look 3 holds the 23 left. FIXES also said
  "via `run.mjs --subset 60 --seed S`": a seeded stratified subset of devTrain cannot guarantee disjoint, unexposed
  batches, so each look's runs are launched from the plan's explicit task list instead (§2.3).
- **Never devCheck.** SPLIT-v1's devCheck list must hash to §1.1's `74cf7615…25a7`; the plan, every look descriptor,
  `run.mjs --sequential-look` and the analysis each refuse a devCheck task (`assertNoDevCheck`), and `assertDevOnly`
  still refuses test tasks. A sealed run directory is never read.

**2.3 Running a look.** `node experiments/autobench/sequential.mjs look N --plan SEQUENTIAL-PLAN-v1.json -- <arm
options>` writes a look descriptor and prints (or with `--exec` starts) `run.mjs --tasks <look N> --sequential-look
<descriptor> …`. `run.mjs` refuses any other task list and records the look number, plan hash, task hash and the
look's nominal levels in `launch.json` and the summary.

**2.4 Control.** A0's outcomes are stored per look and reused as the control for every later comparison (FIXES A4:
about $2.5 per comparison instead of $5). Look 1's control is an existing dev60 A0 run under the treatment's
conditions (with `--date-note` since AM-9: `a0-dev60-dn`; the CLI version is matched where a run exists, e.g.
`a0-dev60-dn-v306`, and disclosed where not). A0 runs once on looks 2 and 3. The analysis command names each look's
control and treatment runs.

**2.5 Metrics: two co-primary tests, strict pass stays the headline.**
- *Strict pass:* exact two-sided McNemar on the cumulative discordant pairs (as §9.2).
- *Partial credit:* the official `partial_credit`, paired two-sided sign-flip permutation test on the cumulative
  per-task differences: exact over all sign vectors when at most 24 differences are non-zero, otherwise 100,000
  seeded draws (`ab-seq-look<N>`), p = (hits + 1)/(B + 1).
- *Multiplicity:* each metric gets two-sided α = 0.025 (Bonferroni), and each has its own classical O'Brien-Fleming
  boundary over the planned cumulative task counts (§2.2), so the family-wise type-I over both metrics and all looks
  is at most 0.05.

**2.6 Decision at each look** (the first look that decides ends the comparison):
- **Effect:** a metric's p is below its look's nominal level with the treatment ahead, and the difference is at least
  3 points on strict pass or 0.03 mean partial credit (ROADMAP §4.3 floor). The label names the metric(s).
  A statement that the arm raises the **strict pass rate** needs the strict test to cross; a partial-credit crossing
  alone is reported as "effect on partial credit, strict pass not resolved".
- **Harm:** a metric crosses with the control ahead. Reported first.
- **Continue:** neither crosses and a later look exists.
- **Final look, no resolvable difference:** nothing crossed by look 3. This is the expected outcome for small effects
  (§3), declared now.

**2.7 Reported at every look, never deciding.** The Beta-mixture e-value of the strict discordant pairs (anytime
valid; an unplanned look may cite only E ≥ 20); Wilson intervals per arm; paired Bayes intervals for both metrics
(Dirichlet on the 2×2 table for strict pass, Bayesian bootstrap for partial credit), never CLT bars at n < 200.

## 3. Power note: the A1 effect size is in-sample

A1 was developed on the dev60 tasks, so its dev60 effect (+15 points strict with the date note, +0.15 partial credit)
is inflated for any new task, and every power figure below is optimistic for the next, smaller improvement. Simulated
by `sequential.mjs simulate --h1` (tasks resampled from the stored dev60 rows; treatment from the A1 runs, control from
the A0 runs), 20,000 runs, looks at 60/120/143:

| True effect, as a share of the in-sample A1 effect | Power of the co-primary rule | Mean tasks used | Fixed n = 143, same rule |
|---|---|---|---|
| 1 | 0.996 | 111 | 0.997 |
| 2/3 | 0.886 | 125 | – |
| 1/3 (about +5 points strict) | 0.365 | 138 | 0.373 |

The O'Brien-Fleming schedule keeps nearly the fixed-n power while stopping early when the effect is large. A
one-third-size effect is detected about a third of the time inside the 143 available tasks.

## 4. Type-I check (FIXES A4 T2; $0, development evidence)

Under H0 (an A/A comparison: both arms draw each task's outcome from the same pooled stored outcomes; tasks
resampled from dev60; 20,000 runs), `experiments/autobench/test/sequential.test.mjs` T2:

| Look schedule | Co-primary rule | Strict alone at 0.025 | Partial credit alone at 0.025 | Strict alone at 0.05 | Partial credit alone at 0.05 |
|---|---|---|---|---|---|
| 60/120/143 (this plan) | 0.034 | 0.013 | 0.024 | 0.030 | 0.048 |
| 60/120/180/240 (FIXES's 4-look form) | 0.035 | 0.014 | 0.023 | 0.033 | 0.050 |

Both stay at or below 0.05 two-sided. The exact McNemar is conservative; the partial-credit test runs near nominal.
In this simulation the partial-credit test uses its large-sample form (Σd/√Σd²) for speed; the analysis uses the
exact or Monte Carlo permutation p.

**T3, the paid A/A check (the same arm run twice; FIXES A4, about $1), was not run** in this change. A $0 stand-in
exists in stored rows: A0 with the date note on the same 60 dev60 tasks twice, six days apart (`a0-dev60-dn` on CLI
2.1.300, `a0-dev60-dn-v306` on CLI 2.1.306). Read as look 1, and as a single final look at α 0.025 per metric: strict
9 vs 9 (4:4, McNemar p 1.0, e-value 0.41), partial credit -0.033 (permutation p 0.48); nothing crosses
(`experiments/autobench/test/sequential.test.mjs`). The CLI version differs between the two runs, so this is a
near-A/A; the paid T3 on look-2 tasks remains the clean check and should run before the first look-2 comparison is
read, if the budget allows.

## 5. Look 1 on stored rows (illustration, not a new result)

A1 vs A0, date note, dev60: strict 18 vs 9 (12:3, McNemar p 0.035, e-value 4.5), partial credit p 0.006. Neither is
below look 1's nominal 0.000388: under this amendment the decision would be "continue: run look 2". The same rows
read as a single fixed look at α = 0.025 cross on partial credit only. Both readings are from development data the
arm was built on.

## 6. Coordination

- **A1-C v2 (#79)** plans a "paid dev eval on 60 devTrain tasks disjoint from dev60". Run it as **look 2 of this plan**
  (`sequential.mjs look 2`). Any devTrain run on other unexposed tasks before the freeze shrinks the pool: the plan is
  recomputed at freeze and look 3 may vanish.
- `run.mjs` changed (the opt-in `--sequential-look`); without the flag the launch object is unchanged, but the runner
  hash differs, so resuming a run launched on the older runner needs `--accept-runner-change` (recorded in its launch
  history, §7 of PREREG-AB-v1 unaffected: no harness addendum exists yet).

## 7. Cost

A0 on look 2 is about $0.8-0.9 and on look 3 about $0.3 (Haiku, about $0.015 per task); a Haiku treatment arm costs
about the same to 2x per look. Both are inside the §5 dev budget as raised by AM-10.

## 8. Freeze checklist (orchestrator)

1. Re-run `node experiments/autobench/sequential.mjs plan --write research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json`
   after the last devTrain run that is not part of this design, and commit it; record its `planSha256` here.
2. If the plan differs from the DRAFT (`97cc2f8c…`), update §2.2's table and §3/§4 (re-run `sequential.mjs simulate`
   with `--plan`).
3. Change the status line to FROZEN with the date and commit, and add a one-line AM-12 entry to PREREG-AB-v1 §16
   pointing here.
4. Optional, ≤ $1: the T3 A/A check (§4).
