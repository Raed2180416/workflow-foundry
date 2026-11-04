# Harness-faulted GQA-1 runs (kept as raw data, excluded)

PREREG-GQA-1 amendment A1 (2026-11-04). Each of these runs was re-run under the same run id after the amendment.

| Run | Fault | Spend |
|---|---|---|
| gqa1-workflow-r3, r4, r5 | the construct call (the run's only call) failed with `MODEL_RATE_LIMIT` (claude CLI, HTTP 429): no model output | $0 |
| gqa1-workflow-random-r2 | 2 of 3 judge calls failed with `MODEL_RATE_LIMIT`: those batches' candidates were dropped (foundMin 5 on the remaining batch) | $0.0033 |
| gqa1-workflow-random-r3, r4, r5 | runner exception: the paired `workflow` run had no construction to reuse | $0 |

Also lost: `gqa1-monkey-ref-r3` (an empty directory, removed): the 2026-10-28 session's container ended during the run
(the chain log has no end line and the browser was closed under the scorer). It was re-run, $0.
