# R0 / R0-K runbook (BLOCKER-SYNTHESIS §4.1 step 3; laptop, 2026-10-09)

*Operational checklist for the two dev rehearsals (`experiments/jit/configs/r0-records.json`, `r0-kinetics.json`) and, after
the PREREG freeze, the held-out run. Every gate here is a $0 check that must pass before a paid arm starts. Numbers marked
(config) are read from the config at run time, not from this file.*

## 0. Gates, in order

| # | gate | how | pass condition |
|---|---|---|---|
| G1 | engine frozen | `git status --porcelain src policy schemas bin skills package*.json` is empty; `ENGINE-FREEZE.md` §1 HEAD and kit hash equal the current `git rev-parse HEAD` and `kitHash()` | both equal; otherwise re-stamp first (one commit) |
| G2 | suites green | `node --test --test-concurrency=2 tests/*.test.mjs experiments/lib/*.test.mjs` and the JIT suite `node --test experiments/jit/test/*.test.mjs` | 0 fail (skips allowed) |
| G3 | seed ledger | `node -e` `assertSeedsAllowed` over the config (stream.mjs does this at config validation); range `jit-r0-fresh` (225–248) must be `fresh` for purpose `jit-r0` | passes; flip `fresh -> used` in **the same commit** as the run's config (S0-5) |
| G4 | 1-task live smoke | one sandboxed Haiku `interpret` on the family's first dev task with a $0.45 cap, token from the environment (see §2). Reads the trace: `sandboxReady: true`, ≥ 1 `assistant` event, `costUnknown: false`, no `EXECUTOR_PROTOCOL` | one session finishes with a reported cost. **This is what caught the CLI root check on 2026-10-09** (`SMOKE-laptop-20261009.md`): without it every R0 interpretation would have been retried and imputed at its full budget with $0 spent |
| G5 | quota headroom | `node research/jit-20261008/analysis/quota-meter/probe-meter.mjs --iterations 1 --interval-s 1 --max-calls 1 --max-usd 0.06 --log /var/tmp/foundry-work/meter.jsonl` (one Haiku call, ~$0.001); read `unifiedWindows.five_hour.utilization` and `seven_day.utilization` | 5h ≤ 0.60 and 7d ≤ 0.80 at start (owner's account is shared with the orchestrator's own calls; a 0.01 tick ≈ $0.2 of Haiku list cost, row 6) |
| G6 | machine | `free -g` available ≥ 4 GB; the sibling GPU job (`judge_v2_pipeline.sh`) may stay; concurrency in the config ≤ 2 | enough RAM for two sandboxed CLI sessions (~1 GB each) |
| G7 | output location | `--run-root /var/tmp/foundry-work/runs` (on disk, never auto-cleaned); the config's `persist.commitDir: true` mirrors `export/<arm>/` into the default committed directory (`DEFAULT_COMMIT_DIR` in stream.mjs) so it lands in git | both dirs exist and are writable |

## 1. Order of runs

1. **R0 (records, dev 225–248)**: Haiku agent arm and the Haiku/Haiku JIT arm first (the cheapest pair, and the pair the
   PREREG claim is about). Opus-interpreter and Sonnet arms only after the pair finishes without an env-fault invalidation.
2. **R0-K (kinetics, dev 225–248)**: same order. Kinetics uses `jit.compare: 'tolerant'` with the Stage A candidate
   (relTol 0.05, exclusion set exact); Stage B (`analysis/kinetics-gauge/stage-b.mjs`) should finish first if it is
   running, because its result can only tighten relTol, which must be fixed before R0-K starts.
3. Spend caps: per-arm caps and `spendStopUsd` (config). Expected: R0 $25–40 for the four arms; R0-K ~$25 for the first
   pair. The stop is on **actual** spend; an attempt with `costUnknown: true` imputes its budget bound, which is why G4
   exists.
4. Every resume goes through `experiments/jit/resume-streams.mjs`; a fault that a resume later resolves is not an
   impaired task (stats.mjs env-fault rule: an arm with > 25% impaired tasks in any stream is invalid, V in the decision
   rule).

## 2. Command shape

Sandboxed builders authenticate with `CLAUDE_CODE_OAUTH_TOKEN` from the environment; the host-side judge and compiler calls
(`claude-cli` provider) use the CLI's own login. Run every paid command from a minimal environment:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp LANG=C.UTF-8 TERM=dumb \
  CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '[:space:]' < <owner-provided token file>)" \
  /opt/node24/bin/node --max-old-space-size=1024 experiments/jit/stream.mjs \
  --config experiments/jit/configs/r0-records.json --arms 'agent:claude-haiku-5-5,jit:claude-haiku-5-5/claude-haiku-5-5' \
  --run-root /var/tmp/foundry-work/runs --work-root /var/tmp/foundry-work/work
# then: node experiments/jit/resume-streams.mjs ... --commit   (mirror export/ into persist.commitDir)
```

- The token is never written anywhere; the stream's journal and export must not contain it (`grep -rF sk-ant-` over the
  run dir after each arm, as the smoke did; the repo's sandbox env allow-list keeps it out of traces).
- `env -i` is belt and braces: `src/executors/claude-code.mjs` now builds the sandbox environment from an allow-list
  (ISOLATION-PROBE-laptop.md found the earlier deny-list forwarded 27 credential-named host variables).
- Inside the sandbox the CLI runs as the host uid in a nested user namespace (not uid 0), so the CLI's root check passes
  honestly and the agent cannot mount or unmount anything.

## 3. After each arm

1. `grep -rF sk-ant-` → nothing; `export/<arm>/MANIFEST.json` present; `faults.jsonl` reviewed (what, and whether a
   resume resolved it).
2. `node experiments/jit/report.mjs <runDir>` for the arm; no comparative reading until both arms of a pair exist.
3. Commit `research/jit-20261008/runs/<experiment>/export/` and push. Anything unpushed can be lost (the cloud's run data was).
4. R0 is a rehearsal: it fixes PREREG TBDs (effort, caps, retries, shadow floor ε, relTol) and is **not** evidence for the
   claim. Negative or messy results are recorded in DEV-NOTES, not discarded.

## 4. What R0 must answer before the PREREG freeze (step 4)

| TBD | source |
|---|---|
| per-arm budget and `spendStopUsd` for 24 tasks | R0 actual spend per arm, ×1.5 margin |
| shadow floor ε (0.25 Bernoulli, `jit.shadowFloor`) is affordable | R0 JIT arm: shadow count and cost share |
| kinetics relTol | Stage A (0.05, exact exclusions) unless Stage B shows correct–correct pairs disagree at 0.05 |
| env-fault rate on this laptop | R0 faults.jsonl: if any arm > 10% impaired, fix the cause before the held-out run |
| interpret retry policy and EXECUTOR_PROTOCOL cost imputation | G4 plus R0 faults |
| wall time per arm (for the held-out schedule) | R0 durations |
