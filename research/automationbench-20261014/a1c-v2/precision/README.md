# A1-C check-precision study (dev60, in-sample development evidence)

Committed under decision D21 (`research/decisions-20261021.md`, main tree): the generic A1-C v2 rules and thresholds were
tuned against these dev60 grader comparisons, so the study that drove them is part of the record. **Development
evidence on devTrain dev60 (the recorded run `a1c-dev60-dn`), one annotator; never held-out evidence.**

- `precision.md`: the report (method, tables T1-T7, causes, repair damage, ranked generic fixes).
- `labels.py`: every per-check alignment label and its reason (the single annotator's judgement, line by line).
- Derived inputs, enough to re-derive every table without the live run: `check_rows.json` (one row per compiled check
  and round, with its verdict and grader truth), `coverage.json`, `failing.json`, `tasks.json`, `fixes.json`,
  `cuts.json`, `repairs.json`, `repair_records.json`, `repair_wdiff.json`, `test-replay.json`, `jobs.txt`.
- Scripts: `tables.py`, `appendix.py`, `fixmap.py`, `coverage.py`, `failing.py` re-derive `tables.md`, `appendix.md`,
  `fixes.json`, `coverage.json`, `failing.json` from the JSON above and `labels.py`. `analyze.py` (with `load.py`,
  `universe.py`), `cuts.py`, `wdiff.py`, `rounds.py`, `dump*.py` need the live run directory
  `/var/tmp/foundry-work/autobench/a1c-dev60-dn` and the per-round replays.
- Not committed (re-derivable, world content): the per-round world replays (`replay3/`, `replay0/`; about 3.6 MB each),
  the raw prompt dumps (`dump-all.txt`, `dump2-all.txt`), one world file and a probe output. `runjob.sh` / `runjob0.sh`
  with `bin/playback.py` rebuild the replays from the live run (the scripts still name the original scratch directory
  in `S=`; set it to a scratch directory of your own).

The replay tool of A1-C v2 (`experiments/autobench/replay/playback.py`, `lib.mjs alignScore`) is the committed port of
`bin/playback.py` and `autoalign.py`.
