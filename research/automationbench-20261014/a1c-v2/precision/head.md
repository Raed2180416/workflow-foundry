# A1-C check precision on dev60 (in-sample development evidence, 2026-10-21)

*Run `a1c-dev60-dn` (Haiku 5.5 in every role, harness a1c-v1, 60 devTrain tasks, seed 21, k = 1). Development evidence on
devTrain tasks read as the developer (PREREG-AB-v1 §5); in-sample (the pipeline was probed on these tasks while it was
built). One annotator (this study) aligned every compiled check with the grader's assertions; the per-check labels and
their reasons are in `labels.py` beside this file, so every number below can be re-derived and disputed line by line.*

## Method

- **Grader truth at every check round.** The live run grades only the final world. To know what the grader would have said
  before and after each repair, every task was replayed through the bridge's own `Rollout` (`experiments/autobench/bridge.py`,
  read-only) from `prep/<task>/world0.json`, applying the recorded `calls.jsonl` steps up to the start of each repair node
  (`nodes.json` timing) and grading there. The generator values (uuid, clock, random) recorded in `generated.json` are played
  back in order, and grading draws live values as the live run did. **Validation: 60/60 tasks reproduce the live final grade
  exactly (per-assertion), and every replayed step returns byte-identical tool results.** The initial world was graded the
  same way to separate action assertions (false at start) from guards (true at start).
- **Alignment.** Each of the 618 checks in `pipeline/postconditions.json` was aligned with the grader assertion(s) it
  tests: *full* (same entity and effect, asserted value tested), *partial* (same entity/effect, asserted value not tested)
  or none. Each check's verdict in `check-N.json` was then compared with grader truth at that round:
  TA (check passes, assertion passes), TR (both fail), **FA** (check passes, an aligned assertion fails),
  **FR** (check fails, aligned assertions pass; or check fails and has no graded counterpart, "unaligned"),
  neutral pass (passes, no graded counterpart), undecided (judged check not re-run after round 0).
- Scored assertions = the grader's denominator: 567 action assertions plus 25 guards the agent broke (592). 388 intact
  guards are excluded by the grader and reported separately.
- Scripts and intermediate data: `bin/playback.py`, `cuts.py`, `labels.py`, `analyze.py`, `coverage.py`, `failing.py`,
  `fixmap.py`, `tables.py`; replays in `replay3/` and `replay0/` (all in this directory).

## Headline

- **A failing hard check is usually wrong.** At round 0 (the act world) 137 hard checks failed; 120 of them (88%) failed a
  world the grader passes or demanded something the grader does not ask. Of the 17 that agreed with the grader, 16 agreed
  by accident (the check was blind to the app, or compiled to the wrong app). **One** hard check in 60 tasks (finance.ap_aging_report)
  rejected a failing world for the right reason.
- **A passing hard check is usually right but often too weak.** 207 of 235 passing hard checks were correct (88%); 28 (12%)
  passed a world that fails the grader. Most false accepts are checks that do not carry the value the grader tests (weak),
  or checks that faithfully encode a wrong requirement the ledger produced, which the agent then carried out.
- **87 of 592 scored assertions (15%) have no check at all; 44 of the 121 failing assertions (36%) are among them.**
  A further 101 scored assertions (32 failing) are only partially covered.
- **Task-level gate at round 0:** of 21 worlds the grader passes, the gate rejected 13 (62%); of 39 failing worlds it
  accepted 18 (46%) and rejected 21, 20 of them only through wrong or blind checks.
- **Repairs never turned a failing world into a passing one** (0 of 21 rejected failing worlds, 42 rounds) and **broke one
  passing world** (support.intercom_multi_product_routing: 1.00 -> 0.94, a hard check demanded a tag the routing rules
  exclude). 23 repair rounds ran on worlds the grader already passed; 14 of them changed the world.
- **Stale/true-at-start checks: none.** The diff-based evaluation means no positive check was true in the initial world
  (all 54 checks true at start are the intended negatives).

