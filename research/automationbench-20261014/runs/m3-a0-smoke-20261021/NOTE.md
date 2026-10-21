# m3-a0-smoke-20261021: first Mercury A0 smoke (2 devTrain tasks); its session audit is invalid

- **What ran.** `run.mjs --model mercury-3 --tasks operations.zoom_training_setup,finance.travel_advance_settlement --date-note --cap 1 --budget 0.05 --concurrency 2`,
  executor `src/executors/openai-chat.mjs`, before the token meter existed (session cap then 3M tokens; no run token cap).
- **First attempt (12:01 UTC).** Both sessions stopped at `MODEL_RATE_LIMIT` after 4 responses each (HTTP 429 "input token
  limit exceeded", then "too many requests per minute"). The official `auto-bench` mercury-3 dev60 run was using the same key at
  the time. The fault records are in `results.faults.jsonl`. Tokens of these two sessions, from their transcripts: 29,633 + 12,884
  input, 1,029 + 806 output (44,352 in all).
- **Resume (12:13 UTC).** Both tasks reran to completion (28 and 20 responses; zoom_training_setup passed, travel_advance_settlement
  failed). **The `session` audit in `results.jsonl` is not these sessions'.** run.mjs reused the faulted fork's host directory and
  `copyTranscript` does not overwrite, so the audit read the faulted session's transcript (4 responses) against the rerun's call log.
  The rerun transcripts were deleted with the workdirs, so their token use was not recorded. The bug is fixed in run.mjs (a stale
  transcript is moved to `transcript.prior-<ms>.jsonl` before a rerun; test `token-meter.test.mjs`).
- **Use.** Plumbing evidence only (development/diagnostic). Superseded by `m3-a0-smoke2-20261021`.
