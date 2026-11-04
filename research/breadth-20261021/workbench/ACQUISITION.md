# WorkBench (T1-1) and the shared bed facade v0: acquisition, $0 gates, frozen split, runbook

2026-10-22 (work began 2026-10-21 23:14Z; extras rule and fault injector 2026-10-28; full $0 gate run, init re-freeze
and this revision 2026-11-04, after two usage-limit pauses). **Development and diagnostic evidence only; $0, no model was
called.** The paid commands in §8 have not been run. Plan: [PLAN.md](../PLAN.md) §4.3 T1-1, §5.1–§5.5; rule D16
([decisions](../../decisions-20261021.md)); downloads and disposals: [DISPOSALS.md](../DISPOSALS.md).

Evidence labels: **[code]** observed in the pinned clone (path:line); **[doc]** a documentation claim; **[run]** measured
here ($0); **[inf]** inference.

**At a glance (2026-11-04).** Parity through the facade: gold 690/690 and do-nothing 124/690, each verdict equal to the
benchmark's own evaluator on the same actions (1,380/1,380), identical digest on two runs; mutation operators wrong
argument, extra write and duplicate write 100% killed; sealed and companion gold 132/132 each. Frozen split `d88c5b5e…`
(29 dev / 40 held-out templates; sealed = 132 shipped instances, H4). Two findings that bind the paid runs: the official
evaluator rejects some valid answers on 13 templates (BG-6, §4.2), and it cannot see a write undone before the end
(BG-11, §6.2). Not done: the extras freeze (no salt yet, §5.1) and every paid command (§8; the disk is now under the
runner's 1 GB floor).

## 1. Provenance (BG-0)

| Item | Value |
|---|---|
| Source | https://github.com/olly-styles/WorkBench (read 2026-10-21 and 2026-10-22), commit `49c7dfd00c03d384ec59ea57374f50b766aa5613`, HEAD date 2026-08-18 |
| Acquisition | shallow (depth 1) blobless fetch of that commit (`partialclonefilter = blob:none`), no LFS or submodules, 2026-10-21 23:14Z, into `/var/tmp/foundry-work/benches/workbench/src` (67 MB) |
| Licence | MIT, "Copyright (c) 2024 Mindsdb" (`LICENSE`, sha256 `e8bbcabb…717e26b`) [code]; LICENSE kept in the clone |
| Paper | https://arxiv.org/abs/2405.00823 (cited by `README.md:23`) [doc]; "WorkBench Revisited (2026)" write-up `retro/main.pdf` (`README.md:3-19`) [doc] |
| Runtime | 8 hash-pinned wheels from `uv.lock` (`uv.lock` sha256 `ef9a825a…2717e26b`), `uv pip install --no-index --only-binary :all: --require-hashes --no-deps`, CPython 3.12.3 venv (uv 0.11.32), 121 MB; URLs, sizes, sha256 and licences in DISPOSALS. Why 8, not the earlier probe's 9: DISPOSALS |
| Disk | 230 MB in all on 2026-11-04 14:45Z (src 67, venv 121, wheels 29, host-only 15, work 0.6) against D16's 500 MB; free disk 2.9 GB at 02:52Z on 10-22, 2.0 GB at 12:23Z on 11-04 when the gate run started, **0.7 GB at 14:43Z** after other agents' acquisitions (`appworld/` 374 MB appeared meanwhile); breadth benches in total 797 MB against 1.5 GB |
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
| Scripted client | `scripted-client.mjs` | a $0 MCP client that starts the relay exactly as the CLI's `--mcp-config` entry does; an optional reaction policy (retry, repair) |
| Faults and drift | `faults.mjs` | a declared per-session fault (`transient`, `lost_ack`) or drift (`rename_param`, `distractor`) applied by the host; grading unchanged; never an environment fault (added 2026-10-28, §5.1) |

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
   `mcp_servers: []` and 0 tools with it, and `workbench: connected` with 27 + 1 tools without it [run, 2026-10-22]. The
   CLI moved to **2.1.312** during the six-day pause (D31); the re-freeze on 2026-10-28 (`INIT-PROBE.json`, $0 offline)
   changed only `cliVersion` in all four arm fingerprints, and its `safeModeCheck` shows `--safe-mode` still drops the bed
   server on 2.1.312 [run]. The CLI moved again, to **2.1.318**, during the second pause (10-28 to 11-04); the re-freeze on
   2026-11-04 12:28Z ($0 offline) changed `cliVersion` and added one built-in plugin, `cc-plugin-privacy@builtin`, to all
   four fingerprints (tools 28 = 27 bed + `python`, built-in tools 0, MCP servers `workbench: connected`, skills and slash
   commands empty, agents unchanged), and `--safe-mode` still drops the bed server on 2.1.318 [run]. Its
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

`node experiments/breadth/workbench/parity.mjs` (2026-11-04 13:12–14:42Z, concurrency 3, every set on its full
population; `PARITY.json` holds the aggregates and, per set, the time and the sha256 of the eight files that produced
it; per-row verdicts host-only in `host-only/parity/`). Two invocations: gold, do-nothing, mutants, variants and
baselines (13:12–14:10Z), then violations and sealed (14:13–14:42Z) after the case-only probe fix (`7d84acde`; the
earlier sets ran with `baselines.mjs` `dc1cc629`, commit `32efdc51`, whose other builders are unchanged). An earlier full
attempt the same day stopped at its first grading step (three 460-row grade processes hit a 30-minute cap at load 47 on 4
cores; nothing had been graded); grading now runs in chunks of at most 120 rows (`lib.mjs` `bedChunked`).

**Path:** a scripted MCP client starts the relay exactly as the CLI's `--mcp-config` entry does → `mcp-relay.mjs` (stdio JSON-RPC) → mailbox → `host.mjs` → `bed.py serve` (pinned venv,
`python -I`, `unshare -rn`) → live world; graded afterwards, host-side, by WorkBench's own `is_correct` in a separate bed
process. **Parity** means: each facade verdict equals the evaluator-level verdict on the same action list, computed by
`bed.py replay` with no facade (the benchmark's own `is_correct` on its own `function_calls` strings). Two further
cross-checks per row: an independent executor's verdict (`native`) and the live end-state digest against a replay of the
logged actions (`live = replay`).

### 4.1 Gates

| Gate | Check | Result [run unless marked] | Verdict |
|---|---|---|---|
| BG-0 provenance | URL, SHA, licence, sizes, dates | §1 and DISPOSALS | pass |
| **BG-1 gold replay** | all 690 shipped gold lists through the facade | **690/690 correct**; parity 690/690; native 690/690; live = replay 690/690; logged actions identical to the issued ones 690/690; 0 environment faults, 0 rejected calls. Gold length (horizon covariate): 0 actions on 122 tasks, 1 on 416, 2 on 88, 3–12 on 64 (max 12, mean 1.37). Per domain 120/120, 110/110, 80/80, 90/90, 210/210, 80/80 | pass |
| BG-1 sealed sets | the 132 primary and 132 companion instances, gold and do-nothing, twice | primary (manifest `ed605b3f…`): gold **132/132**, parity 132/132, native and live = replay 132/132; do-nothing 21/132 (state-changing subset 111). Companion (`efd2e9e8…`): gold **132/132**, do-nothing 22/132 (110). Both runs identical digests. Aggregates only; scripted, no model saw them | pass |
| **BG-2 do-nothing floor** | no tool call | **124/690 (18.0%)**, parity 690/690 (dev templates 64/290 = 22.1%). Per domain: analytics 40/120, calendar 11/110, CRM 10/80, email 1/90, multi_domain 41/210, project management 21/80. 122 floor passes are empty gold lists; 2 are held-out instances whose non-empty gold leaves the state unchanged. **State-changing subset: 566 tasks** (the floor's failures) | reported; floor > 10%, so the state-changing subset is a co-headline (PLAN §5.4) |
| **BG-3 mutation** | wrong argument, extra write, duplicate write (+ the earlier drop-last), every applicable gold list | **wrong_argument 568/568 killed; extra_write 690/690; duplicate_write 333/333 non-equivalent killed** (235 more duplicates leave a world identical to gold's, exact text, e.g. a repeated update to the same value: true equivalent mutants, excluded from the rate, all passed); drop_last 566/566 (2 equivalent). **New-operator kill rate 100%** (threshold 95%); parity 2,394/2,394; the BG-6 comparator kills the same 100% | pass |
| **BG-4 determinism** | gold + do-nothing (1,380 items) twice | digest `f14c7803…26a036b9` both runs, identical (per key: verdict, native verdict, live end-state digest, logged actions) | pass |
| BG-5 judge-free | no LLM judge in the reward | state comparison only (`src/evals/evaluation.py:174-230`) [code] | pass |
| **BG-6 alternative-valid answers** | 1,429 constructed variants that keep the outcome (§4.2) | official `is_correct` accepts **1,177/1,429**; it rejects every variant of 4 classes; the BG-6 comparator (`correct_sem`) accepts 1,429/1,429 | **fails for the official evaluator** (§4.2); fix frozen (BG-10) |
| BG-7 evaluator defaults | the evaluator reads the agent's actions, not its inputs; every item parses | `is_correct` replays the predicted `function_calls` strings (`evaluation.py:174-200`) [code]; every gold list parses and executes (BG-1); a malformed call ends the run as officially (`inference.py:87-140`, facade test) | pass |
| BG-8 leakage from inside | gold, manifests, verdicts unreachable from the session and from the `python` tool | `LEAK-PROBE.json` (10-22): nothing visible from the sandboxed session or the python tool, which has no network and no DNS | pass |
| BG-9 ABC row | Agentic Benchmark Checklist | §4.3 | written |
| BG-10 oracle frozen first | any oracle fix frozen before a dev look | the only fix is the BG-6 comparator `sem_digests` in `bed.py` (sha256 `ab052002…`, commit `ff9c3b9c`), frozen before any WorkBench model run; it is reported beside `is_correct`, never instead | pass |
| BG-11 hard-violation map | per violation class, does the primary outcome fail? | §6.2 | written |

### 4.2 BG-6: valid answers the official evaluator rejects

`bed.py variants` builds, per gold list, variants a reader of the task would accept as the same outcome; each is replayed
through the facade and through the evaluator. All 1,429 have the same end state as gold in the semantic view (rows
created during the task matched by content, date-times as instants, numbers as numbers, the official chart end-date
tolerance) [run].

| Variant | n (templates) | Official accepts | Note |
|---|---|---|---|
| reads interleaved (a search before every write) | 568 (69) | 568 | |
| e-mail address in capitals | 297 (35) | 297 | case-insensitive by design |
| update reached in two steps | 127 (16) | 127 | |
| two edits of one table reordered | 91 (16) | 91 | |
| chart ending today instead of yesterday | 56 (10) | 56 | accepted by design (`evaluation.py:45-76`) |
| two writes on different tables reordered | 37 (5) | 37 | |
| **two creations on one table reordered** | 11 (2) | **1** | the generated IDs swap, so the rows differ; README:64 calls the comparison "order-independent" [doc], which holds across tables and for edits, not for creation order within a table [run] |
| **date-time with a `T` separator** | 84 (12) | **0** | 74 deviate from a format the tool documentation states (`create_event.event_start`); 10 are `update_event` `new_value`, whose format is not stated |
| **date-time without seconds** | 84 (12) | **0** | same split, 74 / 10 |
| **whole number as a decimal** (`30.0`) | 74 (11) | **0** | `duration`; no format stated |

Rejections where the tool documentation states no format (or the reorder): 104 variants on **94 instances of 13
templates** (54 instances of 7 dev templates). Consequence for the claim: an arm can be marked wrong for a valid answer
on these templates, in either arm. Rule adopted here (BG-10, frozen before any model run): the primary outcome stays the
official `is_correct` (comparable with the 24 published runs), and every paid summary also reports `correct_sem`; a
margin that changes sign between the two is reported as evaluator-dependent. The owner may instead name `correct_sem`
primary in the preregistration; either choice is fixed before the sealed run.

### 4.3 BG-9: Agentic Benchmark Checklist row

Checklist: Zhu et al., "Establishing Best Practices for Building Rigorous Agentic Benchmarks", arXiv 2507.02825 v5
(https://arxiv.org/abs/2507.02825, read 2026-10-28), with the repository's `ABC.md`
(https://github.com/uiuc-kang-lab/agentic-benchmarks, read 2026-10-28), which numbers the same items I.x (outcome),
II.x (task) and III.x (reporting). Item wording below is paraphrased [doc]; WorkBench is not in that repository's assessed
list [doc]. Only the state-matching outcome items apply (no string matching, judge, unit or fuzz tests).

| Item | Check | WorkBench through the facade | Evidence |
|---|---|---|---|
| T.1 tool versions | versions fixed | tools are in-process functions of the pinned commit; 8 hash-pinned wheels | §1 [code] |
| T.2 API availability | no outage or rate limit can fail a task | no external API; the bed runs network-off | `bed-process.mjs` [code] |
| T.3 interruptions | detected, never scored | bed, python sandbox, CLI or init faults are environment faults: the run stops (exit 3) and `--resume` reruns them | `run.mjs`, `run.test.mjs` [run] |
| T.4 clean state | reset before each task | `reset` per task; identical digests over two full runs (BG-4) | §4.1 [run] |
| T.5 isolation from ground truth | agent cannot reach gold | the relay knows the tool list only; gold, manifests and grader are host-side; BG-8 probe | `LEAK-PROBE.json` [run] |
| T.6 frozen environment | reproducible | pinned clone and wheels; seed 42 regenerates the shipped CSVs byte for byte; the date is fixed to 2023-11-30 | `REGEN-GATE.json` [run] |
| T.7 ground truth verified | gold correct | gold replays 690/690, sealed 132/132 and companion 132/132; **6 dev instances fail all four strongest published models: 4 are ambiguous task texts (2 templates), 2 unresolved (growth window)** | `OUTLIERS.json` [run + inf] |
| T.8 task setup verified | every task solvable | gold through the facade 100% | §4.1 [run] |
| T.9 oracle solver | exists | the gold action lists, replayed through the facade | §4.1 [run] |
| T.10 outliers inspected | pilot outliers read | 0 dev and 1 held-out instance unsolved by all 24 published models; 6 dev and 1 held-out failed by all four strongest; the dev ones read (T.7), the held-out one counted only | `OUTLIERS.json` [run] |
| O.g.1 all successful end states | every valid outcome accepted | **fails in part (BG-6)**: creation order within a table, two date-time formats and a whole number written as a decimal are rejected (94 instances, 13 templates, where no format is documented); the frozen BG-6 comparator accepts them | §4.2 [run] |
| O.g.2 relevant and irrelevant state | collateral changes caught | all five mutable tables compared; extra writes, wrong arguments and non-idempotent duplicates 100% killed; a write undone before the end is not seen | §4.1, §6.2 [run] |
| O.g.3 resists trivial changes | trivial agents fail | do-nothing passes the 18.0% of tasks whose gold changes nothing; constant 0.6%, constant per domain 2.3%, sibling replay 8.7% | §6.1 [run] |
| O.h.1 format stated | formats specified | stated for `create_event.event_start`, `create_task.due_date` and the CRM dates; not for `update_*` `new_value` or `duration` | `bed.py` `DOCUMENTED_FORMAT` [code] |
| O.h.2 no success by guessing | | floors in §6.1 | §6.1 [run] |
| O.c judge | none | no LLM judge (BG-5) | `evaluation.py:174-230` [code] |
| R.1, R.2 open data and harness | | MIT; data and evaluator in the repository | §1 [doc] |
| R.3, R.4 contamination and updates | | data and 24 models' per-task outputs public (2024–2026); the "Revisited" release is an update; our controls: the probe battery (paid, §8), the regenerated companion set and the reuse streams | §5, §8 [doc + run] |
| R.5–R.9 capabilities, validity, limits | | the write-up states capabilities and side-effect harm; README:64 calls the evaluator "order-independent", which BG-6 shows holds across tables and for edits, not for creation order within a table | README:64 [doc] vs §4.2 [run] |
| R.10, R.11 significance, interpretation | | not in the README; our runs report paired intervals (PREREG) | [doc] |
| R.12 non-AI baseline | | none published | [doc] |
| R.13 trivial agents | | not published; ours: do-nothing, constant, constant per domain, sibling replay | §6.1 [run] |

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

### 5.1 Extras: reuse streams and the fault/drift subset (rule `wb-extras-v1`)

PLAN §4.3 T1-1 lists two extras for after the dev gate: reuse streams (20 held-out templates × 10 instances) and a
fault/drift subset (20 units). Their selection rule (`extras.mjs`) was committed alone in `e6903007` (2026-10-28
18:25:57Z), before its salt existed and before any WorkBench model run; `freeze-extras.mjs` applies it, and
`extras-parity.mjs` runs their $0 gates. Salt = the first orchestrator autosave (`WIP:`) on
`claude/intelligent-hamilton-vg1f9a` after the rule commit.

- **Streams.** Per domain, half the held-out templates (largest remainders: analytics 4, calendar 3, CRM 3, email 2,
  multi_domain 6, project management 2) by `sha256(salt + ':stream:' + template)`; per template the first 10
  WorkBench-generated instances (seed 8860, top-up 8861–8869, the shipped world) whose text is new (not shipped, not
  sealed or companion, not earlier in the stream) and whose gold replays cleanly, in generator order (the arrival order).
  H2-ext by construction (new text; how many answers change is reported per stream as the naive-reuse exposure).
- **Faults.** The state-changing instances of the primary sealed manifest, by `sha256(salt + ':fault:' + id)`, first 20;
  kinds in rotation `transient`, `lost_ack`, `rename_param`, `distractor` (§3, `faults.mjs`), each aimed at gold's first
  write. Paired with the same instances' clean sealed runs: robustness = clean minus faulted success, per arm.

**Status (2026-11-04 12:35Z): not frozen, because the salt does not exist yet.** After the rule commit the salt ref has
three commits (`fc62b5b3`, 10-28 18:44:35Z; `a3d10c42` and `fd345427`, 11-04 12:18Z), none an autosave (`WIP:`), so
`freeze-extras.mjs` exits 2 ("the salt does not exist; nothing frozen") [run]. The 10-28 rescue bundle holds worktree
branches only, not salt-ref commits [doc: `research/session-20261028-rescue/README.md` at `fd345427`]. A dry run on
10-28 with an unreferenced test salt filled all 20 streams from seeds 8860–8862 (19 text duplicates skipped, no gold that
failed to replay) and 5 units of each fault kind [run]; those picks are void, and nothing was frozen from them.
When the first autosave lands, in this order ($0):

1. `node experiments/breadth/workbench/freeze-extras.mjs` writes `EXTRAS.json` (rule, salt, stream template ids, counts,
   per-stream reuse exposure, both manifest sha256) and the host-only manifests; it refuses to overwrite a different
   freeze.
2. `node experiments/breadth/workbench/extras-parity.mjs` runs their gates through the facade: stream gold replay, the
   do-nothing floor and two naive-reuse floors (copy the first, copy the previous gold); each fault unit's gold under
   three scripted reaction policies (naive, blind retry, robust): a fault has teeth when some policy fails it and is fair
   when the robust policy passes every unit (`EXTRAS-PARITY.json`, counts only).

Rows 9 and 10 of §8 need both; `run.mjs` refuses the `streams` and `faults` pools until `EXTRAS.json` and the host-only
manifests agree by hash.

## 6. Scripted $0 baselines (BG-2) and the hard-violation map (BG-11)

### 6.1 Baseline agents (BG-2)

Scripted, through the same facade path as §4, graded by the official `is_correct`; parity with the evaluator-level
verdict 690/690 for every agent [run]. The constant agents are fitted on dev-template instances only (`SPLIT.json`), so
their dev numbers are in-sample; nothing here was tuned on held-out templates.

| Agent | Definition | All 690 | State-changing 566 | Dev 290 | Held-out shipped 400 | Official side-effect flag |
|---|---|---|---|---|---|---|
| do-nothing | no tool call | 124 (18.0%) | 0 | 64 (22.1%) | 60 (15.0%) | 0 |
| constant | the modal non-empty dev gold list on every task (two calendar deletions) | 4 (0.6%) | 4 (0.7%) | 4 (1.4%) | 0 | 686 |
| constant per domain | its domain's modal non-empty dev gold list | 16 (2.3%) | 16 (2.8%) | 16 (5.5%) | 0 | 556 |
| replay (naive reuse) | the gold list of one sibling instance of the same template (sha256-chosen) | 60 (8.7%) | 8 (1.4%) | 34 (11.7%) | 26 (6.5%) | 478 |

Reading [inf]: the do-nothing floor (18.0%) is the only trivial agent above 10%, so every paid margin is also reported on
the 566 state-changing tasks, where all four agents score at most 2.8% (16/566, constant per domain, fitted in-sample). Copying a sibling instance's solution almost
never works on state-changing tasks (8/566): instances of one template differ in their arguments, so a reuse layer has
to adapt, not replay; that floor is what F-reuse must beat on the reuse streams (§5.1).

### 6.2 Hard-violation map (BG-11)

Each probe is gold plus one violation (or gold rewritten), on every applicable task, through the facade [run; parity
with the evaluator 690/690, 690/690, 79/79, 690/690, 690/690 on the five probe kinds run here; the other three rows are
the BG-3 mutants of §4.1]. "Fails" is the official `is_correct`.

| Violation | Hard? | n | Primary outcome fails | Official harm flag | Note |
|---|---|---|---|---|---|
| e-mail to a non-task address (the operator's, synthetic `operator@account.invalid`; C7) | yes | 690 | **690/690** | 690 | a leak to the account owner is caught |
| collateral deletion of an untouched record (`extra_write`) | yes | 690 | **690/690** | (BG-3) | |
| wrong record or value written (`wrong_argument`) | yes | 568 | **568/568** | (BG-3) | |
| duplicate effect (`duplicate_write`) | yes | 333 non-equivalent | **333/333** | (BG-3) | 235 more duplicates are idempotent (same world): not a harm |
| **transient write, undone before the end** (an untouched task moved to another board and back) | yes | 690 | **0/690** | 0 | **blind spot**: a state-exact end-state oracle cannot see a violation that is reverted before the end; only the journal can |
| upper-cased e-mail body | no | 79 | 0/79 | 0 | tolerated by design (case-insensitive fields) |
| an extra chart | no (charts are excluded from harm) | 690 | 690/690 | 486 | it is a state change, so it fails the outcome |
| three extra searches before gold | no | 690 | 0/690 | 0 | reads are free |

Two facts about the official harm metric [code: `evaluation.py:203-230`]: it is set only on wrong runs, and it means "a
wrong run changed any of the four non-chart tables", so it also counts the task's own legitimate writes (the 486 extra-chart
runs above are the tasks whose gold writes outside charts). It is not a collateral-damage measure. For BG-11 every paid
run therefore also keeps the host journal of world calls, from which transient writes and writes to records the task did
not name can be counted; that count is not built yet (§9).

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
changed (the init check otherwise stops the first session at its init event, $0, as `CONFIG_MISMATCH`); at least 1 GB
free at the bench root (`DISK_FLOOR_BYTES`: below it the runner starts no session and exits 4; at 14:50Z on 11-04 the
disk had 0.66 GB free, so every command below would stop at once, $0, until other items free space); the meter gate
applies automatically. Every runner journals meter readings and stops on any environment fault (exit 3) or gate (exit 4);
`--resume` with the same command continues. Estimates are list price [inf, from policy prices and token counts of the
facade's prompt: about 7K tokens of tool schemas and prompt per turn, 2–6 turns per task].

| # | What | Command | Estimate | Cap |
|---|---|---|---|---|
| 1 | Day-1 meter reading (R0-RUNBOOK G5; quiet account) | `node research/jit-20261008/analysis/quota-meter/probe-meter.mjs --iterations 1 --interval-s 1 --max-calls 1 --max-usd 0.06 --log /var/tmp/foundry-work/meter.jsonl` | ≈ $0.001 | $0.06 |
| 2 | Dose test on real WorkBench sessions: A-H on 40 dev tasks; the summary gives $ per 0.01 tick for both windows (one tick ≈ $0.2 of Haiku list cost, so cents cannot move it) | `node experiments/breadth/workbench/run.mjs --probe dose --arms A-H --sessions 40 --cap 1` | $0.2–0.65 | $1 |
| 3 | Identity probes (C7): one "what is my e-mail address?" call per arm configuration; pass = no foreign address | `node experiments/breadth/workbench/run.mjs --probe identity --arms A-H,A-S,A-O,H45 --cap 0.6` | ≤ $0.15 | $0.6 |
| 4 | Harness-parity anchor: Haiku 4.5 through the A-H harness on the 40 anchor dev instances vs the published verdicts (29/40); a gap above 10 points is reported as a harness difference | `node experiments/breadth/workbench/run.mjs --arms H45 --pool anchor --cap 4` | $1.5–3 | $4 |
| 5 | A-H vs A-S screen, 40 pairs on dev (headroom and assay, PLAN §8.4) | `node experiments/breadth/workbench/run.mjs --arms A-H,A-S --pool screen --n 40 --cap 8` | $4–5.5 | $8 |
| 6 | Contamination probe battery: Haiku, Sonnet and Opus 5.5 (effort low) on 100 shipped dev items vs 100 never-published controls, continuation and slot probes, one-sided Fisher at 0.05 | `node experiments/breadth/workbench/contam-probe.mjs --cap 10` | $5–9 (dry run: 1,200 calls, $8.6 at conservative per-call prices) | $10 |
| 7 | Bed card: one Opus 5.5 xhigh call on the numbered public pack (README, tool schemas, evaluator, one instance per dev template); unsourced bullets removed by the $0 filter; read before freezing | `node experiments/breadth/workbench/card.mjs --cap 5` | $0.3–1 | $5 |
| | Dev subtotal (of the $40 dev cap; F-kit dev looks, up to $15, need F-kit v1, which is not part of this item) | | ≈ $11–19 | $28.7 |
| 8 | **After the portfolio dev gate only:** sealed A arms (A-H on all 132, A-S on the first 77 and A-O on the first 20 of the salt-keyed order), card appended; A-O waits for D19 (after the SOP-Bench sealed run) | `node experiments/breadth/workbench/run.mjs --arms A-H,A-S,A-O --pool sealed --sealed-ack wb-sealed-v1 --arm-n A-S=77,A-O=20 --card research/breadth-20261021/workbench/CARD.md --cap 35` | ≈ $17 (+ F-H ≈ $6 once built ≈ $23) | $35 |
| 9 | **After the gate, needs EXTRAS.json (§5.1):** reuse streams, A-H on the 200 stream instances in arrival order (F-H and A-HN join when built: PLAN's ≈ $17 line) | `node experiments/breadth/workbench/run.mjs --arms A-H --pool streams --sealed-ack wb-sealed-v1 --card research/breadth-20261021/workbench/CARD.md --cap 6` | ≈ $3.2 | $6 |
| 10 | **After the gate, needs EXTRAS.json:** fault/drift subset, A-H and A-S on the 20 faulted units (paired with the same units' clean sealed runs, row 8) | `node experiments/breadth/workbench/run.mjs --arms A-H,A-S --pool faults --sealed-ack wb-sealed-v1 --card research/breadth-20261021/workbench/CARD.md --cap 5` | ≈ $2.7 | $5 |

Per-task list-price assumptions (`EST_PER_TASK` in `run.mjs`): A-H $0.016, A-S $0.12, A-O $0.30, H45 $0.075; per-session
budgets (`--max-budget-usd`) $0.25, $1.50, $4.00, $0.60. Haiku 5.5 is likely nearer $0.005 per task [inf: about 7K
prompt tokens written once and read back per turn at $0.125 and $0.01 per MTok, plus 1–6K output tokens at $0.50 per MTok].
`--dry-run` on any command prints the selection, the system prompt and the estimate at $0.

## 9. Open items and known gaps

1. **C7 engine fix** (strip or declare the account identity in the CLI provider) has not landed; until it does, the
   declared synthetic identity, the foreign-address audit and the identity probe (§8 row 3) are the controls, and runs
   before the probe are diagnostic (PLAN §5.2).
2. **The CLI is not pinned by hash** (compromise C2). The init check freezes `claude_code_version` (2.1.307 on 10-22,
   2.1.312 on 10-28, 2.1.318 on 11-04: it moved during both pauses), so an auto-update stops the next session at its init
   event ($0); re-freeze with `probe-init.mjs` and record the change. A paid run whose arms span two CLI versions is
   reported per version.
3. **BG-6 fails for the official evaluator** (§4.2) on 13 templates; the primary/secondary choice between `is_correct`
   and `correct_sem` must be fixed in the preregistration before the sealed run (this file adopts `is_correct` primary,
   `correct_sem` co-reported). Not measured: a different but valid set of writes (another free slot, another wording of
   an e-mail), which both comparators reject.
4. **Not built in this item** (later, after the portfolio dev gate): the F-H arm (needs F-kit v1; the facade takes the
   Foundry MCP server as a second entry of the same `--mcp-config`, and the init check then expects both servers), A-HN
   (Haiku + notes). The reuse streams and the fault/drift subset now have a committed selection rule, a host-side
   injector (`faults.mjs`) and $0 gates (§5.1), but are **not frozen**: their salt does not exist yet.
5. **Interleaving with A-O:** D19 holds Opus arms until the SOP-Bench sealed run ends; `run.mjs` runs all arms of a unit
   together, so a sealed WorkBench run waits until A-O may run (PLAN §5.2).
6. The **probe battery's** slot probe guesses template parameters drawn from small pools (weekday names, first names); the
   shipped-vs-control comparison, not the raw hit rate, is the signal.
7. The **bed card** is built from benchmark text (untrusted data) and goes into every arm's system prompt: read it before
   freezing its sha256.
8. **Collateral-write count** (BG-11): the official harm flag counts any write of a wrong run, and a transient write that
   is undone is invisible to the end state (§6.2). A count of writes to records the task does not name, from the host
   journal, is not built; until it is, harm is the official flag plus the journal kept host-side.
9. **Haiku 4.5 availability**: the policy keeps `claude-haiku-4-5-20251001` "for earlier pilots and tests only"
   (`policy/models.json`); if the CLI no longer serves it, the anchor (§8 row 4) stops at its first session as an
   environment fault ($0 beyond that session) and the harness-parity check has no anchor.

## 10. Files

- Committed: this file; `SPLIT.json`, `REGEN-GATE.json`, `PARITY.json`, `PRESCREEN.json`, `INIT-PROBE.json`, `LEAK-PROBE.json`,
  `OUTLIERS.json` (dev readings; held-out outliers counted only);
  code under `experiments/breadth/facade/` and `experiments/breadth/workbench/`; tests under `experiments/breadth/test/`.
- Host-only (`/var/tmp/foundry-work/benches/workbench/host-only/`): sealed and companion manifests, regenerated task sets,
  per-row parity verdicts, raw init events, every paid run's per-row records, transcripts and meter journals.
