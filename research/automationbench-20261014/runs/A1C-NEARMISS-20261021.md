# A1-C near-miss anatomy (interim, in-sample dev, 2026-10-21)

*Development evidence on devTrain tasks (the dev60 subset, seed 21), read as the developer (PREREG-AB-v1 §5). The A1-C run
`a1c-dev60-dn` was still running (47 of 60 tasks) when this was written; the final table goes in DEV60-A0-A1.md.*

## Numbers on the 47 tasks every arm has finished

| Arm | Strict pass | Mean partial credit | Failed tasks with exactly 1 failed assertion |
|---|---|---|---|
| A0 Haiku (CLI 2.1.306) | 7 | 0.491 | — |
| A1 Haiku | 15 | 0.677 | 10 |
| **A1-C Haiku** | **13** | **0.782** | **13** |
| A0 Sonnet | 16 | 0.676 | — |
| A1 Sonnet | 22 | 0.801 | 8 |

A1-C reaches near Sonnet+A1's partial credit and leaves the most one-assertion misses. Sonnet+A1 passes 7 of A1-C's 13
near-miss tasks.

## Where A1-C's checks go wrong (pipeline records, 49 graded tasks)

| Graded outcome | Termination reason | Tasks |
|---|---|---|
| fail | max repair rounds reached | 18 |
| fail | **all checks pass** (false acceptance) | **15** |
| fail | only advisory checks fail | 3 |
| pass | **max repair rounds reached** (checks failed a correct world) | **9** |
| pass | all checks pass | 3 |
| pass | only advisory checks fail | 1 |

The checks fail in both directions: 15 false acceptances and 9 false rejections. A false rejection spends repair rounds,
and a repair can damage a world that was already correct.

## Two near-misses, read in full

- **finance.project_profitability** (`body_not_contains: Delta`). The CFO's guideline e-mail scopes the report to active
  and completed projects, so a project with another status must be left out. Haiku's ledger (3 items) and a Sonnet
  ledger (1 item, smoke `a1csp-smoke2`) both miss the exclusion. **Generic fix: closed-world scope enumeration.** The
  inventory lists the entity universe; a model node classifies each entity in or out with the rule it applied; code
  checks that the output names every included entity and no excluded one.
- **marketing.customer_story_intake** (`gmail_message_is_read: cs_002`). The selected submission must have been opened. In
  the simulator, as in a real inbox, reading a message by id marks it read; A1-C's inventory only lists messages.
  **Generic fix: read every record a decision rests on, in full, by id, before acting** (verify before act).

## Sonnet as planner (smoke, 2 tasks, `a1csp-smoke2`)

`--node-models ledger,adjudicate,pcmap,checker = claude-sonnet-5-5`, acting on Haiku. Both tasks still fail, with the same
assertions. Cost was $0.13–0.17 per task, above Sonnet alone (about $0.10 per task on dev60), because three Sonnet ledger
readers each read the whole inventory. **On these two tasks the gap is not model strength:** the missing requirements
live in the world (a guideline e-mail) or in convention (open what you act on), not in the request. Not run further.
