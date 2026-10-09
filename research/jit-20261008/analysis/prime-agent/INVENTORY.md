# Prime Agent study: inventory of what was read

*2026-10-09, laptop session, read-only, $0, no model calls. Companion to [PRINCIPLES.md](PRINCIPLES.md).*

## What is installed

| item | value |
|---|---|
| Product | Prime Agent CLI, version **0.9.8** (CHANGELOG top entry dated 2026-09-29). Confirmed offline by `PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 prime-agent --version` → `0.9.8` (the only command executed). |
| Package identity | `package.json`: `@earendil-works/pi-coding-agent` 0.9.8, MIT, author Mario Zechner, repository `github.com/PrimeIntellect-ai/prime-agent` (`packages/coding-agent`). README: a hard fork of `badlogic/pi-mono`. |
| Release directory | `/home/raed/.local/share/prime-agent/releases/0.9.8-linux-x64-83fb09129bf78e3e60268212cd70932166591b15188caa70c1b0efbcc76235e2/` (below: `$R`) |
| Archive sha256 | `83fb09129bf78e3e60268212cd70932166591b15188caa70c1b0efbcc76235e2` (`$R/.archive-sha256`) |
| Install marker | `/home/raed/.local/share/prime-agent/.managed` = `prime-agent-native-v1` |
| Launchers | `/home/raed/.local/bin/prime-agent` (a 10-line sh wrapper that execs `/home/raed/.npm-global/bin/prime-agent`, adding `npm_config_allow_remote=all` only for `update`) → symlink `/home/raed/.local/share/prime-agent/bin/prime-agent` → `$R/prime-agent` |
| `/home/raed/.local/bin/prime` | dangling symlink to `/home/raed/.local/share/uv/tools/prime/bin/prime` (the Prime Intellect platform CLI, not the agent; its uv tool directory no longer exists). Not studied. |
| Binary | `$R/prime-agent`: ELF x86-64, 163,566,792 bytes, a Bun single-file executable embedding `/$bunfs/root/cli.js` (minified JS) and an embedded source map **without `sourcesContent`**. TypeScript source is therefore not on this machine. |
| Python runtime | `$R/prime-agent-runtime/` (`prime-agent-runtime` 0.1.0, Python ≥ 3.11, deps `mcp>=2,<3`, `tyro`); REPL protocol version 3 (`src/rlm/repl.md`) |
| Other protocol versions (docs) | daemon public protocol v4 (`docs/daemon.md`); session file format v3 (`docs/session-format.md`) |

## How the TypeScript side was read

The TypeScript source tree named in the docs (`src/core/agent-session.ts`, `src/core/rlm-runtime.ts`,
`src/core/kernel/repl-manager.ts`, `src/core/compaction/*.ts`, ...) is **not present**. Evidence for TypeScript behaviour comes
from (a) the shipped docs, (b) the CHANGELOG, and (c) string literals and minified function bodies extracted from the binary:

```
strings -n 8 $R/prime-agent > <scratchpad>/strings.txt          # 299,574 lines
awk 'length>2000' strings.txt | tr ';' '\n' > <scratchpad>/js.txt   # 87,063 statement-ish lines
```

The scratchpad copies are outside the repo and are not committed. Bundle evidence in PRINCIPLES.md is cited by its quoted
string literal, never by minified identifier names, which are build-specific. Passages read from the bundle:

- child-agent and root system-prompt builder (strings beginning `You are a child agent spawned by` and
  `You are a general purpose agent that uses code to solve tasks.`, and the `ipython` tool description beginning
  `The \`ipython\` tool is a persistent Python REPL`);
- autonomous continuation policy (decision reasons `not_needed`, `limit_reached`, `gate_failed`,
  `missing_terminal_evidence`; limit order maxContinuations → maxTurns → maxTokens → timeoutMs; the gate workspace
  fingerprint = `git status --porcelain=v1 -z -uall` + `git diff --binary HEAD` + a sha256 over untracked files, and the
  message `not rerun: workspace unchanged since previous failed gate`);
- print-mode exit codes (`Autonomous quality gate still failing after attempt` / `Autonomous run stopped before terminal
  evidence` set exit code 1);
- auto-refine settings defaults (`enabled ?? true`, `turnInterval` 25, `compact ?? true`, `cooldownMs` 1,200,000);
- the `/refine` planner system prompt (`You are Prime Agent's /refine continual harness subsystem.`), the auto-refine
  review gate prompt (`You are Prime Agent's automatic /refine review gate.`), the edit applier (optimistic check
  `entry changed during refinement planning`, before/after snapshots, rollback proposal builder);
- child lifecycle notices (`[child-failed child:`, `[child-exited: no-reply child:`, `[child-exited: cancelled child:`).

## Files read (Prime Agent), with sha256 prefix

| path | sha256[0:16] |
|---|---|
| `$R/README.md` | 0aeab41af61d7f87 |
| `$R/CHANGELOG.md` (grepped by topic; entries cited by line) | 9b72c4ff235d3b2e |
| `$R/package.json` | 1579458be8304e7e |
| `$R/docs/architecture.md` | 4c848c75ff508169 |
| `$R/docs/rlm.md` | 80ba455576e75991 |
| `$R/docs/rlm-runtime.md` | da373b5dd851fdc5 |
| `$R/docs/long-running-agents.md` | dd45d964cd41e139 |
| `$R/docs/daemon.md` | 90d1d1d328ae9d1e |
| `$R/docs/agent-connection.md` | 33ee007dead2c79d |
| `$R/docs/compaction.md` (first 150 lines) | 10ee93d86171b931 |
| `$R/docs/session-format.md` (first 200 lines) | 243e5ffeb41173ef |
| `$R/docs/settings.md` (grepped: rlm, autonomous, retry, backup model) | 4eca4922e72190eb |
| `$R/docs/usage.md` (Autonomous Options section) | fb0f8942f12e9825 |
| `$R/docs/skills.md` (grepped: progressive disclosure, Python skills) | — |
| `$R/prime-agent-runtime/pyproject.toml` | 407c81e6a31f5c10 |
| `$R/prime-agent-runtime/src/rlm/__init__.py` (spawn, create_session, collect, progress_note, delete_subagent) | cf998db175d37430 |
| `$R/prime-agent-runtime/src/rlm/harness.py` (lines 1–200 and the def/class index) | 026130e79706c72a |
| `$R/prime-agent-runtime/src/rlm/repl.md` (protocol header) | da35b684df353285 |
| `$R/skills/goal/SKILL.md`, `$R/skills/goal/src/goal/__init__.py` | da1694a20929517b, a96fcee0bbba5b23 |
| `$R/skills/refine/SKILL.md`, `$R/skills/refine/src/refine/__init__.py` | 048b0e5a3df1d8d5, 00737a6e2d3951df |
| `$R/skills/agent-message/SKILL.md` | 5547aa6b0c2371ed |
| `$R/skills/agent-observe/SKILL.md` | 6229624c4e63c376 |
| `$R/skills/rlm-heartbeat/SKILL.md` | 021daa60f9e9a89d |
| `$R/skills/compact/SKILL.md` | 25697c118cbc4336 |
| `$R/skills/edit/SKILL.md` | 5e687f0d6fc45a48 |
| `$R/skills/skill-creator/references/python-skills.md` (first 60 lines) | c632b20d3ec8a1f2 |
| `$R/examples/extensions/subagent/README.md` (the inherited pi "subagent" extension: single / parallel / chain) | ff3a249eb03094b5 |
| `$R/prime-agent` (binary; strings only, see above) | 94e90d59b5853036 |

Listed but not read: `$R/skills/{websearch,attach-image,mcp,prime-intellect}`, `$R/examples/extensions/plan-mode/*`,
`$R/docs/{extensions,sdk,rpc,tui,providers,models,...}.md`, `$R/prime-agent-runtime/src/rlm/{bash,repl,mcp,mcp_base}.py`.

## Local Prime Agent data (`/home/raed/.prime`)

Only names and JSON key sets were inspected, never values, transcripts or messages:
- `~/.prime/agent/session-artifacts/<id>/`: `kernel-state.dill`, `kernel-state.json`, `kernel-stderr.log`,
  `semantic-edges.jsonl` (first entry type seen: `session_registered`).
- `~/.prime/agent/harness/harness_state.json`: top-level keys `schema`, `entries`, `refinements`; entry counts
  prompt 1, memory 0, skill 0, subagent 0.
- `~/.prime/agent/harness/refinements.jsonl`: 2 lines with keys `appliedEdits, expectedOutcome, harnessStatePath, id,
  rationale, scope, summary`.
- `~/.prime/config.json`: key names only (`api_key, team_id, ...`) to decide not to open it.

Not opened (credential-like or private): `~/.prime/config.json` values, `~/.prime/agent/auth.json`,
`~/.prime/agent/settings.json`, `~/.prime/agent/telemetry.json`, `~/.prime/agent/models.json`, `~/.prime/agent/sessions/*`,
`~/.prime/agent/supervisor-owners/`, `~/.prime/agent/daemon-workers/`, `/home/raed/claude2.txt`, `~/.claude`.

## Foundry files read (repository at `ee688db`, branch `claude/intelligent-hamilton-vg1f9a`)

- `docs/THESIS.md` §1–§5 (lines 1–163) and skimmed §6–§8
- `research/jit-20261008/THESIS-JIT.md` (all; §2 and §6 in full)
- `AGENTS.md`; `docs/ROADMAP.md` §2.1 (lines 120–220), lines 335–345, 778–790, §6 (lines 1139–1176)
- `research/jit-20261008/HANDOFF.md` §0–§2; `_local/WORKFLOWS-PAUSED.md` (header)
- `research/jit-20261008/FRONTIER-GAPS.md` rows G5, G6, H1–H5, I1–I3 and §3.14
- `research/jit-20261008/BLOCKER-SYNTHESIS.md` §2.0–§2.1 (ranked table)
- `research/jit-20261008/SEED-LEDGER.json` (ranges only)
- `experiments/jit/flow-v2.mjs` (all), `experiments/jit/stream.mjs` (header, function index, lines 940–970),
  `experiments/jit/compile.mjs` (header), `experiments/jit/interpret.mjs`, `router.mjs`, `durability.mjs`, `profile.mjs`
  (headers), `experiments/jit/resume-streams.mjs` (header), `experiments/jit/configs/r0-records.json` (arms)
- `src/children.mjs` (header), `src/journal.mjs` (header), `src/runtime.mjs` (lines 82, 129–141), `src/models/port.mjs`
  (lines 11, 66–71), `experiments/lib/runner.mjs` (line 19), `schemas/workflow.schema.json` (line 109)

Never read: `beds/sealed/`, any held-out seed (≥ 7001) material, `/home/raed/claude2.txt`, `~/.claude`, env vars.
