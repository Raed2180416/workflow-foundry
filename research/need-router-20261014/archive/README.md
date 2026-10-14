# Archive: rescued JSONL of P1 and C0 dev (LEGACY, development evidence)

Rows predate the need-router protocol (research/need-router-20261014/DESIGN.md §2 validity gates). Never pooled with new labels. P1: 300 s per-call limit, timeouts booked at $0, 1-hour cache writes (policy 2026-10-08.1 later set FORCE_PROMPT_CACHING_5M=1); C0 dev: seeds 6001-6004 were inspected by the failure diagnoses and are no longer held out.

Rescued 2026-10-14 from `experiments/runs/ (git-ignored, .gitignore:13)` by `experiments/need-router/diagnostics/rescue.mjs` (M0 item 5, DESIGN §7).
Files are byte copies; `MANIFEST.json` holds the sha256 of each and what was left behind. The diagnostics D0-D6
(`research/need-router-20261014/analysis/m0/REPORT.md`) read these copies, never the ignored originals.

| file | lines | bytes | sha256 (16) | source | what |
|---|---|---|---|---|---|
| `p1/results.jsonl` | 288 | 342813 | `1adcf7d0aefd3edf` | `experiments/runs/p1/results.jsonl` | P1 records v3: 8 arms x 12 tasks x 3 trials (research/core-20261006/REPORT.md) |
| `c0-dev/results.jsonl` | 96 | 101993 | `4c4a9dabe80d0617` | `experiments/runs/c0-dev/results.jsonl` | C0 dev round: records and codefix, 6 arms x 4 tasks x 2 trials (research/construction-20261006/REPORT-dev.md) |
| `c0-dev/probes.jsonl` | 24 | 24906 | `c97b192c676354f7` | `experiments/runs/c0-dev/probes.jsonl` | C0 dev round: construction probe runs (24 rows) |
| `c0-dev/constructions.jsonl` | 8 | 34003 | `61e4bffc7367e348` | `experiments/runs/c0-dev/constructions.jsonl` | C0 dev round: the 8 construction records, with the CLI final usage per builder session |

**Not rescued** (stay under the git-ignored `experiments/runs/`):

- `experiments/runs/p1/journal-hosted.sqlite` (16384 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/journal-hosted.sqlite-shm` (32768 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/journal-hosted.sqlite-wal` (0 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/journal-local.sqlite` (16384 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/journal-local.sqlite-shm` (32768 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/journal-local.sqlite-wal` (0 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/journal.sqlite` (22335488 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/journal.sqlite-shm` (32768 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/journal.sqlite-wal` (4177712 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/p1/run.1.log` (4144 bytes): log (ignored by *.log): stays git-ignored
- `experiments/runs/p1/run.log` (15236 bytes): log (ignored by *.log): stays git-ignored
- `experiments/runs/c0-dev/construct-records-codefix.log` (909 bytes): log (ignored by *.log): stays git-ignored
- `experiments/runs/c0-dev/execute-records-codefix.1.log` (1405 bytes): log (ignored by *.log): stays git-ignored
- `experiments/runs/c0-dev/execute-records-codefix.2.log` (2523 bytes): log (ignored by *.log): stays git-ignored
- `experiments/runs/c0-dev/execute-records-codefix.3.log` (360 bytes): log (ignored by *.log): stays git-ignored
- `experiments/runs/c0-dev/execute-records-codefix.log` (2750 bytes): log (ignored by *.log): stays git-ignored
- `experiments/runs/c0-dev/journal.sqlite` (17739776 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/c0-dev/journal.sqlite-shm` (32768 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
- `experiments/runs/c0-dev/journal.sqlite-wal` (4169472 bytes): SQLite model journal (binary; raw prompts and outputs): not JSONL; stays git-ignored
