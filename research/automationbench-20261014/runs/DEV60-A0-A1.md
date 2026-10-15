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
