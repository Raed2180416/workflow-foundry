# M1-R: the 54 M1 one-call timeouts, re-run at a 600 s wall (2026-10-15, dev, diagnostic)

Design: research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §5 row 4.
Script: `experiments/need-router/m1-rerun.mjs`. It uses the same arm definitions, and their hashes are checked against the M1 rows.

## What happened in the runs

- **Attempt 1 is invalid.**
  - It still cut every call at 300 s, because the ModelPort's own 300 s deadline overrode the provider's.
  - Fixed in 29c6c48. The attempt is kept outside the repository (`/var/tmp/foundry-work/need/m1-r-attempt1-portcap300s/`).
- **Attempt 2: four trials hit an environment fault.**
  - Four trials failed with `MODEL_RATE_LIMIT` at 02:09 UTC, when the subscription session limit ran out.
  - These are environment faults, not outcomes. They were set aside (`results.envfaults-ratelimit.jsonl`, outside the repository) and re-run after the limit reset.
- **Spend:** about $7.89 in total ($6.63 + $1.26), under the $25 cap.

## Outcome of the 54 trials

| | n |
|---|---|
| pass | 4 (R1 d3 medium: s383, s390; R6 d5 none: s383, s389) |
| fail with an answer | 34 |
| still MODEL_TIMEOUT at 600 s | 10 |
| MODEL_SCHEMA (no valid answer) | 6 |

- **Labels:** with these rows merged in (`merged.jsonl`), the one-call-solvable count goes from 61/144 to 65/144.
- **Reading:** most of what timed out at 300 s was not one-call-solvable even at 600 s. A timeout at the router's budget was mostly a real failure. It hid four real successes.

## "Jev did not beat size" under both labellings

Jev was asked directly "can one call do it?" (`runs/jev-need/rows.jsonl`). The size rule is: smaller input means one call. Scored on 144 tasks:

| labels | positives | Jev AUROC | size AUROC |
|---|---|---|---|
| m1 (timeouts counted as failures) | 61 | 0.456 | 0.645 |
| m1r (timeouts re-run at 600 s) | 65 | 0.436 | 0.626 |

**The verdict survives the timeout confound.** Asked directly, stock Jev is at or below chance and does not beat a size rule.

For J-NEED-2 under m1r, see `runs/jev-need2/REPORT.md` and `result.json`. Code + Jev scores 0.697 on d3+d5, still in the NR-knn branch. Jev's increment over code is still not above noise.
