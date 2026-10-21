# PREREG-OT0 amendment 1: environment faults stop the agent arms (2026-10-21, before the re-run)

**Status: ADOPTED (2026-10-21, 21:30 UTC)** by the OT-0 fix agent under the owner's blanket permission
(OPERATING-PRINCIPLES §8). It supersedes one row of `PREREG-OT0.md` §6, which was FROZEN at 27ff324 and is not edited.

**Order of work:**
1. 21:20 UTC: this text was written, before `run-agents.mjs` was changed.
2. 21:28 UTC: the §8 hash row was filled in, after the fix and its tests were final.
3. Before any paid session of the re-run: the text was finalised.

The runner records this file's sha256 in every `launch.jsonl` row, so any later edit would make the re-runs refuse to
resume.

## 1. What happened (2026-10-21; observed in the records)

The chain `experiments/constitution/ot0-chain.sh` ran the §2 arms in order. Times are UTC, from
`/var/tmp/foundry-work/ot0-chain.log`.

| arm (label) | started → ended | ticks | `MODEL_RATE_LIMIT` ticks | first faulted tick | reported result (void) | spend |
|---|---|---|---|---|---|---|
| W-C 1-3 (`wc-e8-1..3`) | 17:42 → 19:08:28 | build sessions | 0 | none | kept (§3) | $0.365, $0.640, $1.557 |
| A-HV (`ahv-s12`) | 19:08:28 → 19:32:33 | 59 | 20 (k 40-59) | k 40: call `2026-03-07T02:31:00+01:00\|r1\|case\|i-000008` (9 turns, $0.0084, then the limit) | E8 3/14, +C2 3/14, 20 arm errors | $0.4641 |
| A-F Sonnet (`af-sonnet-s12`) | 19:32:33 → 19:33:07 (33 s) | 21 | 21 (all) | k 1: the first call at t0 (`2026-03-02T00:00:00+01:00`) | E8 0/14, 21 arm errors | $0.00 |
| A-F Opus (`af-opus-s12`) | 19:33:07 → 19:33:40 (33 s) | 21 | 21 (all) | k 1, as above | E8 0/14, 21 arm errors | $0.00 |

The account's session limit hit at about 19:3x UTC, during A-HV. Each faulted session returned
`{ code: 'MODEL_RATE_LIMIT', exitCode: 1 }` (`src/executors/claude-code.mjs` `sessionError`) and wrote no `output.json`.
Every faulted tick reached the host journal as `arm.error` (code `crash`, detail `no output.json (session [object Object])`)
plus `carry.lost`, was committed with its wake-up, and was graded as an arm failure. Each run went on to the horizon,
wrote `result.json` and exited 0. The chain retries only on a non-zero exit, so it moved on. Its spend check read $0.4641
(< $50), so it started the Opus arm, which hit the same limit.

Records: `/var/tmp/foundry-work/ot0-arms/<label>/{journal.jsonl,ticks.jsonl}` (live) and
`research/org-20261021/runs/<label>/{result.json,ticks.jsonl}` (committed as-is in 3942863 to keep the raw failures).

## 2. Root cause: where the error is swallowed

The chain of events, file by file. Line numbers are at 27ff324; every file except `run-agents.mjs` is unchanged.

1. `experiments/ebed/agent-arm.mjs:132-146` (frozen; A-F uses it directly and A-HV through agentv). After the session
   returns, `agentArm` records the cost and the `ticks.jsonl` row, including `error: MODEL_RATE_LIMIT`. It then finds no
   `output.json` and throws a plain `Error(\`no output.json (session ${r?.error ?? 'ended'})\`)`. `r.error` is an object,
   so the host sees `[object Object]` and the code is lost.
2. `beds/ebed/host/host.mjs:534-544` (frozen). The host stops the clock only for an error marked `quota`. It retries only
   an error marked `env`. A plain error becomes outcome `crash`, and lines 668-669 write `arm.error` and `carry.lost`. The
   wake-up commits, the clock advances and the run continues.
3. `experiments/agentv/arm.mjs:87, 122-133` (frozen; A-HV). The A-HV wrapper already has the stop: `stopOnEnvFault`
   raises `EnvFaultStop`, a host QuotaStop, which the AGENTV-E8 deviation 5 of 2026-10-15 added after agent-H s12 hit
   the same failure. But the stop defaults to **off**. When it is off, an environment-fault code is returned to `agentArm`
   without a retry (line 133), which leads to step 1.
4. **`experiments/constitution/run-agents.mjs:47-50, 79-91` (the swallow point).** This is the only place on the OT-0
   path that decides whether a fault stops the run. `makeAgentArm` calls `agentVArm` without `stopOnEnvFault: true` and
   puts nothing around A-F's session runner. `main()` then grades and writes `result.json` and exits 0 for any host
   status. AGENTV's fix lived in `experiments/agentv/run.mjs` and was never carried to this file.
5. `experiments/constitution/ot0-chain.sh`. It reads exit 0 as success, so the fault never reached its resume loop.
6. `experiments/constitution/test/paid.test.mjs`. Its dry tests never injected a fault. Since the freeze, two of its
   assertions were also out of date. They expect "PREREG-OT0.md is a draft". With the prereg FROZEN and the table
   matching, the test that spawns `run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label x --cap 20` and
   `build-wc.mjs --model claude-haiku-5-5 --label wc-x` would have started **paid** sessions. The test has not been run
   since the freeze: there is no `runs/x` or `runs/wc-x`. The amended test removes every spawn that could start a paid
   session.

## 3. Void runs and kept runs

- **A-HV `ahv-s12`: void. Contaminated from tick 40**, the wake-up at 2026-03-07T02:31:00+01:00. The last clean commit is
  2026-03-07T02:05:00+01:00, with 39 clean ticks and $0.4557. Its `result.json` grades the 20 faulted ticks, 11 of them
  as `L0:arm-error` case failures, so the row is void. The clean prefix is kept on record but not spliced into the
  re-run, because it ran under the pre-amendment runner and one row must not mix two runner versions. The re-run starts
  fresh.
- **A-F Sonnet `af-sonnet-s12`: void from tick 0.** All 21 ticks faulted and no model ever ran ($0.00).
- **A-F Opus `af-opus-s12`: void from tick 0.** As above.
- The records move with history (`git mv`) to `research/org-20261021/runs/void-20261021/<label>/`, which gets a
  `VOID.md`. The live directories move to `/var/tmp/foundry-work/ot0-arms/void-20261021/<label>/`. Nothing is deleted.
- **Void spend: $0.4641** (A-HV; the A-F arms were $0). It is booked on the OT-0 $100 line (§3) and counts toward the
  "$50 before Opus" rule of §2.
- **W-C ×3 (`wc-e8-1..3`) are clean and stay.** Each build session's CLI result is `success`, `is_error: false`, with
  no `api_error_status`, and `build.error` is null. Their transcripts and results contain no `MODEL_RATE_LIMIT`. The text
  matches for "rate limit" in their transcripts are E8's own `rate-limited` effect status, which is part of the spec and
  the solver code. The "429" matches in `result.json` are substrings of amounts such as 42922.

## 4. The fix (the only frozen file that changes: `experiments/constitution/run-agents.mjs`)

- **Classifier `envFaultOf(result, { workdir })`.** A session ends in an environment fault when any of these holds:
  - its error code is `MODEL_RATE_LIMIT`, `MODEL_UNAVAILABLE` or `SANDBOX_UNAVAILABLE` (agentv's `ENV_FAULT_CODES`);
  - any other error end (not `EXECUTOR_BUDGET`) has stderr, result or message text naming a rate, usage, session or
    weekly limit, HTTP 429/529, "too many requests" or overload, or the session's stream ends with a 429/529 API error
    event;
  - a session with no error code printed a CLI limit notice as its result (for example "usage limit reached", "hit your
    limit" or `rate_limit_error`) and wrote no `output.json`;
  - the runner threw with one of the codes above.
- **Stop.** A wrapper around the session runner, inside `agentArm`/`agentVArm`, throws `EnvFaultStop`, a host QuotaStop
  (`experiments/agentv/arm.mjs`, imported unchanged). The host freezes at its last commit and discards the fault's
  round. That round gets **no `call` row, no `arm.error` and no `carry.lost`**: the tick is not scored. The faulted
  session's cost goes to the freeze record, to `faults.jsonl` in the live directory and to the cap's running total.
- **Exit 3, no `result.json`.** On a frozen run with a fault in this invocation, `main()` grades nothing. It writes the
  fault rows (`faults.jsonl`, copied to the run directory) and exits with code 3. **The same command resumes**:
  `resumeRun` replays the committed prefix at $0 and live calls pick up at the interrupted wake-up. The spend already
  recorded (`ticks.jsonl` plus `faults.jsonl`) counts toward the cap. `launch.jsonl` records each invocation's settings,
  prereg and amendment sha256s and the runner's sha256. A resume with other settings or another runner is refused.
- **Unchanged:** a cap QuotaStop (a frozen run without a fault) is graded as before, with open cases censored. Any other
  arm error is still an arm failure, as frozen.
- **Late fault.** A session can fault after the host has already timed its call out (A-HV only: two 8-minute sessions
  against a 9-minute call). That tick was already scored as a timeout, so the run is marked contaminated from it:
  `result.json` gets `envFaults.late` and the process exits 4, which is not resumable. Such a run is re-run fresh.
- **The prereg check stays strict** (`experiments/constitution/freeze.mjs`, not a §6 file). `preregCheck()` reads
  `PREREG-OT0-AMEND-<n>.md` beside the prereg, in order. An amendment applies only if all of these hold:
  - it is marked `**Status: ADOPTED`;
  - it names the sha256 of the `PREREG-OT0.md` it amends;
  - each `supersedes <old> -> <new>  <path>` row names a path in the §6 table whose current expected sha256 is `<old>`.

  Anything else is refused, and so is any file whose hash matches neither the table nor an amendment. `result.json`'s
  `prereg` field records each applied amendment's sha256.
- **Tests** (`experiments/constitution/test/paid.test.mjs`, $0, no model call):
  - The A-F and A-HV stub sessions return `MODEL_RATE_LIMIT` (and a CLI "usage limit" notice) at tick N. The run
    freezes, the journal has no call, `arm.error` or `carry.lost` for that tick, and the CLI exits 3 with no
    `result.json`. The same command then resumes to `complete`, the committed prefix verifies, and `result.json` is
    written once.
  - The classifier is tested on each fault form and on the non-faults (E8's `rate-limited` text in a model's result, a
    budget stop, a timeout without a limit event).
  - `preregCheck` is tested with the amendment, without it, with a forged old sha, with a path outside the table and
    with a draft amendment.
  - No test spawns a CLI that could start a paid session, and every spawned CLI gets `PATH=/nonexistent`.
  - **Mutation check (21:27 UTC):** with the fault stop removed from `makeAgentArm` (session = the bare runner), the A-F,
    A-HV and CLI fault tests fail (3 of 3). With it, all 13 tests in the file pass.

## 5. Labels (a deviation of the §2 commands' `--label` only)

The re-runs use new run ids so the void records keep their paths: `ahv-s12-r1`, `af-sonnet-s12-r1`, `af-opus-s12-r1`.
Every other argument is the §2 command as frozen:

```
node experiments/constitution/run-agents.mjs --arm A-HV --model claude-haiku-5-5 --label ahv-s12-r1 --cap 5
node experiments/constitution/run-agents.mjs --arm A-F --model claude-sonnet-5-5 --label af-sonnet-s12-r1 --cap 20
node experiments/constitution/run-agents.mjs --arm A-F --model claude-opus-5-5 --label af-opus-s12-r1 --cap 45
```

They run sequentially from `experiments/constitution/ot0-rerun.sh`, which:

- runs each arm as a detached process under `nice`;
- checks `df` before each start and stops below 1 GB;
- after exit 3 (an environment fault), waits 30 minutes and re-runs the same command, at most 6 times;
- starts the Opus arm only if total OT-0 spend is under $50, counting W-C, the void spend and the re-runs (§2);
- treats exit 4 (contaminated by a late fault) as final for that arm: it logs it and goes on;
- resumes a process killed by a signal (exit 128 or above) in the same way as exit 3, because the journal is cut back to
  its last commit;
- treats any other non-zero exit (a refusal or a host error) as a failure: it logs it and goes on, without retrying.

The old chain's spend check read only `costUsd`/`cost.usd` and so counted W-C as $0, because a W-C `result.json` keeps
its cost under `build.costUsd`. It printed $0.4641 where the true total was $3.03. The new script reads both.

## 6. What does not change

Everything else in PREREG-OT0 stays as frozen:

- the bed (§1), arms, caps and order (§2), measures (§4) and reading rules (§5);
- the other 39 of the 40 rows of §6.

The arms run on **engine v1**, the main tree as it is. The engine v2 series is not merged and is not used, so all three
agent arms and the W-C builds ran on one engine version.

## 7. Records of the re-run

`research/org-20261021/runs/<label>-r1/` holds `result.json` (with `prereg.amendments`), `ticks.jsonl`, `faults.jsonl`
(when a fault occurred) and `launch.jsonl`. The live journals are in `/var/tmp/foundry-work/ot0-arms/<label>-r1/`. The
result is read in `research/org-20261021/RESULT-OT0.md`.

## 8. Machine-readable amendment (read by `experiments/constitution/freeze.mjs` `preregCheck()`)

```
amends research/org-20261021/PREREG-OT0.md 46ee3423e636e3f61a79df6b16954ca19a4c5c8f9b7404c7ccf9ea2bf5722c29
supersedes 38634460df1ef6b1d666cf8380976cf72adcccf9eaf5bc98a339ff9c14a64d7c -> e550efb940a85f169d176015e72357c47e377b978ac630c184f556378ee97031  experiments/constitution/run-agents.mjs
```
