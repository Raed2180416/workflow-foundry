# VOID: OT-0 agent arms of 2026-10-21 hit by the account session limit

These three runs are **void**: no row, prediction or comparison reads them. They are kept as raw failures. The reasons,
root cause and fix are in `research/org-20261021/PREREG-OT0-AMEND-1.md`. The re-runs are `ahv-s12-r1`,
`af-sonnet-s12-r1` and `af-opus-s12-r1` in `research/org-20261021/runs/`.

| run | contaminated from | clean prefix | reported (void) | spend |
|---|---|---|---|---|
| `ahv-s12` (A-HV, Haiku 5.5) | tick 40: call `2026-03-07T02:31:00+01:00\|r1\|case\|i-000008`, `MODEL_RATE_LIMIT` after 9 turns | ticks 1-39; last clean commit 2026-03-07T02:05:00+01:00 | E8 3/14, +C2 3/14; 20 arm errors (`crash`, `no output.json (session [object Object])`) | $0.4641 |
| `af-sonnet-s12` (A-F, Sonnet 5.5) | tick 1 (t0): every one of 21 ticks `MODEL_RATE_LIMIT`; no model ran | none | E8 0/14; 21 arm errors | $0.00 |
| `af-opus-s12` (A-F, Opus 5.5) | tick 1 (t0): as above | none | E8 0/14; 21 arm errors | $0.00 |

**Why.** The account session limit hit at about 19:3x UTC on 2026-10-21. `run-agents.mjs` (pre-amendment sha256
`38634460…`) did not stop on an environment fault. Each faulted session became a host `arm.error`/`carry.lost`, was
committed and scored, and the run went on to the horizon and exited 0. The A-HV clean prefix is not spliced into the
re-run, because it ran under the pre-amendment runner and one row must not mix two runner versions.

**What is here** (moved with `git mv` from `runs/<label>/`, where commit 3942863 had kept them as raw failures):
- `result.json`, `ticks.jsonl`: the run outputs as written; their scores are invalid;
- `journal.jsonl`: the host journal, hash-chained and unchanged, copied from the live directory;
- `run.log`: the run's console log.

The live directories (journals, blobs, empty work dirs) and logs are in `/var/tmp/foundry-work/ot0-arms/void-20261021/`.

| file | sha256 |
|---|---|
| `ahv-s12/journal.jsonl` | `28acad7d55daada95be040d244e7d7bc93110397064131843511f77f55821374` |
| `af-sonnet-s12/journal.jsonl` | `5e57e26e88d48547a7f94ad6690c5b2e740a462e08832ae810ec7e4523e46558` |
| `af-opus-s12/journal.jsonl` | `063f50d3943e9bff012271d49f370ed9409bfa44dcae234ca78f7a2468e602bb` |

The W-C builds `wc-e8-1..3` finished before the limit and are clean (no `MODEL_RATE_LIMIT`; each build session ended in
`success`). They stay in `runs/`.
