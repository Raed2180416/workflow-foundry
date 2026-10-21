# Engine bump 2026-10-21 (PLAN-3DAY Day 2, pulled forward from 11-04)

*Development evidence. Everything here was built and tested in an isolated worktree with synthetic capabilities and scripted
models ($0); no paid call was made. Inputs: [../orch-20261021/GAPS-AND-PLAN.md](../orch-20261021/GAPS-AND-PLAN.md),
[../compromises-20261021/REGISTER.md](../compromises-20261021/REGISTER.md) (C2, C6, D1),
[../business-20261021/ATTACK-FABLE.md](../business-20261021/ATTACK-FABLE.md) §2-§3.1, [../decisions-20261021.md](../decisions-20261021.md) (D15).*

## 1. Engine compatibility ranges (gap rank 5)

**Problem.** A run records `engineHash`, the sha256 of a descriptor of every engine source file plus the Node version, platform,
architecture and validator version (`src/engine.mjs`). Resume refused any other hash (`ENGINE_DRIFT`), so every engine change,
including each fix in this bump, stranded every in-flight and parked run (incident I8).

**Mechanism (the smallest sound one).** Temporal's answer is `patched()`: new code keeps the old branch under a marker so an old
history replays the same way. Foundry does not replay code (it resumes from a checkpoint and a journal), so the requirement is
weaker: the new engine must read an old run's record correctly. That is a property of a release, reviewed once, so it is declared
once per release rather than per branch:

1. **Lineage, in the engine.** `src/engine-lineage.json` holds this engine's `version` (an integer), `resumesFrom` (the oldest
   version whose runs it may resume) and, for each predecessor, its exact file map (name to sha256). The file is in the hashed
   set of `src/engine.mjs`, so changing a declared range is itself an engine change, and it is reviewed source: no model, run or
   host option can widen it. `src/engine.mjs` validates it at import (a malformed lineage fails like a syntax error).
2. **Recognition is exact.** A recorded hash is a predecessor only if the predecessor's file map, combined with *this host's*
   Node version, platform, architecture and validator, hashes to it (`engineOf`). Nothing is trusted from the run record. A run
   created under another Node or validator version is not recognised: a platform change is not a declared migration.
3. **Resume.** `Runtime.execute`: same engine, as before. A recognised predecessor with `version >= resumesFrom`: the run resumes,
   and the same store transaction that takes ownership (`runner.acquired`) appends `engine.migrated {from, to, fromVersion,
   toVersion, resumesFrom}` and moves the record's `engineHash` to this engine, compare-and-swap on the old value
   (`STATE_CONFLICT` if another process moved it). Anything else: `ENGINE_DRIFT`, now naming the recorded version and the range.
4. **One way.** Because the record then names the newer engine, an older engine refuses the run (`ENGINE_DRIFT`): it cannot
   resume a record a newer engine has written.
5. **The chain decides.** `engineBinding(events)` (`src/audit.mjs`) is the engine the chain binds: the birth engine, then each
   migration, each of which must start from the engine bound before it. The runtime (`ENGINE_BINDING_CORRUPT`), `identityChanges`
   and `verify-run` compare the record with it, so an edited `engineHash` without a migration event is still caught.
   `verify-run` reports each migration (`ENGINE_MIGRATED`, info), an inconsistent migration chain (`ENGINE_MIGRATION_INVALID`,
   error), and judges "same engine" (verdict recompute, wait replay) against every engine the run ran under.

**This bump.** Version 1 is commit 96cab64 (the engine of every run in flight on 2026-10-21; on the owner's host,
node v24.21.0 / linux x64 / ajv 8.20.0, its hash is `358cb020…caad9f6`, and `engineOf` recognises it). Version 2 is this bump and
declares `resumesFrom: 1`, because every change in it reads version-1 records as version 1 wrote them (section 2 lists them and
why). Release procedure: `node tools/engine-lineage.mjs` on version N prints the entry to freeze into N+1's `predecessors`; set
`version` and `resumesFrom`; list the changes.

**Tests.** `tests/engine-binding.test.mjs` (6/6): version 1 recognised on this host; the chain decides the bound engine; and an
end-to-end run in three real engine copies (child processes): a run created by a predecessor resumes under a successor that
declares it compatible, with exactly one `engine.migrated` committed just before `runner.acquired`; a successor that lists the
predecessor but no longer resumes its version refuses without writing; the predecessor refuses the migrated run; the run then
completes and `verify-run` is `ok` with `ENGINE_MIGRATED`.

**With the real version 1.** [v1-to-v2/v1-to-v2.mjs](v1-to-v2/v1-to-v2.mjs): commit 96cab64's `src/` and `schemas/` extracted with
`git archive` created a run (a task, then a human question) and parked it (`awaiting_human`, engine hash `358cb020…`); this
worktree's engine (version 2, hash `02c91af7…` at the time of the check) resumed it: one `engine.migrated` (1 → 2), the answer was
taken, the run `succeeded` with verdict `pass`, and `verify-run` was `ok` with the single finding `info:ENGINE_MIGRATED`.

**Limits.** (a) Platform drift (a Node upgrade) still strands runs; a lineage could later declare platforms too. (b) The
historical-outcome observers (`src/outcome-repair.mjs`, `src/outcome-history.mjs`) pin their own bytes and `src/data.mjs`, and
compare the birth engine with the record: they refuse a migrated run (`OUTCOME_EVIDENCE`), which fails closed; they were left
unchanged on purpose. (c) A declared range is a reviewer's judgement that the new engine reads old records correctly; the tests
check the mechanism, not that judgement.

## 2. Orchestration patches 01-09, landed

Applied unchanged and in order (`git apply`), as one engine version with the compatibility range above. Test updates the plan
named: `tests/runtime-agent.test.mjs` (outages now retry on the same model, honouring retry-after, then park; the "never escalate,
no other model" assertions hold, and a parked node resumes on the same model within its attempt), `tests/cancel.test.mjs:699` (the
question is no longer asked after the cancel: the node ends `failed`/`CANCELLED`), and three `tests/cli-cancel.test.mjs` tests
(fate-sharing aware: where `setpriv` exists the sandbox or CLI dies with its owner; the CLI's helper, a grandchild in its group, is
still reaped through the group on file). Found while landing, not named by the plan: `experiments/lib/runner.test.mjs` pins the
environment-fault classes (patch 06 adds the infrastructure codes), `tests/verdict.test.mjs` pins the inconclusive codes (patch 09
adds `TOKEN_BUDGET`), and patch 05's lifeline turned a missing binary into "exited with 127" (`PROCESS_FAILED`) instead of
`PROCESS_LAUNCH` and showed `setpriv` to a test's spawn mock: `src/children.mjs` `lifelineExecFailed` restores the launch failure,
and the mock in `tests/evaluator-audit.test.mjs` unwraps the lifeline (8 tests); patch 09 binds the runtime's default `maxTokens`
into every new run's policy, so trials now reserve the host's token bound in their policy (`src/trials.mjs`; its hash must match the
run's) and the legacy-store fixture in `tests/store-rows.test.mjs` allows that runtime addition, as it already allowed `dispatch`.
On the experiment side: `experiments/jit/stats.mjs` keeps a copy of the environment-fault codes pinned to `runner.mjs` (updated);
`experiments/jit/test/slice2-wiring.test.mjs` pinned `flow-v3.mjs` to its pre-patch-07 bytes (`15da5c24…`, which are SOP-Bench p2's
frozen SDK copy, untouched; the pin moved) and expected a host check's three identical leaf calls to run three times (patch 08 joins
them: one judge is paid).

Chaos (`nice -n 15 node experiments/orch/chaos.mjs`): repository before this bump 20/43; scratch copy with the patches 32/43;
this worktree after the patches 32/43 with the same 11 failures
([../orch-20261021/chaos-landed/patches-01-09/MATRIX.md](../orch-20261021/chaos-landed/patches-01-09/MATRIX.md)); with everything in
this bump **35/43** ([../orch-20261021/chaos-landed/MATRIX.md](../orch-20261021/chaos-landed/MATRIX.md)): G1, F1 and D4 turned green
(section 3); the 8 left are design-only ranks: A4 (20), B8 (13), B10 (10), B11 (11), C3 (14), C4 and C5 (19), E1 (9).

## 3. Small validated fixes

| rank | fix | evidence |
|---|---|---|
| 21 | `sessionError({cancelled})`: a session the caller aborted, with no result, is `CANCELLED`, not `EXECUTOR_PROTOCOL` (which runners retried as an environment fault); an abort before launch reads the same | `tests/executor-sandbox.test.mjs` (unit cases and an end-to-end abort of a fake CLI) |
| 15 | `REMEDIES` and `remedyOf(run)` (`src/verdict.mjs`): for every stop (failed, cancelled, uncertain, parked on an outage, waiting, awaiting a person or an approval) the code, cause, whether the run can continue and the next action, naming real commands; sealed in terminal verdicts as `verdict.remedy`; `Foundry.publicRun` adds it to CLI, HTTP and MCP output | chaos G1 green; `tests/verdict.test.mjs`. G1's extraction now also reads `remedyOf(record)` (a parked run has no error and no verdict); its checks are unchanged |
| 12 | `experiments/lib/workdir-lock.mjs`: a lock file per workdir, created complete and exclusively (a private `O_EXCL` file hard-linked into place), holder = pid + start time, stale locks moved aside atomically; `runCompiled` refuses a second run in a held workdir (`refused`, `WORKDIR_BUSY`, nothing spent; an environment fault), call-host locks its interpret and agent workdirs. Call-host child workdirs are now unique by construction (host tag + sequence): one host serves several check cases whose child spans repeat, so concurrent cases used to share (and clobber) one workdir | chaos F1 green; `experiments/lib/workdir-lock.test.mjs`; the jit suite |
| 16 | the claude-cli provider asks `--version` on every call (the per-connect check; about 50 ms, measured, against calls of seconds) instead of once per binary per process; `verify-run` warns `MIXED_ENGINE_VERSIONS` when one harness served a run in two versions | chaos D4 green (calls a, b, c record 2.1.300, 2.1.306, 2.1.306; the run is flagged) |

## 4. Pinning the Claude CLI by bytes (compromise C2)

- **Lock**: [../manifests/claude-cli.lock.json](../manifests/claude-cli.lock.json), version 2.1.306, sha256 and size per platform
  copied from `https://downloads.claude.ai/claude-code-releases/2.1.306/manifest.json` (fetched over HTTPS); the CLI installed on
  this host hashes to the linux-x64 entry. Second root: the npm registry's sha512 for the 2.1.306 package (a launcher, not the
  binary's bytes). **The manifest's signature is not verified**: its issuer fingerprint is `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`
  (consistent with the documented `31DD DE24 … CACE`), but the key from keys.openpgp.org carries no user ID and GnuPG refuses it;
  verify once with the publisher's full key.
- **Resolve**: `src/cli-pin.mjs` `resolveCli()` returns the absolute path `.foundry/cli/<sha256>/claude` only after checking its
  bytes (hashed once per process, re-hashed when device, inode, size, mtime or ctime change); `CLI_DRIFT` on other bytes,
  `CLI_UNPINNED` when the pin is not acquired; never a fallback to PATH. Pinning is on when a lock is named (`FOUNDRY_CLI_LOCK`,
  the owner's launcher for paid and sealed runs); off, behaviour is as before plus the per-call version.
- **Fetch**: `scripts/fetch-cli.mjs` puts the raw binary there from the release URL (HEAD-checked: 200, 290532720 bytes) or from a
  local file (`--from`, a hard link when possible), accepts it only with the locked size and sha256, never runs `npm install`,
  refuses below 1 GB free, and keeps at most two versions, never the lock's or one an unfinished run's `launch.json` names. Not run
  here (a fetch is 290 MB; disk was 2.8-3.8 GB free).
- **Wiring**: the claude-cli provider runs the pinned path and names its sha256 in `engineVersion`; a pin that cannot be honoured
  fails as `MODEL_PROTOCOL` naming the `CLI_` code (a harness fault, never retried as an outage). `runClaudeCode` runs the pinned
  CLI, kept read-only inside the sandbox. `DISABLE_UPDATES` joins the closed child-env list; policy 2026-10-21.3 sets
  `DISABLE_AUTOUPDATER` and `DISABLE_UPDATES` for `claude -p` children, and every executor session gets both. autobench's
  `launch.json` records `cli {version, sha256, pinned}` and a resume on other bytes is refused (`cliPinChange`); a launch that
  predates the field continues and records the CLI it resumed with.
- **Tests**: `tests/cli-pin.test.mjs` 5/5 with fake CLIs (the 2.1.300/2.1.306 incident replay, a fake `claude` first on PATH never
  launched, a 1-byte tamper is `CLI_DRIFT`, bumping the lock is refused on resume, GC never deletes a pinned or referenced version)
  and one check that hashes the installed CLI against the lock. The probe stub `experiments/orch/probes/cli-stub-api.mjs` drives the
  real CLI against a scripted API; it cannot stand for two CLI versions, so it is not used here.

## 5. The principal model (compromise D1)

`src/principals.mjs`, in the vocabulary of OT-0's constitution (roles; principals `{id, kind, roles}`; a class id `cust:*`):

- **IR** (optional; a workflow without it is unchanged, and the schema says so): a human node's `principal: {role, threshold?:
  {amount, above, role}}`; the workflow's `segregation: [{nodes: [A, B, ...]}]`.
- **Matrix**: supplied by the host (`Foundry`/`Runtime` option `principals`, `foundry answer --principals FILE --actor ID`; the
  constitution document works as is), never by the workflow or a model; its hash goes on every authorised answer.
- **Runtime**: the requirement is bound when the question is asked (roles; for a threshold the amount as it stands, and an amount
  that is unreadable or derived from untrusted data counts as above: fail closed). `answer(..., {actor, channel})` refuses no
  matrix (`PRINCIPAL_MATRIX_REQUIRED`), no actor (`PRINCIPAL_REQUIRED`), an unknown actor (`PRINCIPAL_UNKNOWN`), missing roles
  (`PRINCIPAL_ROLE`, naming delegation of authority when the threshold applied), and an actor who answered a node a segregation
  rule sets apart in the same run (`SOD_VIOLATION`, read from the hash-chained `human.answered` events, re-checked inside the
  compare-and-swap update). `human.answered` records `actor`, `actorVerified`, the principal, the roles and the matrix hash.
- **Static**: structure always (`SOD_NODE`: a rule must name principal-bearing human nodes, one each); with a matrix, the workflow
  satisfiability problem (list colouring by backtracking; a class supplies many distinct actors): `PRINCIPAL_ROLE_UNHELD`,
  `SOD_UNSATISFIABLE` (errors), `SOD_UNSATISFIABLE_ABOVE_THRESHOLD` (warning), else a satisfying assignment as evidence. A run is
  refused at creation if its workflow is unsatisfiable under the host's matrix; resume checks structure only (people change roles).
- **Surface**: patch 0001 applied (MCP `foundry_apply_proposal` carries `anthropic/requiresUserInteraction`). MCP has no answer
  tool; the actor is only as authenticated as the channel (CLI flag, local HTTP) — authentication is the host's.
- **Not covered**: effect approvals (`approve`, gated capabilities) still take the single `user` actor; dynamic SoD across runs
  (the monitor's job); roles on `wait`/signal deliveries.
- **Tests**: `tests/principals.test.mjs` 5/5 (with constitution v1, which as written has nobody holding finance-approver +
  controller, so the above-threshold path is reported `PRINCIPAL_ROLE_UNHELD`); `tests/mcp-annotations.test.mjs` 2/2.

## 6. Mercury-only sessions

`validatePolicy(policy, {executorOnly})`: an executor-only session subset (`subsetPolicy(owner, ['mercury-3'])`) may have an empty
`models[]`; the owner file and the Runtime still need one. Class resolution reads `models[]` only, so it reaches nothing
(`MODEL_CLASS_EMPTY`), and every call names its executor model. Test: `tests/openai-chat-provider.test.mjs`.

## 7. Designs not built in this bump (ranks 8, 9, 11)

Not implemented here (the brief excludes ranks 8 and 9; 11 is design-only). Each keeps the rules: compare-and-swap state, the
model never holds execution authority, nothing falls back silently.

### 7.1 Rank 8: a quota throttle from the CLI's own `rate_limit_event`

**Fact** (PROBES L1, live): every Claude Code session prints `rate_limit_event {status, rateLimitType, unifiedWindows: {five_hour:
{utilization, resetsAt}, seven_day: {...}}, overageStatus}` on its stream. Today nothing reads it; the limit is discovered by
killing agents.

**Design.** (1) *Observe*: `runClaudeCode` already parses stream-json; it records the last `rate_limit_event` in its result
(`quota: {window, utilization, resetsAt, observedAt}`). The `claude -p` provider uses `--output-format json`, which carries no
such event; switching it to stream-json is a provider change with its own replay-key review, so the provider records quota only
when it sees it. (2) *Share*: a workspace table `quota(account, window, utilization, resets_at, observed_at, source)`, written
with an upsert that keeps the newest observation (compare-and-swap on `observed_at`), so concurrent orchestrators on one host see
one picture (rank 17's keyed table is the same shape). (3) *Throttle*: before launching a session or a provider call, a host
policy `quota: {pauseAt: 0.9, resumeBelow: 0.8}` (an owner decision, GAPS §4 item 4) is consulted; above `pauseAt` the agent node
parks exactly as an outage park does (patch 04's `ENV_PARK`, status `waiting`, timer at `resetsAt` plus jitter, remedy
`resume-after`), so the run continues by itself after the reset and the user sees why. Never a model switch, never a silent
skip. (4) *Evidence*: the park event records the observation that caused it. **Tests**: a fake CLI emitting a
`rate_limit_event` with utilization 0.95 parks the next launch until `resetsAt`; two processes sharing a workspace see the same
row; an observation older than the current one never overwrites it. **Cost**: 0 tokens; one SQLite upsert per session.

### 7.2 Rank 9: dollar reservations in the runtime, and a budget stop that pauses

**Fact** (chaos E1): 40 calls at $0.10 with 16 in flight under a $1.00 cap spent $1.10; the runtime checks the cap after each
call and a budget stop is final. The flow-v3 gateway already reserves (`experiments/lib/services.mjs` `reserveFor`/`hold`).

**Design.** (1) *Reserve at admission*: `modelLoop` computes a reservation before each call, `min(per-call cap, list-price
estimate of the compiled request)` (the provider's `maxBudgetUsd` is the hard per-call cap), and admits the call only if
`run.cost + run.reserved + reservation <= costLimit`. The reservation is written in the same store update that charges the node's
step (`run.reserved += r`, node `reservedUsd`), so two owners cannot both admit past the cap (the run header is the CAS unit).
(2) *Settle*: `chargeModel` moves the reservation to actual spend (`reserved -= r; cost += actual`); an unknown-cost call settles
at its bound. (3) *Recover*: a crash leaves `run.reserved > 0`; recovery books each unsettled reservation as bounded unknown spend
(this is rank 11's intent row seen from the budget side) and releases it. (4) *Pause, not fail*: when the next call does not fit,
the run parks with `COST_BUDGET` as a remedy-bearing stop (`continuable: true, action: 'raise-budget'`) instead of failing; a new
chain event `budget.amended {maxCost, by, reason}`, accepted only from the host's channel (CLI `foundry amend-budget RUN --max-cost
N`, never MCP or a model), raises the bound policy's cap by compare-and-swap, and `identityChanges` compares the record's policy
with the birth policy plus the recorded amendments (as the engine binding does with migrations). Whether a budget stop pauses or
fails stays an owner decision (GAPS §4 item 1); the default remains "fail" until decided. **Tests**: E1 (spend ≤ cap with 16 in
flight; resumable after an amendment), a crash between reservation and settlement books bounded unknown spend, a forged
amendment in the record without its event is `RUN_IDENTITY_EDITED`.

### 7.3 Rank 11: an intent row before every paid call

**Fact** (chaos B11): a fan-out of 20 calls killed twice made 28 provider calls and left 20 journal rows: calls in flight at a
crash leave no row and no bound (the row is written after the provider answers).

**Design.** (1) `ModelPort.call` writes `model_calls` row with `state: 'intent'`, the request digest, the replay key and the
per-call cap (`costUpperUsd`) **before** it invokes the provider, in its own transaction; the provider answer updates that row to
`ok`/error (`state: 'settled'`) instead of inserting a new one, so the journal id is known before the call. (2) The runtime
charges a node at intent time with the bound as `costUnknownUpperUsd` and replaces it with the actual cost at settlement (the
existing `journalIds` de-duplication keeps a re-charge after a crash idempotent). (3) Recovery (`recover`, and verify-run)
treats an intent row with no settlement as a call that may have been answered and billed: it is booked as bounded unknown spend
(`costUnknownCalls += 1`, upper bound = its cap), never replayed as an answer, and never silently dropped; a resumed attempt
makes a new call with a new intent. (4) The journal seal and `journalRowsAfter` count intent rows, so a deleted intent is
detectable. **Tests**: B11 (every provider call has a row; the run's unknown bound covers the in-flight ones), replay never serves
an intent row, verify-run flags an intent row whose settlement was edited. **Cost**: one extra SQLite write per call (the
journal already writes one).
