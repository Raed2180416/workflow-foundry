# PREREG-FH1 amendment 1: run the outstanding steps once more, after the usage window reopened (2026-10-22)

Written 2026-10-22 ~02:20 UTC, **after** the 22 graded steps of the first launch were seen (commit `40f79af3`) and **before** any
further paid call. `PREREG-FH1.md` itself stays byte-identical (it is a frozen file; the plan runner checks its sha256 before
every paid step), so this amendment lives in its own file and `RESULT-FH1.md` reports it under deviations.

## What happened

- **Usage window.** From 23:29:43Z the account's five-hour usage window was closed (every faulted transcript ends in
  `rate_limit_event` `"status":"rejected","rateLimitType":"five_hour","resetsAt":1792634400` = 2026-10-22T02:00:00Z, result text
  "You've hit your session limit · resets 2am (UTC)"). Six steps faulted (`MODEL_RATE_LIMIT`). The single rerun of §3 started 1 to 3
  seconds after each worker's plan ended, inside the same closed window, and faulted again. All of these sessions cost $0, except
  `b1lh-e8-2.H-0.k1` envfault-1, which ran 10 turns ($0.180, counted in `spend.jsonl`) before the limit hit.
- **Worker B.** Exited silently at 22:59:19Z, 0.12 s after creating the directory of `cht-e8-2 H-C k2`: no exception line (the
  runner logs every exception), no `spend:` line, no session, no spend. Cause not established (no OOM trace is readable in the
  container; the restart at 02:05Z cleared process state). `cht-e8-2 H-C k2` and `cht-e8-3 H-C k2` never started.

## Change

1. §3's rerun is there to recover from an environment fault. A rerun inside the same closed window cannot do that, so the
   **8 outstanding steps** run once more now that the window has reopened, with everything else unchanged: the same code
   (frozen files and bed digest checked before every step), session (Haiku 5.5, effort high, $0.50, 20 min), gates, grading,
   the **$5.00 total** budget stop rule (open sessions counted at their cap) and the original **deadline 2026-10-22T04:13:05Z**.
   A step that faults again is reported as **not run**; there is no further rerun.
2. **One worker, sequential** (`fh1/plan-R.txt`), so the budget rule reserves one open cap instead of three and more of the
   remaining $1.40 can be used. Order:
   1. `ch-e8-3 H-C 2` first, because `ch-e8-3` is the one incident where H-C k1 left most of the failing cases (18 of 136
      recovered), so its replication is the step most able to change the reading. This choice was made after seeing k1.
   2. `b1lh-e8-2 H-0 1`, `b1lh-e8-3 H-0 1`: they complete the k1 matrix (24 cells).
   3. The other k2 steps in plan-file order (A, B, C): `ch-e8-2`, `cht-e8-2`, `cht-e8-3`, `b1lh-e8-2`, `b1lh-e8-3`.
3. **No decision rule depends on these steps.** H1, H1b and H2 (§5) use H-C k1, H-N k1, G and R only; H-0 is reported beside
   H2, and k2 enters only the secondary "H-C k1 vs k2 agreement". Whatever these steps return, the frozen verdicts are fixed by the
   steps already recorded.
