# a1-dev60-dn: three records are not outcomes

This run finished on 2026-10-15 at 12:25:45Z, while the session's disk allowance was full.

**The three records:**
- **ENOSPC host errors.** `finance.project_profitability` and `sales.advance_opportunity_stage` ended on an
  `ENOSPC: no space left on device` error. Each is booked at its $0.75 budget bound because its cost is unknown.
- **Cap skip.** `hr.employee_request_routing` was skipped at the $3 cap. Those two bounds had used up the room.
- The runner of the time scored all three as fails. The runner fix in commit 0d702fa classifies them as not outcomes.

**Why a resume could not be used.**
- A1's harness manifest includes `experiments/autobench/run.mjs`, so the fault-handling fix changed the manifest:
  b9f8aa05… at launch, daa9406f… after the fix.
- A `--resume` would therefore be refused, and it was.
- I checked against git that `run.mjs` is the only manifest file that differs from the launch commit 512270f. The
  prompts, step guard and harness code are byte-identical.

**The fill run.** The three tasks were re-run as `a1-dev60-dn-fill`, with the same model, harness, date note and budget,
and `--tasks` selection.
- All three passed, at $0.064 in total. All three had also passed in `a1-dev60`.
- The analysis in `../DEV60-A0-A1.md` merges the 57 outcome records here with the 3 fill records.
- The raw records above are kept as written.
