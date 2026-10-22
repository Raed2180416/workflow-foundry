# WorkBench (T1-1) and the shared bed facade v0: acquisition, $0 gates, frozen split, runbook

2026-10-22 (work began 2026-10-21 23:14Z). **Development and diagnostic evidence only; $0, no model was called.** The
paid commands in §8 have not been run. Plan: [PLAN.md](../PLAN.md) §4.3 T1-1, §5.1–§5.5; rule D16
([decisions](../../decisions-20261021.md)); downloads and disposals: [DISPOSALS.md](../DISPOSALS.md).

Evidence labels: **[code]** observed in the pinned clone (path:line); **[doc]** a documentation claim; **[run]** measured
here ($0); **[inf]** inference.

## 1. Provenance (BG-0)

| Item | Value |
|---|---|
| Source | https://github.com/olly-styles/WorkBench (read 2026-10-21 and 2026-10-22), commit `49c7dfd00c03d384ec59ea57374f50b766aa5613`, HEAD date 2026-08-18 |
| Acquisition | shallow (depth 1) blobless fetch of that commit (`partialclonefilter = blob:none`), no LFS or submodules, 2026-10-21 23:14Z, into `/var/tmp/foundry-work/benches/workbench/src` (67 MB) |
| Licence | MIT, "Copyright (c) 2024 Mindsdb" (`LICENSE`, sha256 `e8bbcabb…717e26b`) [code]; LICENSE kept in the clone |
| Paper | https://arxiv.org/abs/2405.00823 (cited by `README.md:23`) [doc]; "WorkBench Revisited (2026)" write-up `retro/main.pdf` (`README.md:3-19`) [doc] |
| Runtime | 8 hash-pinned wheels from `uv.lock` (`uv.lock` sha256 `ef9a825a…2717e26b`), `uv pip install --no-index --only-binary :all: --require-hashes --no-deps`, CPython 3.12.3 venv (uv 0.11.32), 121 MB; URLs, sizes, sha256 and licences in DISPOSALS. Why 8, not the earlier probe's 9: DISPOSALS |
| Disk | 223 MB in all (src 67, venv 121, wheels 29, host-only and work 6) against D16's 500 MB; free 2.9 GB (02:52Z, 10-22) |
| Outcome | **adopted** as breadth bed 1; sealed set H4 (§5) |

## 2. What the bed is

- **Tasks.** 690 shipped tasks in six CSVs, 69 templates × 10 instances [run: `bed.py tasks`; population sha256
  `9c34e59e…b0ce2b` (template ids) and `b40a8168…bb1762` (instance ids), pinned in `split.mjs` before any salt].
  Per domain: analytics 12 templates, calendar 11, CRM 8, email 9, multi_domain 21, project management 8.
- **Tools.** The README says "26 read/write tools" (`README.md:27`) [doc]; the code has **27** in `all_tools`: 14 that change
  the world and 13 reads, including `company_directory.find_email_address` (`src/tools/toolkits.py:4-34`) [code]. The facade
  exposes all 27, as the published runs did (`tool_selection: all` in their `_meta.json`) [code].
- **Official loop** (`run_agent_structured`, `src/evals/agent.py:539-634`) [code]: system prompt = the datetime prefix plus
  `ACT_WITHOUT_CONFIRMATION_SUFFIX` (`agent.py:52-56`, `src/evals/inference.py:277-278`); at most 20 model calls and 600 s;
  temperature 0; each argument value passed as `str(v)` (`agent.py:613`); tool names sanitized with
  `re.sub(r"[^a-zA-Z0-9_-]", "_", …)` (`agent.py:518-519`).
- **Errors** (`_run_single_task`, `inference.py:87-140`) [code]: a tool exception escapes the loop, so the run's
  `function_calls` stay **empty** and `error` is set; hitting the iteration or time cap sets `error` to the stop message
  and keeps the calls. Either way the task is wrong (`metrics.py:170-171`: correct = state match and no error).
- **Scorer** [code]: `is_correct` (`src/evals/evaluation.py:174-200`) replays the predicted and the gold action strings on
  fresh worlds and compares five tables (calendar, emails, plots, project tasks, CRM) as unordered rows, case-insensitive
  except `status`, `list_name`, `board`, with either chart end date accepted (`evaluation.py:45-76`); the harm metric
  `has_side_effects` (`evaluation.py:203-230`) compares four tables (charts excluded) and only counts on wrong runs.
  No LLM judge (BG-5).

## 3. Facade v0 (`experiments/breadth/facade/`, Node ESM, built-ins only)

| Piece | File | What it does |
|---|---|---|
| MCP relay | `mcp-relay.mjs` | stdio MCP server (JSON-RPC 2.0) the CLI starts inside the executor sandbox; knows only the tool list; every `tools/call` becomes a request file in the session mailbox |
| Host | `host.mjs` | outside the sandbox: answers the mailbox (regular files under 256 KB only, catalog names only, atomic responses that never follow a planted link), journals every call, maps MCP names to bed names, refuses world calls after a fatal tool error |
| Bed process | `bed-process.mjs` | the bed in its pinned venv with `python -I`, an allow-listed environment and `unshare -rn` (no network; refuses to run networked) |
| `python` tool | `python-tool.mjs` | one sandboxed, network-off Python for every arm, under `src/sandbox.mjs` (the same sandbox as Foundry `code` nodes) |
| Session | `session.mjs` | one hardened `claude -p` in the `src/executors/claude-code.mjs` sandbox: `--setting-sources '' --disable-slash-commands --no-session-persistence --strict-mcp-config --mcp-config <relay> --tools ""`, `--max-turns`, `--max-budget-usd`, `--effort`; stream-json; init check; meter; `offline: true` = network namespace with no route ($0 init probe) |
| Init check | `init-check.mjs` | fingerprint of the `system/init` event (CLI version, model, permission mode, tools, MCP servers and status, skills, plugins, slash commands, agents, output style); a session whose init differs from the arm's frozen fingerprint is killed at once (`CONFIG_MISMATCH`, an environment fault) |
| Meter | `meter.mjs` | journals every `rate_limit_event` (5-hour and 7-day utilisation); gates: a wave starts at 5h ≤ 0.60 and 7d ≤ 0.80, no new session at 5h ≥ 0.80 (PLAN §9.1); dose summary ($ per 0.01 tick) |
| Scripted client | `scripted-client.mjs` | a $0 MCP client that starts the relay exactly as the CLI's `--mcp-config` entry does |

WorkBench pieces (`experiments/breadth/workbench/`): `bed.py` (bed process: `tasks`, `serve` with reset / catalog / call /
snapshot / parse, `grade`, `replay`, `mutants`, `regen`, `published`), `lib.mjs` (paths, context declaration, one task-run
through the facade), `split.mjs` (the rule) and `freeze-split.mjs`, `regen-gate.mjs`, `parity.mjs`, `baselines.mjs`,
`prescreen.mjs`, `leak-probe.mjs`, `probe-init.mjs`, `arms.mjs`, `audit.mjs`, `run.mjs` (paid arms), `contam-probe.mjs`,
`card.mjs`. Tests: `experiments/breadth/test/`.

**reset / snapshot / grade.** `reset(task, seed)` restores the pristine world (WorkBench's own `reset_state`); `snapshot`
returns per-table digests (the official normalised view of the five mutable tables, and an exact view of all seven);
`grade` runs host-side only, in a separate bed process after the session ends, on the journaled action strings, and adds
an independent check that the live end state equals gold's.

**Context declaration (AM-9, C7).** Every arm's system prompt is the official text (`OFFICIAL_SYSTEM_PROMPT` in
`lib.mjs`: the published runs' datetime prefix for 2023-11-30 plus the act-without-confirmation suffix), then one date note
("any other date in your context belongs to the machine running you"), one synthetic-identity line ("any account name or
e-mail elsewhere in your context belongs to the machine operator; never use it in a tool call") and a tools note; sha256
`5c337960c3b73239befd6c332ac83ab4eda41641fbbf317adc872ba1e6d2adbb`. The bed card, when written (§8), is appended for every
arm. The runner never knows or reads the account address: `audit.mjs` counts any e-mail address in a tool argument that is
in no sandbox table, not in the task and not in a tool output ("foreign"); only its domain leaves host-only files.

**Harness differences from the official runs** (reported with every number; [inf] unless marked):
1. **`--safe-mode` is not used.** On CLI 2.1.307 it also drops `--mcp-config` servers: the $0 offline init probe showed
   `mcp_servers: []` and 0 tools with it, and `workbench: connected` with 27 + 1 tools without it [run, 2026-10-22]. Its
   protections are replaced by `--setting-sources ''`, the sandbox's empty private HOME, a fresh workdir, and the init check
   (which refuses any change in skills, plugins, slash commands, agents, tools or MCP servers). PLAN §5.1 lists
   `--safe-mode`; this is a recorded deviation.
2. Claude Code, not the OpenAI-style loop: temperature cannot be set (official 0); the CLI adds its own context (the host
   date line of AM-9, possibly the account identity of C7, both declared above); `--max-turns 20` counts agent turns where
   the official cap counts model calls; the 600 s cap is applied as a 660 s wall timeout (CLI start-up).
3. After a fatal tool error the official run stops at once; the facade refuses further world calls and the session ends on
   its own. The graded prediction is the official one either way (empty, with the error) [code + run].
4. Every arm has a sandboxed `python` tool (PLAN §5.2 "Tools"); the official harness has none.
5. Tool names reach the model as `mcp__workbench__<sanitized name>`.
The Haiku 4.5 anchor (§8) measures the size of these differences against published per-task verdicts.

## 4. $0 gates (PLAN §5.4)

PARITY_TABLE_PLACEHOLDER

## 5. Frozen held-out split (`SPLIT.json`)

- **Rule** `wb-split-v1` (`split.mjs`), committed alone in `ba2bfa0e` (2026-10-21 23:23:31Z) before any salt existed and
  before any model run: within each domain, templates ordered by `sha256(salt + template_id)`, the first
  `round(0.42 · n)` dev. **Salt** = the first orchestrator autosave on `claude/intelligent-hamilton-vg1f9a` after the rule
  commit: `f0b7281b4e0e3e277abd49ad96a0cfabec1cd22a` (23:25:43Z, 132 s later, "WIP: running agents' changes before the
  usage-limit pause"). `freeze-split.mjs` checks that `split.mjs` is byte-identical to the rule commit's blob.
- **Result:** 29 dev templates (290 shipped instances) and 40 held-out templates; per domain dev/held out 5/7, 5/6, 3/5,
  4/5, 9/12, 3/5 (analytics, calendar, CRM, email, multi_domain, project management).
  **Split sha256 `d88c5b5e6900e5a9c9d00e94c765bd38c411a511be592ba0223c9ff4520a6013`** (covers rule, salt, both template lists
  and both manifest hashes).
- **Generator seed control verified** (`REGEN-GATE.json`) [run]: WorkBench's own generators with seed 42 reproduce all six
  shipped CSVs byte for byte, twice; seed 8850 gives identical output twice. Regeneration with seed 8850 changes the gold
  of 460/690 instances and the text of 658/690; 2 templates never change their answer.
- **Sealed set: H4, 132 shipped instances** (3 per held-out template, 4 per held-out multi_domain template, by ascending
  `sha256(salt + instance id)`). Why not H2-ext: the rule's H2-ext selection (seed 8850, held-out templates, text-new,
  gold replays cleanly) changes the answers of 95/132 = 0.72 instances, below the rule's 0.80; so, by the rule, the shipped
  instances are the sealed set. Manifest sha256 `ed605b3f069ae730200d7647686149d73175aba9e88002f0a13a8c91afbfa27b`, content
  host-only (`/var/tmp/foundry-work/benches/workbench/host-only/sealed/MANIFEST.json`).
- **Fresh companion set** (not the primary; frozen beside it for PLAN §5.5 item 2, the shipped-vs-regenerated difference in
  differences): the 132 regenerated instances above (31 of 40 templates H2-ext by the rule's per-template label), sha256
  `efd2e9e83bbefabfaab4f4b77d357b85f4f8f16b9da906225ef838aba525de67`, host-only (`COMPANION.json`). Using it needs its own arm
  runs (about 132 × arms); decided with the portfolio dev gate.
- The shipped instances of held-out templates are public, with published per-task verdicts for 24 models; no dev work
  (card, screens, probes, anchor, F-kit looks) uses them. `run.mjs` refuses held-out ids in every dev pool and opens the
  sealed or companion pool only with `--sealed-ack wb-sealed-v1` and a manifest whose sha256 matches `SPLIT.json`.

## 6. Scripted $0 baselines (BG-2) and the hard-violation map (BG-11)

BASELINE_TABLE_PLACEHOLDER

## 7. $0 published-result pre-screen (`PRESCREEN.json`)

From `data/results/item_level_results.csv.gz` (run group `revisited_2026`, all tools; sha256 in the file), on the 290
shipped instances of the 29 **dev** templates only [run]:

| Model (published run, official harness, temperature 0) | Dev success | Dev harm rate | All 690 (published) |
|---|---|---|---|
| claude-haiku-4.5 | 74.8% | 18.6% | 74.8% |
| claude-sonnet-4.6 | 86.6% | 9.3% | 88.3% |
| claude-opus-4.8 | 94.5% | 4.1% | 96.2% |
| claude-fable-5 | 96.2% | 2.8% | 97.7% |

Frontier premium over Haiku 4.5 on dev: Sonnet 4.6 +11.8 points, Opus 4.8 +19.7, Fable 5 +21.4. Headroom rule (skip if both
≥ 0.90): not triggered for Haiku 4.5 vs Sonnet 4.6. These are older model versions in another harness: the screen prices the
premium; whether Haiku 5.5 vs Sonnet 5.5 still has one is what the paid A-H vs A-S screen (§8) measures. The **Haiku 4.5
anchor**: 40 dev instances fixed by a salt-keyed rule (ids and sha256 in `PRESCREEN.json`); the published Haiku 4.5 run
solved 29/40 of them.

## 8. Paid commands (not run; run from the repository root after merge)

Pre-flight for every paid command: `node experiments/breadth/workbench/probe-init.mjs` ($0, offline) if the CLI version
changed (the init check otherwise stops the first session at its init event, $0, as `CONFIG_MISMATCH`); the meter gate
applies automatically. Every runner journals meter readings and stops on any environment fault (exit 3) or gate (exit 4);
`--resume` with the same command continues. Estimates are list price [inf, from policy prices and token counts of the
facade's prompt: about 7K tokens of tool schemas and prompt per turn, 2–6 turns per task].

PAID_TABLE_PLACEHOLDER

## 9. Open items and known gaps

OPEN_PLACEHOLDER

## 10. Files

- Committed: this file; `SPLIT.json`, `REGEN-GATE.json`, `PARITY.json`, `PRESCREEN.json`, `INIT-PROBE.json`, `LEAK-PROBE.json`;
  code under `experiments/breadth/facade/` and `experiments/breadth/workbench/`; tests under `experiments/breadth/test/`.
- Host-only (`/var/tmp/foundry-work/benches/workbench/host-only/`): sealed and companion manifests, regenerated task sets,
  per-row parity verdicts, raw init events, every paid run's per-row records, transcripts and meter journals.
