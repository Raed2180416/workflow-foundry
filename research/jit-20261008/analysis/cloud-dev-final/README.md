# Cloud dev streams, final state (DEV-NOTES D25)

Outputs and scripts behind DEV-NOTES D25. All $0, no model call: the tools only read the run files, and the one replay uses
a strict memo port with no live port. Dev seeds 201-224, K = 1, development evidence only.

| file | what | how it was made |
|---|---|---|
| `report-<experiment>.md` | final per-arm report | `node experiments/jit/report.mjs <runDir>` on a copy holding arm.json, results/events/faults.jsonl (it writes into the run dir, which would overwrite the 2026-10-09 interim reports) |
| `durability-<experiment>.md` | durability per arm (W = 6) | `node experiments/jit/durability.mjs <runDir>` |
| `eval-profiles-<experiment>.md` | input-profile replay | `node experiments/jit/eval-profiles.mjs <runDir>` |
| `arm-tables.mjs`, `arm-tables-<experiment>.json` | the D25 tables: unfinished spend, compile share, compile attempts by builder from events.jsonl, adopted versions, faults | `node arm-tables.mjs --runs <dir> --experiment <jit-dev-records-1> --out <file>` |
| `shadow-replay.mjs`, `shadow-replay-jit-dev-kinetics-1.json` | the four kinetics shadow pairs rebuilt offline and re-decided under the tolerant comparator | `node shadow-replay.mjs --runs <dir> --experiment jit-dev-kinetics-1 --work <scratch> --out <file>` |

`<dir>` is `experiments/runs/jit` inside the cloud container, or `research/jit-20261008/runs` for the committed mirror (both
give identical answers and decisions). A `journal.sqlite` is copied before it is opened.
