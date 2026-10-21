# Meta-harness probes: what the Claude Code CLI does under faults (2026-10-21)

*Every probe run for this study is recorded here, including the ones that did not test what they meant to. Raw output:
[`probes/cli-stub-api.json`](probes/cli-stub-api.json) (P0–P8), [`probes/cli-live.json`](probes/cli-live.json) (live batch 1),
[`probes/cli-live-2.json`](probes/cli-live-2.json) (live batch 2). Scripts: `experiments/orch/probes/cli-stub-api.mjs`,
`experiments/orch/probes/cli-live.mjs`. Development/diagnostic evidence.*

**Binary.** `/opt/node22/bin/claude` -> `/opt/claude-code/bin/claude`, version **2.1.306** (auto-updated on this host at
10:57 today; this week's runs straddle 2.1.300 and 2.1.306, see `research/automationbench-20261014/runs/DEV60-A0-A1.md` lines
101-102).

**Spend.** Stub probes: **$0** (no model, no credential). Live probes: **$0.0018 known** plus two sessions of unknown spend
bounded at $0.05 each by `--max-budget-usd` (their stream usage, a lower bound, is about $0.0004 each). Owner cap: $1.

## Method

- **Stub probes (P0–P8), $0.** The real CLI runs with `HOME` in a fresh temporary directory, a dummy `ANTHROPIC_API_KEY` and
  `ANTHROPIC_BASE_URL` pointing at a loopback server the probe scripts (it never logs headers). The server answers
  `/v1/messages` with scripted SSE streams, errors, a tool call, a cut stream or silence. `--allowedTools Bash` (as root the CLI
  refuses `bypassPermissions`: "--dangerously-skip-permissions cannot be used with root/sudo privileges", first attempt of P0).
- **Live probes (L1–L4), Haiku 5.5.** `runClaudeCode` from `src/executors/claude-code.mjs`, unmodified: its user/mount/pid
  namespace sandbox, environment allow-list and the CLI's own managed login; `--max-budget-usd 0.05` per session.

## Results

| id | fault | what the CLI did | what it means for Foundry |
|---|---|---|---|
| P0 | none (baseline) | 1 request, exit 0, `result` with `terminal_reason: completed` | the stub is faithful enough for the CLI |
| P1 | every request answers **429** `rate_limit_error`, `retry-after: 1` | **11 requests over 179 s** at t = 1.0, 2.0, 3.1, 5.3, 10.3, 20.3, 39.1, 74.5, 107.3, 146.7, 179.4 s: 10 retries; the CLI's own backoff (to about 35-40 s) dominates `retry-after` after the second retry. Ten `system:api_retry` events in stream-json. Then exit 1 with `result.subtype: "success"`, `is_error: true`, `api_error_status: 429`, `terminal_reason: "api_error"`, text "API Error: Request rejected (429) · …" | a rate-limited call holds its caller **about 3 minutes** before it fails. an agent node's call is bounded by its `timeoutMs`, else the port's 300 s (`src/runtime.mjs:1205`); a node with a shorter timeout times out mid-retry and the outage is recorded as `MODEL_TIMEOUT`, with retries stacked on retries. `subtype: success` with `is_error: true` must not be read as success (the providers check `is_error` first: `src/models/providers/claude-cli.mjs:101`) |
| P2 | every request answers **529** `overloaded_error` | same shape: 11 requests over 178 s, exit 1, `api_error_status: 529`, text names the gateway "check your inference gateway (127.0.0.1:…)" | as P1 |
| P3 | 429 three times, then an answer | recovered after 3 retries in 5.8 s, exit 0 | short storms are absorbed by the CLI itself; the harness must not add its own retries inside that window |
| P4 | **SIGTERM** to the CLI while its Bash tool runs `sleep 300.x` | exit **143** about 1.2 s after the signal; stream ends `init, assistant, user` with **no `result` event** (so no cost report); the Bash child and `sleep` are killed | SIGTERM is clean for the tool tree but leaves spend unknown: the caller must book a bound (the executor does: `costUpperUsd`) |
| P5 | **SIGKILL** to the CLI while its Bash tool runs `sleep 300.x` | the CLI dies at once; **`/bin/bash` and `sleep 300.x` survive, reparented to pid 1** | a CLI killed hard (OOM, `kill -9`, a parent's SIGKILL escalation) orphans its tool processes. Inside the executor sandbox the pid namespace kills them (L2/L3); the bare `claude-cli` provider (`src/process.mjs`) has no such container, only its process-group kill |
| P6 | stream cut after `message_start` | 1 `api_retry`, the second request succeeded, exit 0 | mid-stream disconnects are retried by the CLI |
| P7 | the API never answers; `API_TIMEOUT_MS=5000` | 9 requests in 150 s (each times out at 5 s, then backs off), still retrying when the probe killed it at 150 s; no `result` | a hung endpoint holds a call for minutes even with a 5 s request timeout; at the CLI default request timeout the same schedule would hold it far longer (inference, not measured). Only the caller's wall-clock limit bounds it |
| P8 | session transcript truncated to 60 % plus a torn JSON line, then `--resume <id>` | **resumed silently**, exit 0, no warning on stderr; an unknown id gives `error_during_execution`, exit 1, "No conversation found with session ID" | resuming a CLI session after a disk-full or a kill can silently lose history; Foundry's executors run with `--no-session-persistence` and never resume CLI sessions, which avoids this (keep it that way) |
| L1 (batch 1) | none (live baseline) | ok, PONG, **$0.00048**, CLI 2.1.306, model `claude-haiku-5-5`; stream has a `rate_limit_event` | — |
| L2, L3 (batch 1) | meant: signal while Bash runs `sleep 30.7` / `sleep 30.9` | **did not test the signal**: CLI 2.1.306's Bash tool **refused a foreground `sleep`** ("foreground `sleep` is not allowed"); Haiku reported it and stopped ($0.00046 each) | a **tool-semantics change between CLI versions**: a workflow or prompt that relies on `sleep` in Bash breaks after an auto-update. Recorded as evidence for D4 (WORST-CASE §d) |
| L4 (batch 1) | session budget below one call, `--max-budget-usd 0.0001` | 2 turns; **both Bash commands ran**; then `error_max_budget_usd`, `terminal_reason: budget_exhausted`, **$0.00031 (3x the cap)** | the CLI budget is checked between turns, so a turn's tool effects can happen after the budget is spent. The executor already treats it as a soft bound (`src/executors/claude-code.mjs:290`); effects must not rely on it |
| L1 (batch 2) | none | ok, $0.00012; `rate_limit_event` = `{status: "allowed", rateLimitType: "five_hour", unifiedWindows: {five_hour: {utilization: 0.57, resetsAt}, seven_day: {utilization: 0.14, resetsAt}}, overageStatus: "rejected", overageDisabledReason: "org_level_disabled"}` | the CLI **tells the caller its quota utilisation and reset times in every session**. An orchestrator can stop launching at, say, 90 % and park until `resetsAt` instead of discovering the limit by killing agents mid-run (this week: 4-12 agents per workflow) |
| L2 (batch 2) | SIGTERM to the CLI (by pid, inside the executor sandbox) while Bash runs a 30.71 s python sleep | exit 143 about 0.5 s later; no `result` event; executor reports **`EXECUTOR_PROTOCOL`**, `costUnknown: true`, bound $0.05, stream usage as a lower bound; the python process was gone (pid namespace) | contained; but a stop by the operator is classified as a protocol fault, which `experiments/lib/runner.mjs` ENV_FAULTS counts as an environment fault and **retries on resume** |
| L3 (batch 2) | executor abort (`signal` -> SIGKILL of the sandbox group) mid-tool | same: `EXECUTOR_PROTOCOL`, cost unknown ≤ $0.05, no leftovers | a deliberate cancel is indistinguishable from a CLI crash in the executor's result (`sessionError`, `src/executors/claude-code.mjs:277-286`, has no CANCELLED branch) |

## Not probed, and why

- **A real rate limit or usage limit**: cannot be induced on purpose within the budget; P1–P3 reproduce the CLI's side with a
  scripted server, and the live `rate_limit_event` shows the quota state the CLI exposes.
- **Other meta-harnesses** (Codex CLI, OpenCode, Gemini CLI, Aider, Cursor): none is installed and authenticated here; their
  behaviour in WORST-CASE §d is from documentation and marked as such.
- **Windows / macOS**: not available; the no-`/proc` case is simulated on Linux (chaos C3).
