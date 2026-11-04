# a0o-look2-1: Opus 5.5 xhigh alone on the 60 look-2 tasks (D26 reference arm), 2026-10-22

- **What ran.** `experiments/autobench/run.mjs --model claude-opus-5-5 --effort xhigh --budget 3 --tasks <LOOK2-TASKS.json>
  --date-note --concurrency 3 --cap 60`, no harness (A0), k = 1, CLI 2.1.307 (the effort flag reaches the CLI as
  `--effort xhigh`; `src/executors/claude-code.mjs:307`). Started 02:10Z after the container restart, finished 02:38Z.
- **Task set.** The 60 look-2 tasks of SEQUENTIAL-PLAN-v1 (plan `3cd586bd…`, list sha256 `a8c1ed5c…`, 10 per domain).
  This is a reported reference arm beside A1-C v2's look 2 (D25, D26), not part of the plan's confirmatory test.
- **Result (aggregates only).** Strict pass **26/60 (43.3%)**; mean partial credit 0.827; $23.12 in total, **$0.385 per
  task**; 0 environment faults, 0 unknown-cost sessions, 0 nested model uses. Per-task outcomes stay in the host-only run
  directory (`/var/tmp/foundry-work/autobench/a0o-look2-1/`) until the look-2 arms are analysed, so no harness developer
  reads them first.
- **Reading.** Development evidence (public AutomationBench devTrain tasks; first look for every arm on this list). For
  scale only: the private leaderboard lists Opus 5.5 xhigh at 35.77% for $0.89 per task on a different, larger set.
