# AutomationBench dev60: raw Haiku (A0) vs Haiku + prose harness (A1), paired (2026-10-15, development evidence)

| | |
|---|---|
| Runs | `runs/a0-dev60/` and `runs/a1-dev60/`: the same 60 devTrain tasks (`--pool devTrain --subset 60 --seed 21`) |
| Model | claude-haiku-5-5, effort high, k = 1 |
| Setup | Official prompt; the 50-response and 49-step caps audited host-side, with 0 cap violations and 0 L5 violations in both runs |
| Date | Both arms ran **before AM-9**, so the session context showed the host date (2026-10-15) and not the world's |

| arm | strict pass | mean partial credit | spend | mean model responses |
|---|---|---|---|---|
| A0 raw | **12/60 = 20.0%** | 0.559 | $0.98 | 13.2 |
| A1 prose harness (a1-v1) | **22/60 = 36.7%** | 0.690 | $1.21 | 13.7 |

Paired outcomes:

| | count |
|---|---|
| both pass | 10 |
| A1 only | **12** |
| A0 only | 2 |
| neither | 36 |

**Exact two-sided McNemar p = 0.013.**

Strict pass by domain:

| domain | A0 | A1 |
|---|---|---|
| sales | 10% | 40% |
| marketing | 10% | 10% |
| operations | 10% | 30% |
| support | 40% | 40% |
| finance | 40% | 70% |
| hr | 10% | 30% |

## Reading

- The discover, ledger, plan, act and verify procedure lifts Haiku on dev tasks: +16.7 points strict at +23% cost.
  - This corrects the 6-task probe (`a1-dev-first6`: 0/6 for both arms).
  - It also corrects FABLE-WHAT-WE-MISS.md's statement that "A1 moved Haiku by 0", which rested on those 6 tasks.
  - Six tasks could not separate the arms.
- Fable's structural point stands: A1's verification is prose run by the acting context. The code-owned A1-C (in build) is the test of whether independence adds on top of this lift.
- **This is development evidence.**
  - These are devTrain tasks, read and diagnosed during development.
  - k = 1.
  - It ran with the leaked host date (AM-9). The --date-note re-runs under AM-9 will show how much of either arm's score the date leak cost.
- No test-split task was touched. The headline comparison needs the frozen harness and the test run (PREREG-AB-v1 §6).
- **Context only, not comparable.** The published public-set figures are 50.3% for Opus 5 at max effort and 34.7% for Sonnet 5 at max effort, on all 600 tasks under the official harness. This run is 60 dev tasks, a different population and different conditions.

## Next (dev only)

1. A0 and A1 re-run on the same 60 tasks with `--date-note` (AM-9), at about $2.20 for both.
2. Sonnet arms A0-S and A1-S on the same 60 (AM-10/11), at about $9 each.
3. A1-C (code-owned) on the same 60, for Haiku and Sonnet, when its build passes review.
4. The AM-10 selection rule picks the configuration that will be frozen for the test run.

## Replication with `--date-note` (AM-9), 2026-10-15

**Runs and settings.**
- Same 60 devTrain tasks (seed 21), same model, budgets and harness, plus the neutral host-date note (AM-9).
- `a0-dev60-dn`: the A0 arm.
- `a1-dev60-dn` + `a1-dev60-dn-fill`: the A1 arm. Three of a1-dev60-dn's records were disk-full or cap-skip non-outcomes;
  they were re-run as the fill. See `a1-dev60-dn/NOTE.md`.
- An earlier partial A0 run was hit by the 11:0x UTC usage limit and set aside. Its rate-limited sessions had been
  scored as fails, so it is not used. The runner now stops on such faults.

| | strict pass | partial credit | cost |
|---|---|---|---|
| A0 (no harness), original | 12/60 (20.0%) | 0.559 | $0.98 |
| A1 (harness), original | 22/60 (36.7%) | 0.690 | $1.21 |
| **A0, date note** | **9/60 (15.0%)** | 0.491 | $0.79 |
| **A1, date note** | **18/60 (30.0%)** | 0.642 | about $0.94 (57 outcome sessions plus the $0.064 fill) |

**Paired A1 against A0.**
- With the date note: A1 alone passes 12 tasks and A0 alone 3. Exact McNemar **p = 0.035**.
- Original: 12 against 2, p = 0.013.

**Run-to-run variation, same arm and task.**
- A0 original vs A0 date note: 6 tasks pass only in the original and 3 only in the date-note run.
- A1 original vs A1 date note: 5 against 1.

**Reading.**
- **The harness lift replicates.** On a second independent run per arm it is +15.0 points strict (+16.7 in the
  original), with the same discordant split (12 tasks lifted, 2–3 lost). Both runs are significant on their own.
  - Pooled over the two runs per arm: A0 21/120 (17.5%), A1 40/120 (33.3%).
- **Both arms scored lower with the date note** (−3 and −4 tasks). That is within the run-to-run variation above (A0
  differs on 9 tasks between two runs with nearly the same setup), so k = 1 cannot attribute it to the note.
- **A single run per task moves about 10–15% of tasks.** Any configuration choice (AM-10) and the frozen test run should
  use k ≥ 2 per task, or a pooled comparison like the one above, not a single run.
- **Still development evidence:** these are devTrain tasks read during development.

**Next.**
- The Sonnet pair (`a0s-dev60-dn`, `a1s-dev60-dn`) is running.
- Then A1-C on the same 60.
- Then the AM-10 rule, read on pooled runs.

## Sonnet pair (AM-10/11), 2026-10-15 and 2026-10-21

**Runs.**
- `a0s-dev60-dn`: Sonnet 5.5, no harness. Complete on CLI 2.1.300.
- `a1s-dev60-dn` + `a1s-dev60-dn-fill`: Sonnet 5.5 with the A1 harness. 45 tasks on CLI 2.1.300 and 15 on 2.1.306;
  see `a1s-dev60-dn/NOTE.md`.
- Same 60 devTrain tasks, the date note, $1.50 per session.

| Arm (date note) | Strict pass | Partial credit | Cost of outcome sessions |
|---|---|---|---|
| Haiku alone | 9/60 (15.0%) | 0.491 | $0.79 |
| Haiku + harness | 18/60 (30.0%) | 0.642 | $0.94 |
| Sonnet alone | 20/60 (33.3%) | 0.649 | $6.03 |
| **Sonnet + harness** | **28/60 (46.7%)** | **0.769** | $6.92 |

**Paired, exact McNemar.**

| Comparison | Tasks only the first passes | Tasks only the second passes | p |
|---|---|---|---|
| Sonnet + harness vs Sonnet alone | 12 | 4 | 0.077 |
| Sonnet + harness vs Haiku + harness | 13 | 3 | 0.021 |
| Sonnet alone vs Haiku + harness | 8 | 6 | 0.79 |

**Reading (development evidence, devTrain tasks, k = 1).**
- **The harness lifts both models by a similar amount.** Haiku +15 points, Sonnet +13 points. The Sonnet lift alone is
  not significant at n = 60 (p = 0.077). The Haiku lift replicated (p = 0.035 and 0.013).
- **Haiku + harness matches Sonnet alone at about one sixth of the cost** ($0.94 against $6.03; 8 against 6 discordant,
  p = 0.79).
- **Sonnet + harness is the best configuration on dev60:** 46.7% strict at about $0.12 per task. Per the AM-10
  selection rule this is the candidate to freeze, subject to A1-C on the same tasks.
- **Not comparable with the leaderboard.** These are public-split devTrain tasks. The official leaderboard is a harder
  private set (Sonnet 5.5 max 44.75%, Gemini 4 Argon 51.29%; `research/benchmarks-20261015/FRONTIER-20261015.md`).

**Next.** The A1-C review (resumed 2026-10-21), then A1-C on dev60 for Haiku and Sonnet with k ≥ 2.
