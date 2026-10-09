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
