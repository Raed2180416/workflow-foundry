# a1s-dev60-dn: 45 tasks here, 15 in a1s-dev60-dn-fill, two CLI versions

- **Interruption.** On 2026-10-15 this run recorded 45 outcomes and was then stopped by the weekly usage limit.
  - It raised 24 `MODEL_RATE_LIMIT` fault records, kept in `results.faults.jsonl` (about $0.04 of spend).
  - The run correctly stopped instead of scoring them.
- **Why it could not resume.**
  - The container was rebuilt before 2026-10-21 with Claude Code CLI **2.1.306**, and the launch used **2.1.300**.
  - The harness manifest includes the CLI version, so `--resume` was refused (correctly).
  - The 2.1.300 binary is no longer on the machine.
- **The fill run.** The 15 unrecorded tasks ran on 2026-10-21 as `a1s-dev60-dn-fill`.
  - Same model, harness code, date note, budget ($1.50 per session) and tasks, but CLI 2.1.306.
  - All 15 are outcomes (no faults), and 7 of the 15 passed.
- **Caveat.** The A1-S arm therefore mixes two CLI patch versions. The other three dev60 date-note arms ran entirely
  on 2.1.300. Read the Sonnet + harness figure with that caveat.
