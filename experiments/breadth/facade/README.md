# Bed facade v0 (PLAN §5.1)

One adapter per bed, the same for every arm and host: the bed's tools reach the model as MCP tools through a relay that
knows nothing but the tool list; the world, gold and grader stay on the host. First bed: WorkBench
(`../workbench/`, notes in `research/breadth-20261021/workbench/ACQUISITION.md`).

```
claude -p (sandbox, --tools "", --strict-mcp-config)
   └─ mcp-relay.mjs (stdio JSON-RPC; tool list only) ── req-N.json ─▶ mailbox (workdir/.facade) ◀─ res-N.json ──┐
                                                                                                              │
host (outside the sandbox): host.mjs ── {op:'call'} ─▶ bed process (pinned venv, python -I, unshare -rn)      │
                                     └─ python tool ─▶ src/sandbox.mjs (network off, allow-listed root) ──────┘
grading: a separate bed process, host-side, after the session (never a tool)
```

## Plugging in a bed

The bed process speaks JSON lines on stdin/stdout (one request, one response, in order); everything it prints for
itself goes to stderr. Required ops:

| op | response |
|---|---|
| (start) | `{kind:'ready'}` |
| `catalog` | `{kind:'catalog', tools:[{name, mcpName, description, inputSchema, write}]}` |
| `reset` `{task, seed}` | `{kind:'reset', digest}`: a fresh world |
| `call` `{name, args}` | `{kind:'call', text, action, write, fatal}` or `{kind:'call', error, fatal}`; `fatal` = the official loop would end here |
| `snapshot` | `{kind:'snapshot', digests, digest}`: what the host-side grader compares |
| `quit` | `{kind:'bye'}` |

Then: `bed-process.mjs` starts it (`startBedServer`), `host.mjs` serves a session's mailbox against it, `session.mjs`
runs one hardened CLI session (`runFacadeSession`), and `scripted-client.mjs` replays action lists through the same path
at $0 (gold replay, floors, mutants; an optional reaction `policy` lets a scripted agent retry or repair after an error).
A Foundry arm adds its own MCP server as a second entry of the same `--mcp-config`; the arm's frozen init fingerprint
then lists both servers.

## Faults and drift (`faults.mjs`)

A session may carry one declared fault spec; the host applies it before the call reaches the world, the relay and the
model only see its effect, and grading is unchanged (the journal of world actions). A deliberate fault is never an
environment fault.

| Kind | What the session sees | What the world sees |
|---|---|---|
| `transient` | the nth matching call (`target: 'write'` or a tool) answered "503 Service Unavailable … retry" | nothing (a retry goes through) |
| `lost_ack` | the nth matching call answered "Request timed out … outcome is unknown" | the call, applied (a blind retry duplicates it) |
| `rename_param` | the tool's schema with `from` renamed to `to`; a call with `from` refused ("unknown parameter") | the call with `to` mapped back to `from` in place |
| `distractor` | a retired twin `<tool>_v2` with the same schema; calling it answers "retired" | nothing |

`applyFaultToCatalog` gives the session's tool list and the host catalog; the twin's name joins the init fingerprint.
Tests: `facade.test.mjs` (host level) and `../test/extras.test.mjs` (through the pinned WorkBench bed: each kind has
teeth and a robust scripted agent passes it).

## Hardening (what every session gets)

- `--setting-sources '' --disable-slash-commands --no-session-persistence --strict-mcp-config --tools <arm list>`,
  `--max-turns`, `--max-budget-usd`, `--effort`; stream-json output.
- **Not `--safe-mode`:** on CLI 2.1.307, 2.1.312 and 2.1.318 it also drops `--mcp-config` servers (observed with the $0
  offline init probe; `probe-init.mjs` re-checks it on every re-freeze and records it in `INIT-PROBE.json` `safeModeCheck`).
- The executor sandbox of `src/executors/claude-code.mjs` (private user/mount/pid namespaces, read-only host, hidden
  homes, `/tmp`, `/var/tmp`, the repository and every other workdir; allow-listed environment). The relay script and tool
  list are the only kept directory.
- Init check: the `system/init` event must match the arm's frozen fingerprint (CLI version, model, tools, MCP servers
  and status, skills, plugins, slash commands, agents); otherwise the session is killed at once (`CONFIG_MISMATCH`, an
  environment fault, $0 when killed before the first model answer).
- Meter: every `rate_limit_event` is journaled; a wave starts at 5h ≤ 0.60 and 7d ≤ 0.80; no session at 5h ≥ 0.80.
- Host mailbox: regular files under 256 KB only, catalog names only, JSON-object arguments only, atomic responses that
  never follow a planted link, journal of every call in world order.

Tests: `nice -n 15 node --test --test-concurrency=1 experiments/breadth/test/facade.test.mjs` (and `run.test.mjs`,
`workbench.test.mjs`, `extras.test.mjs` beside it).
