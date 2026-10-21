# Orchestration gaps, ranked, and the plan to close them (2026-10-21)

*Inputs: [WORST-CASE.md](WORST-CASE.md) (catalogue, ids a1-g5), [chaos/MATRIX.md](chaos/MATRIX.md) (43 scenarios on the
repository as it is), [chaos-patched/MATRIX.md](chaos-patched/MATRIX.md) (the same 43 on a scratch copy with patches 01-09
applied), [PROBES.md](PROBES.md) (CLI behaviour), [PRIOR-ART.md](PRIOR-ART.md). Proposed source changes are patch files in
[patches/](patches/); none is applied to `src/` or `experiments/` (paid runs are active and several files are frozen).
Development/diagnostic evidence; every pass/fail below is from synthetic capabilities and scripted models ($0) except the
probes.*

## 1. Where we stand

| | scenarios | pass | fail |
|---|---|---|---|
| repository today (`node experiments/orch/chaos.mjs`) | 43 | **20** | **23**: A4 A7 A9 B2 B3 B8 B9 B10 B11 C1 C2 C3 C4 C5 D1 D2 D3 D4 E1 E2 F1 G1 G2 |
| scratch copy + patches 01-09 | 43 | **32** | 11: A4 B8 B10 B11 C3 C4 C5 D4 E1 F1 G1 |

**What already holds** (and is better than most prior art): kill -9 of the owner at random points resumes to the fault-free
result with each effect applied once per key and the non-idempotent effect never repeated (B1, 3 seeds, 16 kills); fan-out of
1,000 under a cap (A1, A2); duplicate signals and approvals (B5, B6); two owners racing one run (F2); stop-all never touches
another workspace (F3); one-writer state under two processes (F4); taint labels against injected child output (F5); authority
never widens (F6); a full disk leaves a consistent record that resumes (C1, apart from the message); budget carving in flow-v3
(E3, E4); no silent provider fallback (D5).

**What breaks** clusters in five places: (1) transient outages and limits end runs for good; (2) budgets count dollars only and
are crossed under concurrency; (3) processes outlive their owners unless a human runs cancel/resume; (4) the flow-v3 host keeps
its children and in-flight state in memory (no cancellation down the tree, no single flight, shared workdirs clobber evidence);
(5) clocks, /proc and the CLI's version are trusted where they should be measured.

## 2. Ranked gaps

Score = likelihood (1-5, real-world, given this week's incidents I1-I8) x damage (1-5: lost work, lost money, wrong evidence,
stuck runs). **Patch** = a file in `patches/`, validated by the chaos scenario(s) named (pass on the patched copy) and by the
existing test files listed; **design** = not yet written.

| rank | gap (WORST-CASE id; chaos) | L | D | score | fix (adopt / build) | files | status | estimate |
|---|---|---|---|---|---|---|---|---|
| 1 | **A transient outage or usage limit ends the run terminally**; the reset time is dropped (b10, d5, e3; B9, D1, D3; incidents I2, I6) | 5 | 4 | 20 | adopt Restate/Temporal: bounded inline retries on the same model honouring `retry-after`, then **park** the agent node (`waiting`, timer at `retryAt`, at most 8 parks); keep the CLI's text in the error | `src/runtime.mjs` (agent, modelLoop), `src/models/providers/claude-cli.mjs` | **patch 04**, B9 D1 D3 pass; `tests/runtime-agent.test.mjs:139-152` encode the old terminal behaviour and must change (their "never escalate, no other model" assertions still hold) | 1 day with tests |
| 2 | **No token budget**: a $0 model runs unbounded (e2; E2; incident I7, 97 M tokens) | 4 | 5 | 20 | build: `budget.maxTokens` in the IR, a runtime default (5 M), `TOKEN_BUDGET` verdict; a gateway session token cap | `schemas/workflow.schema.json`, `src/runtime.mjs`, `src/verdict.mjs`, `experiments/lib/services.mjs` | **patch 09**, E2 pass | 1 day |
| 3 | **Orphans until a human acts**: a killed owner's sandbox runs on; executor sandboxes are not even recorded (b2; B2, B3) | 4 | 4 | 16 | adopt fate-sharing (Ray ownership): `setpriv --pdeathsig KILL` around every spawn on Linux; record executor groups too; a per-run watchdog where PDEATHSIG does not exist (macOS) | `src/children.mjs`, `src/sandbox.mjs`, `src/process.mjs`, `src/executors/sandboxed-command.mjs`, `src/executors/claude-code.mjs` | **patch 05** (Linux), B2 B3 B4 pass; `tests/sandbox.test.mjs` 15/15; three `tests/cli-cancel.test.mjs` tests assume the orphan exists and must change; macOS watchdog: design | 0.5 day + 1 day watchdog |
| 4 | **Ctrl-C makes a run unresumable** although the CLI prints `"resumable": true` (b6, g2; G2) | 5 | 3 | 15 | build: the CLI records a handled interruption (`run_interrupts`); recovery refunds the interrupted attempt of a pure/idempotent task; unexplained deaths still count (keeps B7's bound) | `bin/foundry.mjs`, `src/store.mjs`, `src/runtime.mjs` (recover, execute) | **patch 03**, G2 B1 B7 pass; `tests/cli-interrupt.test.mjs` 2/2 | 0.5 day |
| 5 | **Engine changes strand every in-flight run** (`ENGINE_DRIFT`), so each fix above kills running and parked runs (b13; incident I8) | 4 | 3 | 12 | adopt Temporal `patched()` idea: engine versions with declared compatible ranges; a run migrates only across versions marked compatible, with the migration in its chain | `src/engine.mjs`, `src/runtime.mjs`, `src/verify-run.mjs` | design | 2 days |
| 6 | **Outages escalate to a dearer model in flow-v3** (d6; D2) | 4 | 3 | 12 | DESIGN §5.1 rule applied to flow-v3: an outage stops the solver with `ENV_EXIT` (76) and `env-fault.json`; run-compiled reports it as an environment fault | `experiments/jit/flow-v3.mjs`, `experiments/jit/run-compiled.mjs` | **patch 07**, D2 pass; `flow-v3-call` 7/7, `flow-v3-slice2` 10/10 | 0.5 day |
| 7 | **Disk full**: masked by a second ROLLBACK; runners score it as a task failure; a torn JSONL tail eats the next record (c1; C1, C2; incident I1) | 3 | 4 | 12 | build: keep the original error, type it `STORAGE_FULL`/`STORAGE_UNAVAILABLE` (environment fault, "free space, then resume"); infra codes in `ENV_FAULTS`; end a torn tail before appending; a free-space pre-flight | `src/store.mjs`, `src/verdict.mjs`, `src/runtime.mjs`, `experiments/lib/runner.mjs`, `experiments/lib/results.mjs` | **patches 01, 06**, C1 C2 pass; `tests/store-atomic.test.mjs` 4/4 | 0.5 day |
| 8 | **Quota is discovered by killing agents**: the CLI's `rate_limit_event` (utilisation 0.57 of the five-hour window, reset times) is ignored (d5; probe L1; incident I2) | 4 | 3 | 12 | build: read `rate_limit_event` from every executor stream and provider call; a workspace-level throttle stops new launches above a threshold and parks until `resetsAt` | `src/executors/claude-code.mjs`, `src/models/providers/claude-cli.mjs` (stream-json), a small `src/quota.mjs`, runners | design | 1 day |
| 9 | **Dollar budget crossed under concurrency, and a budget stop is final** (e1, e5; E1) | 4 | 3 | 12 | adopt the gateway's reservation model in the runtime (reserve min(per-call cap, list-price estimate) before each call; admit only if it fits beside calls in flight); a budget stop parks the run until the owner signs a budget amendment (chain event) | `src/runtime.mjs` (modelLoop, checkBudget), `src/control.mjs` | design | 1.5 days |
| 10 | **flow-v3 children survive their parent; the host waits up to 330 s for them** (b11; B10) | 3 | 3 | 9 | adopt Temporal `ParentClosePolicy` (default terminate): pass the gateway's abort signal into `runChild`/`runCompiled`/stubs; close a dead parent's gateway without the 330 s grace for child calls; children recorded as rows | `experiments/jit/call-host.mjs`, `experiments/jit/run-compiled.mjs`, `experiments/lib/services.mjs` | design | 1 day |
| 11 | **Spend of calls in flight at a crash leaves no trace** (b7; B11: 28 provider calls, 20 journal rows) | 3 | 3 | 9 | build: a journal intent row before the provider call (with the per-call cap as the bound), settled after; recovery books unsettled intents as bounded unknown spend | `src/models/port.mjs`, `src/journal.mjs`, `src/runtime.mjs` (chargeModel, recover) | design | 1 day |
| 12 | **Shared workdirs clobber evidence** (f1; F1: both runs "ok", traces mixed) | 3 | 3 | 9 | build: an O_EXCL lock file per workdir (pid + start time, stale-lock check), a second runner is refused; unique workdirs by construction in call-host | `experiments/jit/run-compiled.mjs`, `experiments/jit/call-host.mjs` | design | 0.5 day |
| 13 | **Multi-day waits impossible on shipped surfaces** (b14; B8) | 3 | 3 | 9 | adopt Trigger.dev: the run budget counts work (active time), waits are bounded by their own timers; a CLI/MCP option to set the run lifetime | `src/runtime.mjs` (deadline), `bin/foundry.mjs`, `src/mcp.mjs`, `src/http.mjs` | design; **owner decision** on defaults | 1 day |
| 14 | **No /proc**: orphans not reaped, pid reuse wedges a run, `--force` refuses while the message recommends it (c2; C3) | 2 (owner's hosts are Linux) / 4 (macOS users) | 4 | 8-16 | build: a heartbeat lease in the store (owner refreshes every few seconds; liveness = pid answers AND heartbeat fresh; without /proc the heartbeat decides); a `ps`-based process table on macOS/BSD; fix the advice text | `src/runtime.mjs` (alive), `src/children.mjs`, `src/control.mjs`, `src/store.mjs` | design | 1.5 days |
| 15 | **Every stop lacks continuability and next action** (g1; G1 4/4) | 5 | 2 | 10 | adopt Conductor's failure contract: a `remedy` per stop code (resume after T, raise budget, reconcile effect X, free space) in the verdict and the CLI output | `src/verdict.mjs`, `bin/foundry.mjs`, `web/` | design | 0.5 day |
| 16 | **Harness version drift unrecorded** (d2; D4; incident I3) | 4 | 2 | 8 | adopt the Agent SDK's per-connect version check: re-probe when the binary's inode/mtime changes; verify-run warns `MIXED_ENGINE_VERSIONS`; pin the CLI (`DISABLE_AUTOUPDATER`) for paid and sealed runs | `src/models/providers/claude-cli.mjs`, `src/verify-run.mjs`, run launchers | design | 0.5 day |
| 17 | **Limits are per process, not per host** (a8): two orchestrators each use the full provider concurrency | 4 | 2 | 8 | adopt keyed concurrency (Inngest/Hatchet/DBOS): a workspace-level semaphore table per provider/key in SQLite | `src/models/port.mjs`, `src/store.mjs` | design | 1 day |
| 18 | **Cancel window**: nodes start during the 250 ms poll after a cancel (a11; A7) | 3 | 2 | 6 | build: refuse a start inside its own update once `cancelRequest` is set | `src/runtime.mjs` (checkBudget) | **patch 02**, A7 pass; `tests/cancel.test.mjs:699` expects the question node left open and must change (the question is no longer asked after the cancel) | 0.25 day |
| 19 | **Clock steps** fail or stall runs (b15; C4, C5) | 2 | 3 | 6 | build: elapsed budgets on `performance.now()` within a process; wall clock only for `at` timers; detect a step (wall delta vs monotonic delta) and name it | `src/runtime.mjs` | design | 0.5 day |
| 20 | **A deaf capability outlives its timeout and makes a pure node `uncertain`** (a3; A4) | 2 | 3 | 6 | build: a timed-out pure capability is a retryable failure; long or untrusted capabilities run out of process so a timeout kills them | `src/runtime.mjs` (task), `src/capabilities.mjs` | design | 0.5 day + |
| 21 | **The executor's own abort reads as `EXECUTOR_PROTOCOL`, which runners retry as an environment fault** (d3; probe L3) | 3 | 2 | 6 | build: a `CANCELLED` branch in `sessionError` when the caller's signal aborted | `src/executors/claude-code.mjs:277-286` | design (5 lines) | 0.1 day |
| 22 | **No single flight for identical calls** (a9; A9) | 2 | 2 | 4 | adopt Restate attach-to-running | `experiments/jit/call-host.mjs` | **patch 08**, A9 pass; `call-host` 9/9, `call-host-slice2` 7/7 | 0.25 day |
| 23 | **Queued agent nodes hold reservations** (a10) | 2 | 2 | 4 | reserve at admission | `experiments/jit/call-host.mjs:576` | design | 0.25 day |
| 24 | **No liveness signal for long src nodes** (a2, g4) | 3 | 2 | 6 | adopt heartbeats (Temporal, Conductor `responseTimeoutSeconds`): agent/task nodes report progress; status shows "retrying (429, attempt 4, next in 20 s)" / "parked until 15:00" | `src/runtime.mjs`, `src/http.mjs`, `web/` | design | 1 day |
| 25 | **No executor conformance kit**: Codex/OpenCode/Gemini executors are not probed (d8) | 3 | 2 | 6 | build: run P0-P8 (`experiments/orch/probes/cli-stub-api.mjs`) against each harness before paid use | `experiments/orch/probes/` | design | 1 day per harness |

Total: about 6 days for ranks 1-12 that have patches or short designs (ranks 1, 2, 3, 4, 6, 7, 18, 22 are written and
validated: about 3.5 days to land with tests), about 12-15 days for all 25.

**Landing order and constraints.** (1) Wait for COMP-1 and SOP-bench to finish: patches 01-05 and 09 change `src/runtime.mjs`,
so the engine hash changes and every in-flight or parked run refuses to resume (`ENGINE_DRIFT`); patch 07 changes flow-v3
behaviour, a confound for any experiment mid-stream. (2) Land rank 5 (engine compatibility ranges) first if anything long-lived
must survive later fixes. (3) Land 01-09 as one engine version with the test updates listed above, then re-run
`experiments/orch/chaos.mjs` and require at least the 32 passes of the patched copy. (4) Then the designs, highest score first.

## 3. Plumbing the system must own, so the user never sees it

- **Outages**: retry, back off, honour `retry-after`, park and resume after the reset; never escalate on an outage; never stack
  retries on the CLI's own (P1: the CLI already retries for about 3 minutes). (Ranks 1, 6, 8.)
- **Quota**: read the CLI's `rate_limit_event`, throttle before the limit, schedule after `resetsAt`. (Rank 8.)
- **Budgets**: dollars, tokens and compute time, reserved before spending, carved down the tree, with defaults that bound a $0
  model. (Ranks 2, 9.)
- **Process hygiene**: every child dies with its owner; every group is on file; a supervisor resumes crashed and due runs without a
  human (today only `foundry tick` and a human resume do), with the crash-loop bound. (Ranks 3, 14, 24.)
- **Interruptions**: Ctrl-C and SIGTERM are not failures; cancels stop new work at once and propagate down to flow-v3 children.
  (Ranks 4, 10, 18, 21.)
- **Storage**: typed disk-full, free-space pre-flight, torn-tail repair, no run lost to a full disk. (Rank 7.)
- **Isolation between orchestrators**: workdir locks, host-level concurrency per provider, single flight, stop-all by identity
  never by name. (Ranks 12, 17, 22.)
- **Fingerprints**: the harness version per call, mixed-version runs flagged. (Rank 16.)
- **Accounting of the unknown**: an intent before every paid call, bounded unknown spend after a crash. (Rank 11.)
- **Clocks**: monotonic budgets; clock steps named. (Rank 19.)
- **Status text**: cause, continuable or final, next action, for every stop and every park. (Rank 15.)

## 4. Things the user must decide

1. **Default budgets**: tokens per run (patch 09 proposes 5 M runtime and 5 M per gateway session), dollars per run, compute
   minutes for local models; and whether a budget stop **pauses** (resumable after an amendment) or **fails**.
2. **How long to wait out an outage**: the inline retry window (patch 04: 3 retries, each at most 60 s) and the park limit
   (patch 04: 8 parks, 15 min per usage-limit park), after which the outage is the run's result.
3. **Run lifetime vs waits**: today 1 h for every shipped surface; multi-day waits need a new default or a flag (rank 13).
4. **Quota share**: what fraction of the subscription window Foundry may use while other agents run (rank 8 threshold), and how
   the provider concurrency is split between orchestrators on one host (rank 17).
5. **CLI pinning**: disable the CLI auto-updater for paid and sealed runs (I3) or accept per-call version records only.
6. **Engine migration**: may a run created under engine version N resume under N+1 when the change is marked compatible?
   (Rank 5; today: never.)
7. **Uncertain effects**: only the owner of the external system can say whether a payment or email went out; Foundry can name
   the effect, its idempotency key and the evidence, not decide it.
8. **Supported hosts**: Linux full support; macOS needs the watchdog and the `ps` process table (rank 14); Windows unsupported
   for executors (WORST-CASE c4).
9. **Crash-loop bound**: how many unexplained owner deaths a node may cause before it is quarantined (today: its
   `retry.maxAttempts`; DBOS uses 100 per workflow).

## 5. Patch files

| file | what | validated by | tests to update |
|---|---|---|---|
| `patches/01-storage-full-typed.patch` | keep the original error when SQLite already rolled back; `STORAGE_FULL`/`STORAGE_UNAVAILABLE` typed and classified as environment faults | C1 | none (`store-atomic` 4/4) |
| `patches/02-cancel-stops-new-starts.patch` | `checkBudget` refuses a start once `cancelRequest` is in the record | A7 | `tests/cancel.test.mjs:699` |
| `patches/03-graceful-interrupt-keeps-attempt.patch` | `run_interrupts` written by the CLI's signal handler; `recover(graceful)` refunds the attempt of pure/idempotent tasks | G2, B1, B7 | none (`cli-interrupt` 2/2) |
| `patches/04-outages-retry-then-park.patch` | inline retries honouring retry-after, then park agent nodes with a timer; CLI text kept in rate-limit errors | B9, D1, D3 | `tests/runtime-agent.test.mjs:139-152` |
| `patches/05-lifeline-pdeathsig-and-track-executors.patch` | `lifeline()` (setpriv PDEATHSIG) at every spawn; executors record their groups | B2, B3, B4 | three tests in `tests/cli-cancel.test.mjs` that assume the orphan survives |
| `patches/06-runner-infra-faults-and-torn-tail.patch` | infra codes and SQLite-full text are environment faults; a torn results tail is ended before appending | C2 | none |
| `patches/07-flow-v3-outage-never-escalates.patch` | flow-v3 judge stops with `ENV_EXIT` on an outage; run-compiled reports an environment fault | D2 | none (`flow-v3-call` 7/7, `flow-v3-slice2` 10/10) |
| `patches/08-call-host-single-flight.patch` | an identical flow.call in flight is joined | A9 | none (`call-host` 9/9, `call-host-slice2` 7/7) |
| `patches/09-token-budgets.patch` | `budget.maxTokens`, runtime default 5 M, `TOKEN_BUDGET`; gateway token cap | E2 | none run beyond the chaos suite: run `runtime-agent`, `models-port`, `acceptance-lint` after landing |

The patches apply in order to the commit this study read (`git apply patches/0N-*.patch` in sequence); each was produced as a
diff against the previous one on a scratch copy.
