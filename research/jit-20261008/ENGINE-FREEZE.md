# ENGINE-FREEZE: engine freeze record for R0, R0-K and the held-out run (S0-4)

> **E1 — stamped 2026-10-09 at HEAD `587946e1ceeb41c8999146e3b6bb0363c2d91849`.**
> - `experiments/` changes do not alter the kit hash.
> - Any change to `src/`, `policy/`, `schemas/`, `bin/` or `skills/` does. So do `web/`, `package.json` and
>   `node_modules`, which are also in the kit allow-list.

*Stamped on the owner's laptop. The source is the committed tree at HEAD; at stamping, `git status --porcelain src policy
schemas bin skills package.json package-lock.json web experiments` was empty. Rule: ROADMAP §6 rule 13, "no comparative
run starts on an engine that is still changing", and §4.3. Requested by [BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md)
§2.0, S0-4, which also needed owner question Q6 (heal kit policyDrift). Q6 was decided on 2026-10-09 (see §4). The stamp
commit itself changes only `research/`, so the kit hash and the engine trees below are those of the commit after it too.*

## 0. History

- `7b8fc47`: draft E1 candidate, kit hash `94c3360e18e2d0d3` (and the policy hash `cfe79728…` from `38f74fd`).
- `b018f5d` (2026-10-09 16:35 +0530): executor sandbox fix (ISOLATION-PROBE-laptop §6): allow-list env, narrow `keepRo`,
  private `/dev`, nested-userns uid drop, `$0` for startup bails. Kit hash `fb4154deec675f2a` on that tree. The draft
  values were stale from here.
- `587946e` (2026-10-09 16:56 +0530): S0-2, `src/models/port.mjs`: the ModelPort journals `request.decoding`, the decoding
  as requested, for exact replay digests. Kit hash `a572eeee1ac237aa` on that tree. This is the last `src/` change.
- This stamp: every §1 value recomputed on `587946e` with a clean tree.

## 1. Values

| item | value | how it was computed |
|---|---|---|
| HEAD commit | `587946e1ceeb41c8999146e3b6bb0363c2d91849` | `git rev-parse HEAD` |
| last commit touching `src policy schemas bin skills web package*.json` | `587946e` (2026-10-09 16:56 +0530, "S0-2: journal requested decoding for exact replay digests …"). Before it: `b018f5d` (sandbox fix), then `38f74fd` (Jev in the model policy) | `git log -3 -- <paths>` |
| tree ids at HEAD | `src` `5bacd257e4a54c0a680dae60b42f997f1ab66de1`<br>`policy` `80f34241ba967bba9fabd0cd667ab6a968fbf5c0`<br>`schemas` `3f614545f4c8d70a51aa7e19c3c1c6eda744297a`<br>`bin` `3b481c7bf14e58ab097c6ed443a360a71bc19ac3`<br>`skills` `88183bd45a9fea4fdc9df999fd5d001565c8c84b`<br>`web` `c6017c1890be4cfc3bd192ea264cca7395266a5c`<br>`package-lock.json` blob `5fe7475cc474126b7c0f2795fd2b114684fd0381` | `git rev-parse HEAD:<path>`. Only `src` moved since the draft; `policy`, `schemas`, `bin`, `skills`, `web` and the lockfile are unchanged |
| **construction-kit hash (F kit)** | **`a572eeee1ac237aa`**: 3926 files, including `node_modules` from `npm ci --ignore-scripts` on the lockfile | `experiments/lib/kit.mjs` `kitHash()`: sha256 over (path, bytes) of `KIT_ALLOW` = `package.json bin src schemas policy skills web node_modules`, first 16 hex. This is the value C0 records as `kitHash` (`experiments/c0/construct.mjs:138`, `run-dev.mjs:43`) |
| kit hash without `node_modules` (diagnostic only) | `36f0df8c91080baf` (98 files) | `kitHash({ allow: [...KIT_ALLOW minus node_modules] })` |
| B1 script kit hash | `6bc6b06eccf45cae` (unchanged) | `kitHash({ allow: SCRIPT_KIT_ALLOW })` (`skills/script-harness`) |
| **policy hash** of `policy/models.json` | **`cfe79728f185334b3f352cd77daa4ad6f732cfb810af9bde91a50369456bc297`** (`policyVersion` `2026-10-09.1`; unchanged since `38f74fd`) | `src/models/policy.mjs` `loadPolicy(file).hash` (`policyHash` of the validated policy) |
| Node | `v24.21.0` | `/opt/node24/bin/node --version`. Installed by the pinned, sha256-verified `scripts/setup-node24.sh` |
| **sandbox: executor (`runClaudeCode`) flags** | outer `unshare --user --map-root-user --mount --pid --fork --kill-child --mount-proc sh -c <script>` (`UNSHARE_ARGS`, `src/executors/claude-code.mjs:163`). The script runs the mask steps as the namespace root, then ends with `exec unshare --user --map-user=<host uid> --map-group=<host gid> <binary> …` (`dropUidArgs`, `sandboxScript`, lines 149 and 242): the program runs one user namespace deeper as the host uid, with no capabilities over the mount namespace (the CLI's root check passes honestly; no mount, umount or remount is possible) | read from the code at HEAD; availability probe `sandboxProbeArgs` has the same shape. Measured in [ISOLATION-PROBE-laptop.md](ISOLATION-PROBE-laptop.md) (§6 for the fix) |
| sandbox: executor environment | `executorEnv()`: only the names in `EXECUTOR_ENV_ALLOWED` (plus `LC_*`), then `TMPDIR=/tmp`, `HOME` (a hidden root, `executorHome`) and `extraEnv`. Allowed names: `PATH LANG LC_ALL TERM USER LOGNAME CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC FORCE_PROMPT_CACHING_5M DISABLE_TELEMETRY DISABLE_ERROR_REPORTING DISABLE_AUTOUPDATER NODE_EXTRA_CA_CERTS NODE_USE_SYSTEM_CA HTTPS_PROXY https_proxy HTTP_PROXY http_proxy NO_PROXY no_proxy`. `extraEnv` refuses `SCRUBBED_ENV` names and any credential-like name except `FOUNDRY_MODEL_GATEWAY_TOKEN`. `scrubEnv()` (the deny-list) is no longer the executor's environment; it stays as the claude-cli provider's scrub | `EXECUTOR_ENV_ALLOWED`, `executorEnv` (`src/executors/claude-code.mjs:97–122`) |
| sandbox: executor mask on this host | `DEFAULT_HIDDEN` plus `os.homedir()` = `/home/raed`; `/var/log` hidden (new in `b018f5d`). `/dev` is a fresh read-only tmpfs holding only `DEFAULT_DEVICES` (`null zero full random urandom tty`) bound from the host, a private `/dev/shm` and a new devpts instance (no GPU, disks or host ptys). `DEFAULT_KEEP_RO` = `binaryKeeps()` (not whole `~/.local/bin`): on this host with `/opt/node24/bin` on `PATH` it is `/root/.ccr`, `/home/claude/.claude/remote`, `~/.local/bin/claude`, `~/.local/share/claude/versions/2.1.295`, `/opt/node24/bin/node`. It depends on `PATH` and on the installed CLI version at import time | `DEFAULT_HIDDEN`, `DEFAULT_KEEP_RO`, `DEFAULT_DEVICES`, `maskSteps` (`b018f5d`) |
| sandbox: `runSandboxed` | as the executor: the same `UNSHARE_ARGS` (so the same masks, private `/dev` and fresh `/proc`), `network: false` adds `--net`. Env is `PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin`, `LANG=C.UTF-8`, `HOME=<workdir>`, plus the caller's `env` (credential names refused). It shares `sandboxScript`, so the program also runs under the nested uid drop | `src/executors/sandboxed-command.mjs`; re-checked against the code at HEAD |
| sandbox: code nodes (`runCode`) | unchanged: `unshare --user --map-root-user --net --mount --pid --fork --kill-child --mount-proc`, an allow-list root, an unmapped inner user (`exec unshare --user --mount`, capabilities checked to be `0000000000000000`), prlimits, and an `env -i PATH=<SAFE_PATH>` environment | `src/sandbox.mjs`; re-checked against the code at HEAD |
| **dev-config arm hashes** | recomputed now; equal to the pins in `experiments/jit/test/stream.test.mjs:431–437` (`V1_HASHES`), tables below. `stream.test.mjs` is 34/34 green | `parseArm(spec, normalizeConfig(config), { policyIds: [...POLICY_MODELS] }).hash` |
| **R0 arm hashes** | `r0-records.json`: five arms, table below. `r0-kinetics.json` is `_blocked` ("relTol TBD: row 2 Stage B"): `normalizeConfig` refuses it, so it has no arm hashes yet and must be re-hashed after Stage B fixes relTol (config change only, no re-stamp of the kit) | same call, `experiments/jit/configs/r0-records.json` |
| JIT engine tree at HEAD (not in the kit hash) | `experiments/jit` `492616321617ed9423f4d2ad7c56830da3a20167`<br>`experiments/lib` `6c414274c0bdb3a2f1da2db47cb4c45bff6a5586`<br>`experiments/jit/flow-v2.mjs` sha256 `5dde46668c10c338074ee4a1ec1115632f18ddca4773a71024b4b6ee18fb5223` (pinned in `compile.test.mjs`) | `git rev-parse HEAD:<path>`; `sha256sum`. `git status --porcelain experiments` was empty |
| **heal replays: frozen kit** | unchanged: commit `880c6b9` (`880c6b91f183a569571480d7ff5d297839a8cdac`); kit hash `7e8f0f83153c5efb`; 87 pinned files, each blob equal to `git rev-parse 880c6b9:<file>` | `experiments/heal/kit.mjs` `KIT_COMMIT = '880c6b9'`, `experiments/heal/pins.json` |
| heal gate pins | `pins.json` `gate.commit` `13f7664`: six `gate.files`, kept as copies in `pinned/src/`. Five equal their blob at HEAD; `src/models/policy.mjs` differs at HEAD since `38f74fd` (Jev), as it did at the draft. The gate runs on the pinned copies | `pins.json`; `git rev-parse HEAD:<file>` |
| heal policy of record (880c6b9) | `fe63f99b9fcdd5bbe53703ee0c1b2d079972bdecfe1ea940a959385190dee2e4` (`policyVersion` `2026-10-07.1`) | `loadPolicy(<frozen>/policy/models.json).hash` (carried from the draft; the frozen kit did not change) |
| frozen-src copy (git archive 880c6b9) | `.foundry/kev-data/frozen-src/880c6b9…/`; manifest hash `sha256:4ba206dfdee4eb850b8d7fba3a232b7dc4ad72a9b16a0583087846a8a8a1f621` | `experiments/kev-data/exec/frozen-src.mjs` `freezeSrc()`; regenerates from git and is verified blob by blob (carried from the draft) |
| **live smoke on this engine** | records `s201` d3, Haiku, sandboxed `interpret`: 245 s, `$0.052`, oracle score 0.998, `costUnknown false`. Run by the coordinator on the main tree after `b018f5d` (the sandbox fix), with the token from the environment | The first smoke failed: [SMOKE-laptop-20261009.md](SMOKE-laptop-20261009.md) (committed in `bb81aff`; run on a clean worktree of `ec8dc30`) describes the CLI root check under `--map-root-user`, which `b018f5d` fixed. The passing run is the coordinator's, recorded in DEV-NOTES D15 and the BLOCKER-SYNTHESIS S0-3 status row; it predates `587946e`, whose change is in the model port (journal) and not in the executor path |

**Dev-config arm hashes (dev-records-1).**

| arm | hash |
|---|---|
| `agent:claude-haiku-5-5` | `838a9040ccea77e5` |
| `agent:claude-sonnet-5-5` | `d5f76da861452d98` |
| `agent:claude-opus-5-5` | `e83c0b59e1d5681e` |
| `static:…/B1-haiku-records-k1/solve.mjs` | `ca4f763d5d03568e` |
| `jit:claude-haiku-5-5/claude-haiku-5-5` | `b1e7a0d2b8ae7d67` |
| `jit:claude-sonnet-5-5/claude-haiku-5-5` | `bba591195f4de46c` |
| `jit:claude-opus-5-5/claude-haiku-5-5` | `2e70574b6dc900d5` |

**Dev-config arm hashes (dev-kinetics-1).**

| arm | hash |
|---|---|
| `agent:claude-haiku-5-5` | `2e292709027b2786` |
| `agent:claude-sonnet-5-5` | `17b451b20087e9a1` |
| `jit:claude-haiku-5-5/claude-haiku-5-5` | `d27d59e72f054502` |
| `jit:claude-sonnet-5-5/claude-haiku-5-5` | `eaabbde77c7bbf68` |
| `jit:claude-opus-5-5/claude-haiku-5-5` | `930045b2ad53db51` |

**R0 arm hashes (`r0-records.json`, dev seeds 225–248).** `r0-kinetics.json` is blocked (see above).

| arm | hash |
|---|---|
| `agent:claude-haiku-5-5` | `838a9040ccea77e5` |
| `static:research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs` | `ca4f763d5d03568e` |
| `jit:claude-sonnet-5-5/claude-haiku-5-5` | `3b9dc642498f5df8` |
| `jit:claude-opus-5-5/claude-haiku-5-5` | `333aabf59174c46d` |
| `jit:claude-haiku-5-5/claude-haiku-5-5` | `2559d6a68fc7e8a3` |

The R0 agent and static arms hash like the dev-records-1 arms. The three JIT arms differ because the R0 config sets other
`jit`/`compile` options (`shadowFloor` 0.25 and `shadowOnFlags` in place of `shadowEvery`, `compare: tolerant`,
`acceptance: strict`, `promptVersion` 4, `acceptanceIds: exact`, `preserveRefusals`).

## 2. What these values do and do not pin

- **Arm hashes do not include the engine.**
  - `stream.mjs:143–148` hashes the arm definition: spec, family, split, budgets, minutes, effort, models, and the
    `jit`/`compile` options.
  - It does not hash the policy hash, the kit hash or the code of `experiments/jit/`.
  - A freeze must therefore record all three alongside the arm hash. For R0, R0-K and the held-out run, each result row
    should carry `{ HEAD, kitHash, policyHash, experiments/jit tree }`, or the run manifest should.
- **The JIT engine lives mostly in `experiments/jit/`**: `flow.mjs`, `flow-v2.mjs`, `stream.mjs`, `compile.mjs`,
  `prompts.mjs` and `acceptance.mjs`.
  - Compile builders get no kit: `compile.mjs` calls `runClaudeCode` without `kitDir`.
  - The kit hash is therefore unchanged by work in `experiments/`, but the JIT engine is not. The tree ids above are the
    JIT half of the freeze.
  - At this stamp the step-0 work in `experiments/jit` is committed (the S0-5 and S0-6 wiring, replay export
    keys, `jit.replayJournal`, `jit.shadowFloor`, `armSpendStopUsd`, the R0 configs) and `git status --porcelain
    experiments` is empty, so the tree ids above are the R0 engine. Any later `experiments/jit` commit moves the JIT tree
    id and must be recorded before the run that uses it.
- **The sandbox rows pin the isolation, not the host.** The executor mask depends on `os.homedir()` and on `PATH` and the
  installed `claude` version (through `binaryKeeps()`), so a different host, shell or CLI upgrade changes the effective
  `keepRo`. The environment is an allow-list (`EXECUTOR_ENV_ALLOWED`), so a new host variable never reaches a session
  unless the list changes, and that is a `src/` change that voids the kit hash.
- **`node_modules` is in the kit hash.** It comes from `npm ci --ignore-scripts` against `package-lock.json`. A
  re-install with the same lockfile gives the same bytes. A different npm or registry tarball could change it, so re-stamp
  after any reinstall.
- **The policy hash changed at `38f74fd`.** Jev was added (`judgmentModels`, `providers.typesafe-systemone`) and so were
  the 2026-10-08 `childEnv` and notes. The policy of record for the C0, P1 and heal evidence is `fe63f99b…` at `880c6b9`.
  New comparative runs use `cfe79728…`.

## 3. Recorded issue, not fixed now

- **Wrong test name in `policy/models.json` notes.** The notes name `tests/model-policy.test.mjs`. The file is
  `tests/models-policy.test.mjs`.
- Fixing the typo changes the bytes and therefore the policy hash (`cfe79728…`) and the kit hash (`a572eeee1ac237aa`). It
  is recorded here and left as it is.
- If it is fixed, do it in the same commit as any other `policy/` change before the held-out run, and re-stamp.

## 4. Q6: the heal-kit policyDrift decision this record depends on

- The owner delegated Q6 with full permissions on 2026-10-09, and the recommended option was taken: **a proved
  judgment-only exemption** in `experiments/heal/kit.mjs` `policyDrift`. See the
  [heal DESIGN note of 2026-10-09](../heal-20261008/DESIGN.md).
- Two entries are ignored only while no file of the frozen kit's `src/` (880c6b9) contains their string:
  - `judgmentModels`;
  - `providers.typesafe-systemone`, and only while no `models[]` entry names it.
- Each exemption is reported in `ignored` with its proof. Anything else stays blocking.
- With it, the live owner policy (`cfe79728…`) passes the heal gate against the policy of record (`fe63f99b…`). Heal
  replays still **run under the policy of record**, so their hashes and replay keys stay those of the recorded runs.
- Heal proposal `p-a3336190-r4` is untouched and is not approved.

## 5. Re-stamp checklist (for a later change)

E1 is stamped (§0). If anything below changes after this stamp and before the held-out run, repeat these steps:
1. Commit, then record `git rev-parse HEAD` and the tree ids.
2. Run `kitHash()` and `loadPolicy('policy/models.json').hash`.
3. Recompute the arm hashes of the R0, R0-K and held-out configs (R0-K only once its relTol is set).
4. Run `node --version`.
5. Re-run the isolation probe, or confirm that `src/executors/` did not change.
6. Write the values into the PREREG.

Any later change to `src/`, `policy/`, `schemas/`, `bin/`, `skills/`, `web/`, `package*.json`, `node_modules` or
`experiments/jit/` before the held-out run voids the stamp.

## 5. E1 re-verification before the R0 launch (2026-10-09 21:15 IST, HEAD `e565cb3`)

Run per R0-RUNBOOK G1 on a clean tree (`git status --porcelain src policy schemas bin skills package.json package-lock.json
web experiments/jit experiments/lib` empty).

| item | value now | vs E1 |
|---|---|---|
| kit hash | `a572eeee1ac237aa` | equal |
| `src` tree | `5bacd257e4a54c0a680dae60b42f997f1ab66de1` | equal (no `src/` commit since `587946e`) |
| `experiments/lib` tree | `6c414274c0bdb3a2f1da2db47cb4c45bff6a5586` | equal |
| `experiments/jit/flow-v2.mjs` sha256 | `5dde4666…5223` | equal |
| `experiments/jit` tree | `3e485b50e0b5f7a7b8abbe03d1585b44a0f478f6` (after `1483cd4`: `test/stream.test.mjs` pins follow the config commit; `dd39a70f…` at `e565cb3`) | **moved**: `0050e1c` (flow-v3 slice 1: five new files, `flow-v3.mjs`, `call-host.mjs`, three tests; nothing existing touched) and `e565cb3` (configs only: `r0-kinetics.json` unblocked with `relTol 0.05`; `r0-records.json` `armSpendStopUsd` for `jit:claude-haiku-5-5/claude-haiku-5-5` 6 → 10 for the rehearsal). No file the R0 stream executes changed |
| R0 arm hashes (`r0-records.json`, after `e565cb3`) | `838a9040ccea77e5` agent, `ca4f763d5d03568e` static, `3b9dc642498f5df8` S/H, `333aabf59174c46d` O/H, `2559d6a68fc7e8a3` H/H | equal to §1 (the per-arm spend cap is not in the arm hash) |
| **R0-K arm hashes** (`r0-kinetics.json`, now unblocked) | `1fde4626b169c84c` `jit:claude-opus-5-5/claude-haiku-5-5`, `2e292709027b2786` `agent:claude-haiku-5-5` | new (the config was `_blocked` at E1). `jit.compare: tolerant`, `relTol 0.05`, `absTol 1e-9`, `tolerantKeys [vmax, km]`; the exclusion set is compared exactly |
| relTol basis | Stage B (`analysis/kinetics-gauge/out/stage-b/STAGE-B.md`, 45 of 48 sessions at stamping; the last 3 were refilling): 13 correct–correct pairs, 0 disagree at 0.05 (2 disagree at ≤ 0.02, both d5, non-convergence, vanish after the shared refit); 13/13 wrong answers differ in the exclusion set; closest same-set Stage A control 0.134 | the Stage A candidate stands; dev calibration (FG §4.1 O1 applies to the PREREG freeze) |
| suites (G2) | main: 1038 tests, 1019 pass, 0 fail, 19 skipped. JIT: 247 tests, 246 pass, 1 flake: `flow-v3-compat` "judges inside map, concurrently" failed 2 of 4 runs under load (Stage B sessions and the owner's GPU jobs running) and passed 2 of 4; flow-v3 is not in the R0 kit (R0 compiles to `flow-v2.mjs`, sha pinned), so the gate is read as green for R0 and the flake is a flow-v3 follow-up (DEV-NOTES D23) | — |
| quota (G5) | 5h 0.32, 7d 0.53 at 21:03 IST | — |
| RAM (G6) | 3 GB available + 14 GB swap free; the owner's three Kev training processes hold ~3.3 GB. Stage B ran two sandboxed sessions under the same load without faults. Proceeding at concurrency 2 is a deviation from the 4 GB line, recorded here | — |

## 6. E1c (cloud paid-run kit, 2026-10-14)

E1c is the kit the cloud paid streams (R0-K first) run on. It is E1 with one `src/` commit, so the kit hash moves. The arm
hashes, the policy hash and the JIT engine tree do not move. It is a detached commit in the worktree
`/var/tmp/foundry-work/kit-e1`, not on any branch. The slice-2 work in `experiments/jit`, `experiments/library`,
`beds/wbed*` and `research/`, which other agents were committing on the branch at the time, is not in it.

**Why.**
- **G4 failed in the cloud container on E1** (cloud-ops readiness, workflow `wf_30a7255d-88f`). Every process there is
  uid 0, so `dropUidArgs` mapped the CLI to uid 0. The CLI's root check then refused the bypass-permissions mode:
  `EXECUTOR_PROTOCOL`, $0, 0.8 s. The evidence is kept in `/var/tmp/foundry-work/g4-smoke/g4-summary.json`. Every
  sandboxed session in the paid arms was blocked: interpreter, shadow, adjudicator and compile builder.
- **The ingress token was exposed.** The cloud-ops verifier found that `DEFAULT_KEEP_RO` kept the whole
  `/home/claude/.claude/remote` directory. That directory also holds `.session_ingress_token`, the parent cloud session's
  own credential. With uid-0 host file access, every session could have read it. The committed mirrors scanned clean at
  the time.
- **The fix is `756d6de`, `src/executors/claude-code.mjs`:**
  - On a root host, the program runs as `UNPRIVILEGED_ID` 65534, mapped onto host uid 0. A non-root host keeps its own uid.
  - Only `CLOUD_LOGIN_FILE` (`/home/claude/.claude/remote/.oauth_token`) is kept, not the directory.
  - `runSandboxed` shares `sandboxScript`. On a root host, compiled solver runs and host checks therefore also run as
    65534.
  - The CLI's safety opt-outs (`IS_SANDBOX`, `CLAUDE_CODE_BUBBLEWRAP`) are not used.

**Construction (reproducible from the branch).**
- The worktree was a detached checkout of `e608a98` (= E1 + `research/`, `beds/` and `experiments/library` only).
  `node_modules` came from `npm ci --ignore-scripts`. In it: `git cherry-pick --no-edit 756d6de` → **`ba0eb22`**.
- `git diff --name-only e608a98 ba0eb22` lists exactly two files: `src/executors/claude-code.mjs` and
  `tests/executor-sandbox.test.mjs`. `git status --porcelain` in the worktree is empty; only the ignored `node_modules`
  is present.
- `ba0eb22` was pushed to branch `kit-e1c-20261014` at 13:27Z on the owner's approval (before that the worktree's HEAD
  alone kept it from garbage collection). R0-K was launched from it at 13:26:39Z through
  `/var/tmp/foundry-work/bin/launch-stream.sh` with the config copy `/var/tmp/foundry-work/configs/r0-kinetics-cloud.json`
  (sha256 `31eae4d1f787ab0e…`): identical to `configs/r0-kinetics.json` except the spend caps, O/H 25 → 32 and
  `spendStopUsd` 30 → 40 (ATTACK-20261014 §4 day 0); both arm hashes unchanged (`1fde4626b169c84c`, `2e292709027b2786`).
- Both inputs, `e608a98` and `756d6de`, are on `origin/claude/intelligent-hamilton-vg1f9a`. No kit or JIT path differs
  between `e608a98` and `756d6de^` (`924453a`).
- Applying `756d6de`'s diff to `e608a98` in a scratch index gives the same root tree `043b3b4f…`. A re-made cherry-pick
  has the same tree; only its commit id differs, by committer date.

| item | E1c value | vs E1 (§1, §5) |
|---|---|---|
| commit | `ba0eb22b9158f0c6566c54dffd3cd546cc40a32c` (detached; parent `e608a98`) | — |
| root tree | `043b3b4f9a7cba49ea848b030c64499c7c795b24` | — |
| **construction-kit hash** | **`852ebdf05588de97`** (3926 files, `kitHash()` in the worktree) | moved from `a572eeee1ac237aa`. The ops agent's draft patch (`kit-e1-proposed.patch`, uid change only) would have given `b757038cbc68406f`; `756d6de` also narrows `keepRo` |
| kit hash without `node_modules` (diagnostic) | `e27f356f8d7fbaae` (98 files) | moved from `36f0df8c91080baf` |
| B1 script kit hash | `6bc6b06eccf45cae` | equal |
| `src` tree | `dc710129c998136cb449e1440a429a640f4bd53b` (= `756d6de:src` on the branch) | moved from `5bacd257…` |
| `policy`, `schemas`, `bin`, `skills`, `web` trees; `package.json`, `package-lock.json` blobs | `80f34241…`, `3f614545…`, `3b481c7b…`, `88183bd4…`, `c6017c18…`; `fc4260a6…`, `5fe7475c…` | equal |
| `tests` tree (not in the kit hash) | `287e4834107909c07091bb8a3f703e77c3b17a34` | moved from `3827e747…` |
| `experiments/jit` tree | `3e485b50e0b5f7a7b8abbe03d1585b44a0f478f6`; `flow-v2.mjs` sha256 `5dde4666…5223` | equal to §5 |
| `experiments/lib` tree | `6c414274c0bdb3a2f1da2db47cb4c45bff6a5586` | equal |
| **policy hash** | **`cfe79728f185334b3f352cd77daa4ad6f732cfb810af9bde91a50369456bc297`** (`policyVersion` `2026-10-09.1`) | equal |
| **R0 arm hashes** (`r0-records.json`) | `838a9040ccea77e5` agent, `ca4f763d5d03568e` static, `3b9dc642498f5df8` S/H, `333aabf59174c46d` O/H, `2559d6a68fc7e8a3` H/H | equal |
| **R0-K arm hashes** (`r0-kinetics.json`) | `1fde4626b169c84c` `jit:claude-opus-5-5/claude-haiku-5-5`, `2e292709027b2786` `agent:claude-haiku-5-5` | equal to §5 |
| Node | `v24.21.0` (`/opt/node24/bin/node`) | equal |
| claude CLI | **`2.1.299`** (`/opt/node22/bin/claude` → `/opt/claude-code/bin/claude`). The container start script re-creates that link; the environment manager runs with `--upgrade-claude-code=False` | laptop `2.1.295` |
| effective sandbox, launch environment | `DEFAULT_KEEP_RO` = `/root/.ccr`, `/home/claude/.claude/remote/.oauth_token`, `/opt/node22/bin/claude`, `/opt/claude-code/bin/claude`, `/root/.local/bin/node`, `/opt/node24/bin/node`. `dropUidArgs()` = `unshare --user --map-user=65534 --map-group=65534`. Session environment names: `HOME LANG PATH TERM TMPDIR` | host-dependent (§2) |

Every hash was computed in the worktree. The script is `kitHash()`, `loadPolicy().hash`, and `parseArm(spec,
normalizeConfig(config), { policyIds }).hash`.

**Gates (2026-10-14, in the worktree, under `env -i PATH="$PATH" HOME=/root TMPDIR=/tmp LANG=C.UTF-8 TERM=dumb`; no
token, no proxy variables).**

| gate | result | evidence |
|---|---|---|
| G1 engine | PASS | The table above. The frozen paths are clean. `experiments/jit` and every arm hash are unchanged; only `src` and the kit hash moved, by `756d6de` alone |
| G2 suites | PASS | **Main** (`--test-concurrency=2 tests/*.test.mjs experiments/lib/*.test.mjs`): 1038 tests, 1020 pass, **0 fail**, 18 skipped (opt-in or missing-binary lanes), 2 m 50 s. `tests/executor-sandbox.test.mjs` is 15/15, including the live probe re-run with the new ingress-token check. The earlier `OLDPWD` / node-link failure is gone. **JIT** (`--test-concurrency=2 experiments/jit/test/*.test.mjs`): see the note below the table |
| G3 seeds | PASS | `stream.mjs --dry` on `r0-kinetics.json` validates the config, `assertSeedsAllowed` included. 24 tasks (`kinetics:dev:d4:s225` … `d5:s248`); both arms 0 done; `/var/tmp/foundry-work/runs/jit-r0-kinetics` does not exist yet |
| G4 live smoke | PASS, **$0.0402** | See the note below the table |
| G5 quota | PASS | One probe at 12:52:04Z ($0.00031). 5h 0.22, 7d 0.06; resets at 16:20Z today and 2026-10-21 11:00Z (`/var/tmp/foundry-work/meter.jsonl`). The 5h window was 0.03 at 12:07Z and 0.18 at 12:45Z, so other agents in this container use about 0.25/h |
| G6 machine | PASS | 4 vCPU, 15 GB RAM, 13–14 GB available, no swap. `/` has 6.0 GB free (at least 3 GB is required). Load average 4–8, all from other agents. Before G4, no `stream.mjs` or `claude -p` was running |

**G2, JIT suite.**
- **Runs.** Run 1: 247 tests, 245 pass, 1 fail, 1 todo. Runs 2 and 3: 246 pass, **0 fail**, 1 todo.
- **The failing test.** `flow-v3-compat` "judges inside map, concurrently", the §5 / D23 flake.
- **Root cause.** The scenario is `unordered: true`, but `norm()` sorts only the trace lines. The stderr assertion
  (`flow-v3-compat.test.mjs:151`) compares the `[model]` lines in completion order. The judges sleep 5–50 ms in 15 ms
  steps, and under load the v2 and v3 subprocesses finish them in different orders.
- **Confirmed.** In isolation the unmodified test passed 3 of 5 runs. With the stderr `[model]` lines sorted, it passed
  6 of 6 (a temporary copy, deleted afterwards).
- **Effect.** The failure is in the test, not in the engine. flow-v3 is not on the R0 or R0-K path (`flow-v2.mjs` is
  sha-pinned). The fix is part of the uncommitted slice-2 work in the main tree, so it is deliberately not in the kit.

**G4, live smoke.**
- **Setup.** One sandboxed Haiku `interpret` on records dev d3 s225 (taskHash `15c64c77…`), cap $0.45.
- **Result.**
  - The sandbox was ready: 168 stream events, including the init event.
  - **9 assistant events**; result `success`; 5 turns, 4 tools; 201 s.
  - **Cost reported, $0.04024**, with **`costUnknown: false`**, no error, and **no `EXECUTOR_PROTOCOL`**.
- **Answer.** The answer is schema-valid. The oracle scores it a fail (score 0), and so does the laptop's R0 Haiku agent
  row 0 on the same task ($0.0438, score 0). The oracle is not a gate criterion.
- **Isolation.**
  - `nestedModelAttempts` 0.
  - `hiddenPathAttempts` 1: the session wrote `…/work/g4-smoke-e1c/script/build.py` beside its workdir. The write landed
    on the private tmpfs; the path does not exist on the host afterwards.
  - No `outsidePaths` entry names `/home/claude` or `/root/.ccr`.
- **Secret scan.** `grep -rlE 'sk-ant-|eyJ[A-Za-z0-9_-]{10,}\.eyJ|oauth_token|session_ingress|\.claude/remote'` over
  `/var/tmp/foundry-work/g4-smoke-e1c`, `/var/tmp/foundry-work/work/g4-smoke-e1c` and
  `/var/tmp/foundry-work/g4-smoke-e1c.log` printed nothing (exit 1).
- **Files.** `/var/tmp/foundry-work/g4-smoke-e1c/g4-summary.json`, and the trace and transcript in
  `/var/tmp/foundry-work/work/g4-smoke-e1c/interp/`.

**Comparability.**
- **Arm hashes are unchanged**: all five R0 and both R0-K arms. The arm hash does not cover the kit (§2), so every
  E1c row must be read as kit `852ebdf05588de97` with CLI `2.1.299`. Rows carry neither value, so record both with
  each run.
- **A non-root host's argv is byte-identical** to E1's:
  - `dropUidArgs(uid, gid)` is unchanged for uid ≠ 0.
  - `maskSteps` emits no step for a kept path that does not exist. The laptop has no `/home/claude/.claude/remote`
    (ISOLATION-PROBE-laptop §3, "CLI login: not visible"), so the narrowed keep changes nothing there.
  - Laptop rows stay comparable, and a laptop run on E1c is a run on E1's argv.
- **Differences of E1c cloud rows from laptop rows:**
  - host (cloud container vs the owner's laptop);
  - CPU count (4 vs 16);
  - CLI version (2.1.299 vs 2.1.295);
  - uid route: the session runs as 65534 mapped onto host uid 0, so it has root file access to whatever the mask leaves
    visible (read-only). The laptop session runs as the laptop's own uid;
  - auth route: the CLI's managed login file vs `CLAUDE_CODE_OAUTH_TOKEN` from the environment;
  - direct egress: `api.anthropic.com` is reached directly from the cloud and verified against the system CA. No proxy
    or CA variables are passed under `env -i`.
- **Mixed lineage if R0 records resumes here.** A cloud resume of the R0 records H/H JIT arm would mix kit `a572eeee`
  (rows 0–11, laptop) with `852ebdf0` (rows 12–23, cloud). R0-K starts fresh on E1c, so it has a single kit.

**Launch notes for R0-K on E1c** (the owner's call; nothing was launched).
- **Where.** Run from the worktree; `--arms` takes the two config arms above.
- **The mirror lands in the worktree.** `persist.commitDir: true` resolves inside the worktree, at
  `/var/tmp/foundry-work/kit-e1/research/jit-20261008/runs/jit-r0-kinetics`. An agent allowed to commit copies it to the
  main tree.
- **Concurrency 2 applies to the agent arm.** The JIT arm runs its tasks in sequence, beside it.
- **The caps are soft.** `armSpendStopUsd` is O/H $25 and agent $5; `spendStopUsd` is $30. Each cap is checked only when
  a task starts.
- **One O/H task can spend up to about $28 at its session caps**, because the Opus fallback compile is still available
  (0 of 2 used):
  - Haiku compile $9 (builder 3 + gateway 1.5 + check 1.5 + recheck 3);
  - Opus fallback compile $14;
  - compiled run $1;
  - Opus shadow and adjudicator $2 each.
- **Worst case for the process:** about $60.
- **The $25 cap will probably stop the arm early.** The dev-kinetics-1 O→H arm cost $20.73 for 19 rows (D25). That
  points to about $26–30 for 24 tasks, so the cap probably stops the O/H arm before 24/24.
- **Raising the caps.** Both caps are outside the arm hash. A config copy kept outside the repo can raise them; record its
  path and sha256 if one is used.

## 7. E3 engine column, in progress (main branch, not a kit)

E3 is the engine column of the enterprise bar ([E-BED §7](../enterprise-20261014/E-BED.md), [BAR-SET §5](../enterprise-20261014/BAR-SET.md)
order: 1 `state`, 2 one durable wait, 3 human-task completion, 4 `compensate`, ...). It changes `src/` on
`claude/intelligent-hamilton-vg1f9a`. Paid runs keep running on frozen kit worktrees (E1c, branch `kit-e1c-20261014`, kit
`852ebdf05588de97`, §6), which no E3 commit touches. E3 is not stamped: any comparative round on it needs its own stamp (§5
checklist), and every E3 step changes the engine identity, so a run created before a step cannot be resumed by the engine after
it (`ENGINE_DRIFT`), as with any engine change. Each step lists the files it changed; §1–§6 (E1, E1c) are unchanged.

### 7.1 Step 1: cross-run state (L0 row 27), 2026-10-14

- **Base.** `src` tree `dc710129c998136cb449e1440a429a640f4bd53b` (E1c's, §6) at `d58f8cd`; engine identity (`src/engine.mjs`
  `engineHash`) `9aade2e2d7ffd7817bfc392cc1ae516ce32f5a915f146551402e0387b9abd4c4`.
- **After step 1 alone** (its hunks applied to a clean worktree of `d58f8cd`): `engineHash`
  `c0d1d4870a9610974beca7cebe49596deb9e3a15f74f1432aebd553fb5e381aa`. Kit hash not computed (not a kit).
- **Shared working tree.** Step 2 (signal waits, `src/signals.mjs`) was being built in the same working tree at the same time and
  touches the same files (`runtime.mjs`, `validate.mjs`, `store.mjs`, `dataflow.mjs`, `engine.mjs`, the schema). The step-1 commit
  holds step-1 hunks only: they were applied to a clean worktree, the suite ran there, and those file contents were committed. Step 2
  records its own files.
- **Design.** [ARCHITECTURE.md, "Cross-run state"](../../docs/ARCHITECTURE.md). Engine-side only: the L0 card, the library checker
  and `skills/` are not changed (the card's row 27 shape, `{"type":"set","maxItems":100000,"ttlDays":30,"writer":"dedupe"}`, now
  validates as written).

| file | change |
|---|---|
| `src/state.mjs` | new: slot declarations and defaults, the operations (`StateStore.apply`: versions, compare-and-swap, bounds, TTL, monotonic cursor, declaration drift), the `state_ops` journal and `stateOpHash` |
| `src/runtime.mjs` | `state` node dispatch; `Invocation.stateNode` (operation, journal row, node outcome and `state.op` event in one run update; replay from the journal); `stateReplaySource`; Runtime option `now`; `replay-or-live` refused for state workflows; `STATE_DRIFT`, `STATE_CORRUPT` never handled |
| `src/validate.mjs` | `state` node fields; slot, operation, writer and argument checks (`STATE_SLOT_UNKNOWN`, `STATE_OP`, `STATE_WRITER`, `STATE_CAS_REQUIRED`, `STATE_VALUE_REQUIRED`, `STATE_KEY`, `STATE_SCHEMA`); the label rule `UNTRUSTED_STATE_WRITE` in the taint pass; `stateNodes`, `stateArgs` |
| `src/dataflow.mjs` | output schemas of the state operations; references in `key`, `value`, `by`, `ifVersion` |
| `src/store.mjs` | creates `state_slots`, `state_entries`, `state_ops`; `store.state` |
| `src/verify-run.mjs` | §2c: state operation bindings (`STATE_OP_MISSING`, `STATE_OP_FOREIGN`, `STATE_OP_EDITED`, `STATE_OP_UNBOUND`, `STATE_REPLAY_UNVERIFIED`), `checks.stateOps` |
| `src/acceptance.mjs` | `onError: "continue"` on a state node is an ungated continuation, as on task and agent nodes |
| `src/verdict.mjs` | `STATE_VERSION_CONFLICT` and `STATE_FULL` are `inconclusive` |
| `src/engine.mjs` | `state.mjs` joins the engine identity |
| `schemas/workflow.schema.json` | top-level `state`, `definitions.stateSlot`, node kind `state` and its fields |
| `tests/state-node.test.mjs` | new (committed early by the autosave `b0717f4`) |
| `tests/verdict.test.mjs` | the pinned inconclusive-code list (committed by the autosave `d58f8cd`) |
| `docs/ARCHITECTURE.md` | section "Cross-run state" |

- **Behaviour of existing workflows.** A workflow without `state` validates and runs as before: the schema only gains optional
  fields and a node kind, the verdict list gains two codes that only state nodes raise, and the continuation rule gains a node kind.
  The suite below is the evidence.
- **Suites (2026-10-14, $0, no model calls).** Main (`node --test --test-concurrency=2 tests/*.test.mjs`, in the clean worktree with
  step 1 alone): 1025 tests, 1007 pass, **0 fail**, 18 skipped (the recorded opt-in and missing-binary lanes). Before step 1 (the clean
  tree at `7915fb1`, this session's start): 1004 tests, 986 pass, 0 fail, 18 skipped. `tests/state-node.test.mjs`: 21 of 21 (15 tests, 6 subtests).

### 7.2 Step 2: one durable wait node (L0 row 19 `wait.signal` with `correlate` and `race`, row 18 `at`), 2026-10-14

- **Base.** Step 1, `d27f532`: engine identity `c0d1d4870a9610974beca7cebe49596deb9e3a15f74f1432aebd553fb5e381aa` (§7.1).
- **How it landed.** The step-2 code was first committed by the unreviewed autosave snapshots `251c5db` and `fdd707d` while it was
  being built (they hold step-2 files only). The step-2 commit that carries this section adds the last runtime changes
  (`WAIT_DEADLINE`, a decided wait keeps a due timer, the `crashAfterWaitDecision` fault hook), the tests, the documentation and this
  record. `git diff d27f532 <that commit>` is step 2 exactly; it holds no step-1 hunk.
- **After step 2:** engine identity `73dc31d6f36f77b0dd3f26388d12c22ec32bdbd7b8094fc7e94db35a589e6b96` (Node `v24.21.0`, ajv 8.20.0;
  `src/engine.mjs` `engineHash`). Kit hash not computed (not a kit). A run created by the step-1 engine is not resumed by this one
  (`ENGINE_DRIFT`).
- **Design.** [ARCHITECTURE.md, "Signal waits and absolute timers"](../../docs/ARCHITECTURE.md). Engine-side only: the L0 card
  (row 19's example `{"kind":"wait","signal":"payment.settled","timeoutMs":86400000,"onTimeout":"escalate"}` now validates when
  `escalate` is a node that needs the wait), the library checker, `skills/` and `web/` are not changed.

| file | change |
|---|---|
| `src/signals.mjs` | new: the one decision rule (`pickSignal`, `claimant`, `cancelledBy`), subscriptions and timeout modes, `parseAt` (epoch ms or ISO 8601 with an explicit offset, every field range-checked), `normalizeSignal`, `declaredSignals`, `signalCheckpointDrift` (record vs chain) and `replayWaits` (every decision re-derived from the chain) |
| `src/runtime.mjs` | `Runtime.deliverSignal` (inbox entry, `signal.delivered`, claim by a parked wait with `wait.resolved` and a due-now timer, in one compare-and-swap update; idempotent by id) and `correlateSignal` (no run id: the one run whose parked wait correlates on the key); `Invocation.waitIntent` (wake time, `at`, correlation keys fixed at start; `WAIT_DEADLINE`), `wait`, `decideWait` (buffered pick, timeout or park), `finishWait` (completes from the chain's decision and delivery; `WAIT_TIMEOUT`), `routedAway` (onTimeout branch), `waitLabel`; the routed wait's label is control for its dependents; resume refuses a record whose inbox or decisions differ from the chain (`CHECKPOINT_TAMPERED`); fault hook `crashAfterWaitDecision` |
| `src/validate.mjs` | wait fields; `checkWait` (`WAIT_SHAPE`, `WAIT_UNBOUNDED`, `WAIT_AT`), `checkWaitRoute` (`WAIT_ROUTE`), `SIGNAL_SCHEMA_CONFLICT`; payload schemas kept out of reference checks; wait labels and onTimeout routing in the taint pass |
| `src/dataflow.mjs` | output schemas of delay, `at` and signal waits (one alternative per raced signal, a timeout alternative unless it fails); references in `at` and `correlate` |
| `src/store.mjs` | table `signals` (workspace-unique signal ids), `signalRecord`, `recordSignal`, `openSignalWaits`, `findEvent` |
| `src/verify-run.mjs` | §6c: `WAIT_REPLAY_MISMATCH` (re-derived decision differs; error on the recording engine, warning on another), `SIGNAL_EDITED`, `checks.waits` |
| `src/verdict.mjs` | `WAIT_TIMEOUT` is `inconclusive` |
| `src/engine.mjs` | `signals.mjs` joins the engine identity |
| `src/foundry.mjs` | `Foundry.signal`, `Foundry.correlateSignal` |
| `src/http.mjs` | `POST /api/runs/:id/signals`, `POST /api/signals` (local UI token, as for answers); a wait the signal resolved is resumed at once; `SIGNAL_CONFLICT`, `SIGNAL_AMBIGUOUS`, `SIGNAL_UNMATCHED` are 409 |
| `bin/foundry.mjs` | `foundry signal [RUN_ID] --name --id [--key] [--payload]` |
| `schemas/workflow.schema.json` | wait fields `at`, `signal`, `correlate`, `schema`, `race`, `onTimeout`, `label`; `definitions.signalName`, `signalSubscription`; `timeoutMs` up to 30 days on a wait only (other kinds keep 1 hour) |
| `tests/wait-signal.test.mjs` | new |
| `tests/verdict.test.mjs` | the pinned inconclusive-code list gains `WAIT_TIMEOUT` |
| `docs/ARCHITECTURE.md` | section "Signal waits and absolute timers" |

- **Behaviour of existing workflows.** A `delayMs` wait runs as before (same output, events and timer; `delayMs` keeps its 1-hour
  bound). The schema gains optional wait fields; `timeoutMs` above 1 hour is accepted on a wait only. The verdict list gains a code
  only a signal wait raises.
- **Suites (2026-10-14, $0, no model calls).** Main (`node --test --test-concurrency=2 tests/*.test.mjs`, this tree with steps 1 and
  2): 1041 tests, 1023 pass, **0 fail**, 18 skipped (the recorded lanes of §7.1). `tests/wait-signal.test.mjs`: 16 of 16 (validation,
  taint, correlation hits and misses with per-item keys in a map, correlation without a run id, races signal vs signal and signal vs
  timer, timeout routing, `onTimeout` fail, absolute timers and `WAIT_DEADLINE`, restart: CLI delivery and tick in new processes, a
  SIGKILL between decision and completion, a dead owner; duplicates and refused deliveries, late signals, replay and tamper checks,
  HTTP). Step 1 alone was 1025 / 1007 (§7.1); the 16 added tests are that file's. `tests/timers.test.mjs` and `tests/cancel.test.mjs`
  pass unchanged.
- **Open.** No re-execution of a recorded run's signals into a new run (the clock is not journaled; replay is the re-derivation),
  no workspace-level buffer for signals that no run waits for yet, G3 reminders and G15/G16 calendar clocks not built, signal-wait
  routing in the L0 card and the library checker not updated (the card is at its token budget).

### G21 tier 0: human-task forms in `tools/ui` (no engine change), 2026-10-14

- **`src/` files changed: none.** No kit allow-list path changed (`package.json`, `bin`, `src`, `schemas`, `policy`, `skills`,
  `web`, `node_modules`). The engine identity is that of the step it runs on; this work adds nothing to it. The sidecar sits in
  `tools/` because `web/` is in the kit hash (OPENUI.md §5.2, E-BED §7).
- **New files.** `tools/ui/` (compile, pattern bound, validator, `formState` adapter, renderer, loopback host, fixtures and runner,
  generators, `measure.mjs`, README) and `tests/ui-form.test.mjs`, `tests/ui-form-adapter.test.mjs`, `tests/ui-form-browser.test.mjs`.
- **How it landed.** The files were committed while being built by the unreviewed autosave snapshots `bed1108` … `16efeaa` (which
  also hold other agents' files). The commit carrying this section adds this record and the README map line;
  `git diff c76ec66 <that commit> -- tools/ui tests/ui-form*.test.mjs` (`c76ec66` is the parent of `bed1108`) is the G21 work exactly, and the tree it names is the one the
  suites below ran on.
- **Coupling to the engine (read-only imports).** `tools/ui/common.mjs` uses `src/data.mjs` (`checkData`, `digest`). The tests and
  `measure.mjs` call `src/validate.mjs` `validateData` as the differential oracle. The runtime test drives `src/runtime.mjs` and
  `src/store.mjs` (`awaiting_human` → form → host → `Runtime.answer`). A later engine step that changes answer validation shows up
  as a differential failure there, not as a silent drift.
- **Suites (2026-10-14, $0, no model calls).** Main (`node --test --test-concurrency=2 tests/*.test.mjs`, this tree with steps 1
  and 2): 1129 tests, 1111 pass, **0 fail**, 18 skipped (the recorded lanes). The 88 added tests are 75 + 10 + 3 in the three
  files above; the browser file ran (Playwright 1.63.0, `/opt/pw-browsers/chromium`) and skips with a reason where either is
  missing. Details and capability numbers: [tools/ui/README.md](../../tools/ui/README.md).
