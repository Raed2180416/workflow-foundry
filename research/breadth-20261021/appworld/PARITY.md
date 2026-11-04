# AppWorld parity and $0 oracle gates (bed 3)

Development/diagnostic evidence only: scripted trajectories on the public train (90) and dev (57) splits, 147 tasks in 49
scenarios, no model, $0. Record: [`parity.json`](parity.json), written by
`nice -n 15 node experiments/breadth/appworld/parity.mjs --concurrency 3 --baseline-concurrency 2` on 2026-11-04 (batteries
18:23Z → 19:40:36Z over two invocations of the same code; the second, 781 s, found upstream's battery and the runner
baselines cached and ran ours; a shared 4-core host at load 11–41). BG-8: [`bg8.json`](bg8.json)
(`node experiments/breadth/appworld/leakprobe.mjs`, 2026-11-04 19:44:59Z, rerun after the mutant fix changed `bridge.py`). Oracle and serving code: `bridge.py` sha256
`d9ec3f69a2a37e0ea114b1884655620f9daa0c6b7d9405ac43631dcf9a14d97f`; the "ours" batteries and the runner baselines are
cached under the sha256 of `bridge.py`, `lib.mjs`, `facade.mjs`, `mcp.mjs` and `run.mjs` (`codeSha256`
`070f00e8a3c8ae0e181c76525716cf892b45bded0b3cc5893103a67e66b9f66f`), upstream's reference battery and the scripted plans
under the sha256 of `bridge.py`; the test suite fails if the committed code differs from the code that produced
`parity.json` or `bg8.json` (BG-8 code sha256 `eb34c617…4ac8`). Labels as in NOTES.md: **[run]** measured here,
**[obs]** observed in code or files, **[doc]** a document says so, **[inf]** inference. No task content is quoted;
per-item rows stay host-only under `/var/tmp/foundry-work/appworld-host/`.

## What "parity" means here

**Our path** (an arm's path with a scripted client in place of a model): a sandboxed `bridge.py serve` process sees only a
public view of the task (no `ground_truth/`, no `datasets/`) and opens the world with `load_ground_truth=False`; every code
chunk is a `tools/call` of `execute` through the MCP relay (`mcp.mjs`), the mailbox and the host facade (`facade.mjs`) to
`world.execute`; after `complete_task` the serve process refuses further code; the world is closed, its output databases
are copied to a host-only snapshot, and a separate host-only `grade-serve` process runs AppWorld's `evaluate_task` on the
snapshot (what `world.evaluate()` runs) [obs]. Two variants of this path ran: the battery mode of `parity.mjs` (one serve
process per worker, many worlds in sequence) and **the runner itself** (`run.mjs runUnits`: a fresh serve process and
world per unit, exactly as a paid arm runs). **Reference path**: upstream's own procedure in one host-only process,
`bridge.py official`: `AppWorld(task_id, ground_truth_mode="full", ...)`, `world.execute(chunk)` per chunk until
`world.task_completed()` (the README agent loop), then `world.evaluate()` [obs]. **Parity** on an item = the same success,
the same pass and fail counts, the same assertion fingerprints (sha256 of the sorted, hashed requirement texts of the
passes and of the failures) and the same post-state digest (sha256 over every output database file).

Policies (scripted plans from `bridge.py plan`, train and dev only): **gold** = the task's `compiled_solution.py` as one
chunk; **null** = no code at all (the do-nothing agent); **docs** = the API-docs-only replay agent (the app list, the API
list of every app the gold uses and the doc of every API the gold calls, then `complete_task()` with no answer);
**mutants** = the gold behind a prelude that wraps the requester's write methods: *repeat-last-write* (the gold's last
write sent again just before completion), *extra-field* (the gold's last write carries one documented optional field the
gold did not set), *touch-other-record* (the gold's last id-bearing write replayed on a neighbouring record id, the first
one the API accepts; with no such write or no accepting neighbour, a simple_note note the gold did not write is
re-pinned) [obs, `bridge.py` `MUTANT_OPS`]. World settings: **verify** = verify.py's (`raise_on_failure=False`); **arm**
= the experiment configs' (`random_seed` 100, `max_interactions` 1000, `max_api_calls_per_interaction` 5000,
`raise_on_extra_parameters` true; `raise_on_failure` left at the package default, true) [doc, README "Changing Configs";
obs].

## Gates

| Gate (PLAN §5.4) | Requirement | Result [run] | Pass |
|---|---|---|---|
| BG-0 provenance and install | pinned wheels and data; every installed file equal to its wheel RECORD | 80 pinned = 80 installed; 10,905 files checked, 0 mismatches, 0 unlisted; the 96 files `appworld install` unpacked match manifest `8f069913…3e19`; bundle 34,280,074 B present (`fd9f9608…8250`); downloads record `ead7bd84…f753`, lock `9acb0603…9693` (ACQUISITION.md) | yes |
| BG-1 gold replay | upstream's gold check scores 100%; ours = upstream | verify.py settings: gold **147/147** on upstream's path and **147/147** on ours, identical on all 147 (verdict, counts, fingerprints, post-state). Gold length 5–244 API calls (median 36, 7,733 in all); 108/147 golds write | yes |
| Gold under the arm settings | runner = upstream | **136/147** on upstream's path and **136/147** through `run.mjs`, identical on all 147. The 11 that stop (train/dev `0d8a4ee_1–3`, `37a8675_1–3`, `3ab5b8b_1–3`, `57c3486_1`, `57c3486_3`) expect an API failure that `raise_on_failure=True` turns into an exception (§ Details) | yes (agreement) |
| BG-2 floors (scripted $0 baselines) | do-nothing and replay agents scored on every path | null **0/147** on upstream's path, on ours and through `run.mjs` (SGC 0/49); API-docs-only replay **0/147** on upstream's path and through `run.mjs` (SGC 0/49). Assertion-level floors: null passes 19.2% of all assertions, docs 33.0% (the assertions a do-nothing world already satisfies) | yes |
| Parity, battery mode | ours = upstream on every item | **548/548** equal (147 gold, 147 null, 254 mutants); 0 mismatches, 0 missing | yes |
| Parity, the runner | `run.mjs` = upstream on every unit | **441/441** equal (gold, null, docs under the arm settings, a fresh process per unit); the serve process's post-state digest = the graded snapshot's on all 441 | yes |
| Upstream's dataset evaluator | `evaluate_tasks` (what `appworld evaluate` runs) over our snapshots agrees with our grader | gold: TGC 100, SGC 100, 147/147 agree; null: TGC 0, SGC 0, 147/147 agree | yes |
| BG-3 mutation | ≥ 3 operators, ≥ 95% of non-equivalent mutants killed | 254 mutants of the 108 writing golds; 81 equivalent (post-state = the gold's); **149/173 = 86.1% killed** → **fails**. repeat-last-write 21/36 (58.3%; 72 equivalent), extra-field 20/29 (69.0%; 9 equivalent), touch-other-record 108/108 (100%). Ours = upstream on every mutant (0 disagreements) | **no** (owner decision, NOTES §7) |
| BG-4 determinism | two runs in fresh processes, identical digest | gold and null, 294 items, run 1 = run 2: `dcc5e30d9ee18ebeaa300fb83340e8b46e2e2911522c83de627f0414a9453649` | yes |
| BG-5 judge-free | no LLM in the reward | `evaluate_task` runs the task's Python assertions over the saved databases [obs, `evaluator.py`] | yes |
| BG-6 valid alternatives | valid non-gold answers accepted | not run on this bed (no synthetic variants); the assertions read database state, not the call sequence [obs], so a different valid call sequence reaching the same state passes [inf] | open |
| BG-7 evaluator defaults | every item parses and grades | 842 upstream items, 548 + 294 ours items, 441 runner units: 0 errors, 0 environment faults | yes |
| BG-8 leakage from inside | ground truth, split lists, host-only data, package and HF caches, `corpus/` and the network unreachable from `execute`, the `python` tool and the session sandbox | pass: nothing sensitive reachable even with AppWorld's SafetyGuard bypassed; positive control (no sandbox) reads the full data (`bg8.json`) | yes |
| BG-9 ABC map | the bed's checklist row | not built here (bed-card step); the trivial-agent results are above | open |
| BG-10 oracle frozen first | declared oracle fixes frozen before any F-kit look | grader and mutants frozen by `bridge.py` sha256 above; no model and no F-kit look has run on this bed | yes |
| BG-11 hard-violation map | per bed | NOTES §5 | yes |

**Overall: `parity.json` `pass: false`**, on BG-3 alone; every parity and floor check passes.

## Details

- **The evaluator misses some side effects (BG-3).** *touch-other-record* is always caught: 43 of its 108 mutants wrote a
  neighbouring record through the gold's own endpoint and 65 fell back to re-pinning an unrelated note; the evaluation
  fails all 108 [run, diagnostic replay of the 108 mutants]. *repeat-last-write*: the API refuses most repeats (replay
  status 422 ×57, 409 ×5, 401 ×3; 7 with no status recorded), leaving 36 effective duplicates, of which 15 pass the evaluation (5 scenarios
  × 3 variants: `22cc237`, `3c13f5a`, `c901732`, `396c5a2`, `4fab96f`). *extra-field*: 9 of 29 effective mutants pass
  (`692c77d`, `22cc237`, `3c13f5a`). So an arm that sends a write twice, or sets a field nobody asked for, is credited on
  those tasks [run].
- **A gold-free duplicate check would not reach 95% either.** A co-oracle that rejects any repeated identical write
  (method, URL, body) could run on test_normal from the world's API-call log, needs no gold, and would kill the 15 repeat
  survivors: at most 164/173 = 94.8%, still short because extra fields need the gold [calc]. It is not free: 5 of the
  147 golds (`b119b1f_1–3`, `57c3486_1`, `57c3486_3`) issue an identical write twice [run, their `api_calls.json`], so
  it would need a refinement (both writes accepted, a non-idempotent endpoint) and a BG-6 check on the golds first [inf].
- **The first mutant version was wrong, and the first full run showed it.** appworld's `requester.prepare()` pops
  `access_token` out of the body dict it is given [obs, `requester.py` `prepare`]; the first prelude kept that dict and
  replayed it, so every repeat and every neighbour write went out unauthenticated and failed silently. That run (code
  `bridge.py` `7508ee88…`, stopped about 18:20Z) had 83/83 repeat-last-write mutants equivalent and every touch kill from
  the fallback. The prelude now copies the body before the call and replays a fresh copy (`f860280d`); a test with a fake
  requester that pops the token pins it. The superseded battery is kept host-only (`parity/official-7508ee88f604ef5c`).
- **Gold under the arm settings.** verify.py checks golds with `raise_on_failure=False`; agents run with the package
  default, under which a non-success status "will be treated as a runtime error" [doc, README]. The 11 golds above call an
  API whose failure they expect (train `0d8a4ee_3`: an account lookup by e-mail that answers 422 [run]); as one scripted
  chunk they stop there, on upstream's path exactly as on ours. An arm sees the same error text and continues in its next
  `execute` [inf]. BG-1 is therefore upstream's own gold check (verify settings); the arm-settings gold is an agreement
  check.
- **Operational.** A battery worker that has run about 280 worlds holds about 1 GB and did not exit ten minutes after its
  last row; `parity.mjs` now kills a worker 60 s after its `done` line (every row is already recorded) [run].

## What this does not show

- Agreement on scripted trajectories shows that our serving and grading path is faithful to upstream's; it says nothing
  about how a model behaves through the relay (long outputs are cut to their last 20,000 characters, as the serve process
  returns them; error texts; parallel calls) [inf].
- The mutants are three side-effect operators on the gold's last write. Drop-write and wrong-argument operators were not
  run: AppWorld's assertions are written against the task's required changes, which those operators break by
  construction [inf]; the side-effect operators are the PLAN's AppWorld gate (§4.3 T1-3).
- test_normal releases no solution, so no gold, mutant or determinism check can run on the sealed tasks; the sealed
  evaluation relies on the same evaluator code path shown equal here [doc, README; inf].
