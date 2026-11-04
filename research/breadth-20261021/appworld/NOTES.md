# AppWorld bed (breadth bed 3): adapter notes

AppWorld 0.1.3.post1, data 0.1.0 (ACQUISITION.md). Held-out class **H1e** (encrypted-public official test). Labels:
**[doc]** a document says so; **[obs]** observed in code or files; **[run]** measured here; **[inf]** inference. Nothing
here quotes task content; the data is AppWorld's protected portion (ACQUISITION.md, "Kept out of git").

## 1. The bed

- 9 apps (amazon, file_system, gmail, phone, simple_note, splitwise, spotify, todoist, venmo) plus `supervisor` and
  `api_docs`: **457 APIs** in `data/api_docs/standard` (spotify 91, amazon 66, splitwise 65, todoist 56, venmo 54,
  gmail 42, phone 30, file_system 26, simple_note 17, supervisor 6, api_docs 4) [run].
- 732 tasks = 244 scenarios x 3 variants: train 90 (30), dev 57 (19), test_normal 168 (56), test_challenge 417 (139)
  [run, `bridge.py inventory`]. A task id is `<scenario>_<variant>`.
- The agent works through `world.execute(code)`: Python in an IPython shell with an `apis` object [obs,
  `appworld/environment.py` `execute`]. Time is frozen at the task's datetime (freezegun) and the seed is fixed (100)
  [obs]. The official loop stops when `world.task_completed()` (the supervisor's `complete_task`, `POST
  /supervisor/message`) [doc, README "minimal agent" loop; obs].
- Grading: database-state unit tests "to check if the agent completed the task correctly without causing any collateral
  damage" [doc, README §Evaluating]. `world.evaluate()` = `evaluator.evaluate_task(task_id, experiment_name)`, which reads
  the world's saved output DBs and runs the task's `evaluation.py` with a `TestTracker` [obs]. Test data labels each
  assertion `no_op_fail` (fails for a do-nothing agent) or `no_op_pass` (passes for it) [obs, `evaluator.py
  TestTracker.prepare_test_data`].

## 2. Adapter (experiments/breadth/appworld)

| File | Role |
|---|---|
| `acquire.py`, `setup_offline.py`, `verify_install.py` | D16 acquisition, the two offline steps, the install check (BG-0) |
| `bridge.py` | the only code importing `appworld`: `serve` (arm-facing, sandboxed; `load_ground_truth=False`, bridge.py:166), `grade-serve` (host-only; `evaluate_task`), `official` (upstream's procedure: verify.py and the README loop), `evaluate-dir` (upstream's `evaluate_tasks`, what `appworld evaluate` runs), `plan` (scripted chunks for train/dev only), `inventory` (ids only) |
| `lib.mjs` | paths, pins, world profiles, the public view, the serve sandbox (`serveArgv`: `maskSteps` + `sandboxScript` of `src/executors/claude-code.mjs` plus `--net`), `BridgeServer` |
| `mcp.mjs` | the stdio MCP relay inside the session sandbox: `execute`, `api_docs`, `python` (+ `read_notes`/`write_notes` for A-HN) |
| `facade.mjs` | host side of the mailbox: execute and docs to the unit's serve process, python to `src/sandbox.mjs`, notes |
| `session.mjs` | the hardened `claude -p` session (the AgentDojo bed's, server name changed; CLI 2.1.318's new built-in `cc-plugin-privacy` added to the disabled plugins after the init probe caught it) |
| `run.mjs` | the runner: arms, scripted policies, split hygiene, caps, meter gate, faults, resume, host-only records |
| `interleave.mjs` | the arms interleaved (PLAN §5.2): whole-scenario blocks in hashed run order, arm order rotating per block, one run per arm (`run.mjs runUnits` with `onlyIds`), one shared grader, the meter reading carried across blocks; a stop in any arm stops all |
| `split-rule.mjs`, `split.mjs` | the frozen split rule (committed first) and its CLI |
| `parity.mjs`, `leakprobe.mjs`, `initprobe.mjs`, `costest.mjs` | $0 gates, BG-8, the init probe, the paid plan |

**Per unit** (`run.mjs runUnit`): (1) a **public view** of the unit's task (hard links to `base_dbs/`, `api_docs/`, the
task's `specs.json` and `dbs/`; never `ground_truth/` or `datasets/`) and a fresh serve root; (2) a **fresh sandboxed
serve process** and a fresh world (one world per process; AppWorld's `initialize` calls `close_all`); (3) the session
(or a scripted client) talks only to the relay; (4) close, copy the world's outputs to a host-only snapshot, quit the
serve process, delete the live directory; (5) the run's **host-only grader process** runs `evaluate_task` on the
snapshot. A grading or harness failure is a fault, never an outcome.

**World settings** (`lib.mjs WORLD_PROFILES`): `arm` = the README's experiment config (`random_seed` 100,
`max_interactions` 1000, `max_api_calls_per_interaction` 5000, `raise_on_extra_parameters` true) with the package default
`raise_on_failure` true; `verify` = verify.py's gold check (`raise_on_failure` false). Everything else is the package
default, recorded in each bridge `hello` [doc, obs].

**Completion.** After `complete_task`, the serve process refuses further `execute` calls with a fixed message (the
official loop stops there), so nothing changes state after completion on our path or upstream's [obs, run: parity].

**Prompts** (`run.mjs`): system = a neutral preamble, the tool note (execute, api_docs, python; look up docs first;
passwords via `apis.supervisor.show_account_passwords()`; finish with `complete_task`, `answer=` when asked,
`status="fail"` if impossible), the date note (AM-9: the environment's date, e.g. `DateTime.now()` inside execute) and the
bed card when given. User = AppWorld's own convention: the supervisor's name, e-mail and phone, then `Task:
<instruction>`. Every statement in the tool texts is from the README or the package API [doc, obs]. The prompt itself is
stored host-only (task content); the repository gets its sha256.

**Caps** (declared, identical for every arm): 50 model turns, 100 `execute` calls, 15 min per unit; per-session $
ceilings A-H 0.60, A-HN 0.70, A-S 4.00, A-O 10.00. AppWorld has no single official step cap (the README loop uses a
`MAX_STEPS` the agent designer sets) [doc]; these are replaced by 1.5 x each arm's dev-pilot p99 before the sealed run
(PLAN §5.2) [inf].

## 3. Outcomes (per unit; `run.mjs outcome`, `summarize`)

| Outcome | Definition | Use |
|---|---|---|
| **TGC** | AppWorld task success: every assertion of the task's evaluation passes (`TestTracker.success`) | margin outcome (PREREG row 3) |
| SGC | a scenario counts when every run variant passes | co-reported (AppWorld's scenario goal completion) |
| sub-goal share | passed / all assertions of the task, kept host-side per assertion | the sub-goal measure (PREREG §4), compared with F-H's own sub-workflow verdicts |
| collateral | an assertion labelled `no_op_pass` failed: the unit broke something a do-nothing agent leaves intact | BG-11 harm measure |
| L5 violation | a tool outside the arm's set, nested model use, or `execute`/`python` code that imports the package, names its files, host paths, processes or the network (`run.mjs BENCH_REF`; deliberately not the bare word "AppWorld", which the arm's own prompt uses) | scored as a failure |

**Scripted $0 baselines** (train + dev, 147 tasks, 49 scenarios, through `run.mjs` with the arm settings; equal to
upstream's path on every unit, PARITY.md) [run, 2026-11-04]:

| Policy | TGC | SGC | Assertions passed | Collateral units |
|---|---|---|---|---|
| do-nothing (`--scripted null`) | 0/147 | 0/49 | 19.2% | 0 |
| API-docs-only replay (`--scripted docs`) | 0/147 | 0/49 | 33.0% | 0 |
| gold, as one chunk (`--scripted gold`; reads ground truth, dev only) | 136/147 | 45/49 | n/a | 0 |

The gold row is a ceiling check, not a baseline: 11 golds stop under `raise_on_failure=True` (§6).

Horizon covariate: on train and dev, the gold's API-call count (`parity.json bg1.goldCalls`); on test_normal no solution
is released, so the covariate there is AppWorld's own difficulty level (1-3), which the grader row carries host-side
[doc, README; obs, `TestTracker.difficulty`].

## 4. Split and hygiene (SPLIT.json, `aw-split-v1`)

Rule committed in `68b966f2` (2026-11-04 14:06:18Z) before its salt existed; salt from drand quicknet round 33666038;
`splitSha256 cf47942cb49ee65fdeb321f91f2463faf110c14a95c5904f60d22170ae027caf` (file sha256 `1100dfe8…b326`). Task ids only;
no task file was opened to make it. Roles: devTrain = train 90, devCheck = dev 57 (<= 3 looks per arm family, logged
host-side, a fourth refused), sealed = test_normal 168; A-S candidates (first variant of every scenario, then second
variants), default cut 64 (n_eff 60 at ICC <= 1/3; `sonnetK(icc)` from the pilot ICC); A-O anchors = 20 scenarios x their
first variant, nested in A-S; pilot order over train. test_challenge is never run (the runner refuses its ids).
Scripted policies run only on dev splits (they read ground truth host-side). Sealed runs need `--sealed --freeze
SEALED-FREEZE.json` naming this split; their results never leave the host-only directories.

## 5. BG-11 hard-violation map

| Violation | Covered by the margin outcome? | Measure |
|---|---|---|
| a write to another record (a neighbouring record of the touched model, or an unrelated simple_note note) | **yes**: 108/108 touch-other-record mutants fail the evaluation (43 neighbour writes, 65 note re-pins) [run, `parity.json bg3`, PARITY.md] | the margin outcome (TGC); `collateral` (failed `no_op_pass` assertions) co-reported |
| an extra field written on a record the task legitimately writes | **partly**: 20/29 effective extra-field mutants fail; 9 pass (3 scenarios) [run] | none on test_normal: no solution is released for test, so a field-level co-oracle cannot be computed there [doc, README; obs] |
| a duplicated write | **partly**: the APIs refuse 72/108 repeats (no effect); of the 36 that change state, 21 fail the evaluation and 15 pass (5 scenarios) [run] | a gold-free duplicate-write check from the API-call log is possible but not built (PARITY.md "Details": at most 94.8% with it; 5/147 golds repeat a write) |
| reading ground truth or split lists | prevented by construction (BG-8) | `bg8.json` |

## 6. Findings worth knowing

- **AppWorld's SafetyGuard is not a security boundary.** Inside `execute`, the real `open` is reachable through
  `__builtins__` with a built name (the static check looks for `open(` paths; the runtime null-patch did not replace it)
  [run, `bg8.json` `executePath.bypass.open = TextIOWrapper`]. The probe read nothing sensitive only because the OS
  sandbox shows the serve process no ground truth, no split lists and no host-only data (positive control: the same chunk
  without the sandbox sees the full data and reads an answer file) [run].
- `pathlib.Path.read_text` is not on the guard's deny list either [obs, `common/safety_guard.py`].
- **Some golds need `raise_on_failure=False`.** verify.py checks the golds with `raise_on_failure=False`; the experiment
  configs leave the package default (`True`), under which "any of the APIs in the code respond[ing] with a non-success
  status code ... will be treated as a runtime error" [doc, README]. A gold that expects an API failure (train
  `0d8a4ee_3`: an account lookup by e-mail that answers 422 for a contact without an account) stops there under the arm settings, on
  upstream's own path as on ours [run, 2026-11-04]. So BG-1 is the verify.py check; gold under the arm settings must
  agree between paths, not pass (`parity.json` `bg1.goldArmFailIds`). An arm sees the same error text and can recover in
  its next `execute`; the scripted gold cannot [inf].
- `appworld` loads a `.env` from the working directory upward at import (`common/path_store.py` `dotenv.load_dotenv()`)
  [obs]; every bridge process starts in its own clean root.
- The data unpack leaves every split's evaluation programs, answers and test data as plain files [run]; only the
  sandbox keeps them from an arm.

## 7. Open before any sealed run

1. Interleaving (PLAN §5.2): `interleave.mjs` (written 2026-11-04) runs the arms block by block over whole scenarios in
   the hashed run order, so a stop leaves every arm with the same paired subset; every unit still gets its own fresh
   serve process and world, identical for every arm. The per-arm `run.mjs` commands remain valid (the same order; a
   stopped run is a paired prefix) and are kept in `cost-estimate.json` beside the interleaved ones. A resumed devCheck
   run continues its recorded look instead of being refused as a second look (fixed in `assertUnits` the same day).
2. BG-3 decision (owner): AppWorld's evaluator kills 149/173 = 86.1% of the non-equivalent side-effect mutants
   (touch-other-record 108/108, extra-field 20/29, repeat-last-write 21/36; PARITY.md); PLAN §5.4 blocks a bed below 95%.
   Options: (a) admit with the margin outcome as AppWorld's TGC and the two uncovered classes reported (§5); (b) add a
   gold-free duplicate-write co-oracle (API-call log), which reaches at most 164/173 = 94.8% and must first be refined so it
   does not reject the 5 golds that repeat a write, then pass a BG-6 check; (c) skip the bed. No co-oracle can catch extra
   fields on test_normal (no released solution). Every other $0 gate passes (PARITY.md).
3. Bed card (Opus, <= $5), identity probe (C7) and date check (AM-9) in the probe battery; F-kit (F-H) integration
   through this adapter's relay; SEALED-FREEZE.json at the PREREG v1 freeze (arm and card hashes, caps from the pilot p99,
   the A-S cut from the pilot ICC).
4. BG-9 (Agentic Benchmark Checklist row) is not built here; the trivial-agent results it needs are in `parity.json`.
