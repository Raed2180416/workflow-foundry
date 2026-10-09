# ENGINE-FREEZE: engine freeze record for R0, R0-K and the held-out run (S0-4)

> **Draft E1 candidate. Re-stamp after the step-0 code lands.**
> - `experiments/` changes do not alter the kit hash.
> - Any change to `src/`, `policy/`, `schemas/`, `bin/` or `skills/` does. So do `web/`, `package.json` and
>   `node_modules`, which are also in the kit allow-list.

*Stamped 2026-10-09 on the owner's laptop. The source is the committed tree at HEAD. Rule: ROADMAP §6 rule 13, "no
comparative run starts on an engine that is still changing", and §4.3. Requested by
[BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md) §2.0, S0-4, which also needed owner question Q6 (heal kit policyDrift). Q6
was decided on 2026-10-09 (see §4).*

## 1. Values

| item | value | how it was computed |
|---|---|---|
| HEAD commit | `7b8fc47cadc17f72bd487b812af2b0e1836a28f4` | `git rev-parse HEAD` |
| last commit touching `src policy schemas bin skills web package*.json` | `38f74fd` (2026-10-09 15:28 +0530, "Jev (TypeSafe System One) in the model policy …"). The commit before it in those paths is `2f9862a` (the sandbox fix) | `git log -1 -- <paths>` |
| tree ids at HEAD | `src` `fab0291d460370b39c8286954b278b97cb690429`<br>`policy` `80f34241ba967bba9fabd0cd667ab6a968fbf5c0`<br>`schemas` `3f614545f4c8d70a51aa7e19c3c1c6eda744297a`<br>`bin` `3b481c7bf14e58ab097c6ed443a360a71bc19ac3`<br>`skills` `88183bd45a9fea4fdc9df999fd5d001565c8c84b`<br>`web` `c6017c1890be4cfc3bd192ea264cca7395266a5c`<br>`package-lock.json` blob `5fe7475cc474126b7c0f2795fd2b114684fd0381` | `git rev-parse HEAD:<path>` |
| **construction-kit hash (F kit)** | **`94c3360e18e2d0d3`**: 3926 files, including `node_modules` from `npm ci --ignore-scripts` on the lockfile | `experiments/lib/kit.mjs` `kitHash()`: sha256 over (path, bytes) of `KIT_ALLOW` = `package.json bin src schemas policy skills web node_modules`, first 16 hex. This is the value C0 records as `kitHash` (`experiments/c0/construct.mjs:138`, `run-dev.mjs:43`) |
| kit hash without `node_modules` (diagnostic only) | `3c74c348856caf8f` (98 files) | `kitHash({ allow: [...KIT_ALLOW minus node_modules] })` |
| B1 script kit hash | `6bc6b06eccf45cae` | `kitHash({ allow: SCRIPT_KIT_ALLOW })` (`skills/script-harness`) |
| **policy hash** of `policy/models.json` | **`cfe79728f185334b3f352cd77daa4ad6f732cfb810af9bde91a50369456bc297`** (`policyVersion` `2026-10-09.1`) | `src/models/policy.mjs` `loadPolicy(file).hash` (`policyHash` of the validated policy) |
| Node | `v24.21.0` | `/opt/node24/bin/node --version`. Installed by the pinned, sha256-verified `scripts/setup-node24.sh` |
| **sandbox flags**: executor (`runClaudeCode`) | `unshare --user --map-root-user --mount --pid --fork --kill-child --mount-proc`, then `sh -c sandboxScript(maskSteps(...))` | `UNSHARE_ARGS` (`src/executors/claude-code.mjs:66`) |
| executor mask on this host | `DEFAULT_HIDDEN` plus `os.homedir()` = `/home/raed`. `DEFAULT_KEEP_RO` adds `~/.local/bin` and `~/.local/share/claude`. Env is `scrubEnv()` plus `TMPDIR=/tmp` | `2f9862a`; measured in [ISOLATION-PROBE-laptop.md](ISOLATION-PROBE-laptop.md) |
| sandbox flags: `runSandboxed` | as executor; `network: false` adds `--net`. Env is `PATH`, `LANG`, `HOME` | `src/executors/sandboxed-command.mjs` |
| sandbox flags: code nodes (`runCode`) | `unshare --user --map-root-user --net --mount --pid --fork --kill-child --mount-proc`, an allow-list root, an unmapped inner user, and prlimits | `src/sandbox.mjs` |
| **dev-config arm hashes** | recomputed now; equal to the pins in `experiments/jit/test/stream.test.mjs:398–404` (`V1_HASHES`, taken at `59938e5`) | `parseArm(spec, normalizeConfig(config)).hash` |
| JIT engine tree at HEAD (not in the kit hash) | `experiments/jit` `35947ead6ab39411c3b7fd1b588d651c2d6182b2`<br>`experiments/lib` `6c414274c0bdb3a2f1da2db47cb4c45bff6a5586` | `git rev-parse HEAD:<path>` |
| **heal replays: frozen kit** | commit `880c6b9` (`880c6b91f183a569571480d7ff5d297839a8cdac`); kit hash `7e8f0f83153c5efb`; 87 pinned files | `experiments/heal/kit.mjs` `KIT_COMMIT`, `experiments/heal/pins.json` |
| heal policy of record (880c6b9) | `fe63f99b9fcdd5bbe53703ee0c1b2d079972bdecfe1ea940a959385190dee2e4` (`policyVersion` `2026-10-07.1`) | `loadPolicy(<frozen>/policy/models.json).hash` |
| frozen-src copy (git archive 880c6b9) | `.foundry/kev-data/frozen-src/880c6b9…/`; manifest hash `sha256:4ba206dfdee4eb850b8d7fba3a232b7dc4ad72a9b16a0583087846a8a8a1f621` | `experiments/kev-data/exec/frozen-src.mjs` `freezeSrc()`; regenerates from git and is verified blob by blob |

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
  - The kit hash is therefore unchanged by the step-0 work in `experiments/`, but the JIT engine is not. The tree ids above
    are the JIT half of the freeze.
  - When this was stamped, the working tree had uncommitted edits by another lane to
    `experiments/jit/{acceptance,flow-v2,run-compiled}.mjs` and a new `experiments/jit/seeds.mjs` (S0-2, S0-5, S0-6). The
    committed tree ids above exclude them, so this record is **not** the R0 engine yet.
- **`node_modules` is in the kit hash.** It comes from `npm ci --ignore-scripts` against `package-lock.json`. A
  re-install with the same lockfile gives the same bytes. A different npm or registry tarball could change it, so re-stamp
  after any reinstall.
- **The policy hash changed at `38f74fd`.** Jev was added (`judgmentModels`, `providers.typesafe-systemone`) and so were
  the 2026-10-08 `childEnv` and notes. The policy of record for the C0, P1 and heal evidence is `fe63f99b…` at `880c6b9`.
  New comparative runs use `cfe79728…`.

## 3. Recorded issue, not fixed now

- **Wrong test name in `policy/models.json` notes.** The notes name `tests/model-policy.test.mjs`. The file is
  `tests/models-policy.test.mjs`.
- Fixing the typo changes the bytes and therefore the policy hash (`cfe79728…`) before the freeze. It is recorded here and
  left as it is.
- If it is fixed, do it in the same commit as any other `policy/` change before the final stamp, and re-stamp.

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

## 5. Re-stamp checklist (E1)

After S0-1, S0-2, S0-5, S0-6 and S0-7 land, and before R0:
1. Commit, then record `git rev-parse HEAD` and the tree ids.
2. Run `kitHash()` and `loadPolicy('policy/models.json').hash`.
3. Recompute the arm hashes of the R0, R0-K and held-out configs.
4. Run `node --version`.
5. Re-run the isolation probe, or confirm that `src/executors/` did not change.
6. Write the values into the PREREG.

Any later change to `src/`, `policy/`, `schemas/`, `bin/`, `skills/`, `web/`, `package*.json`, `node_modules` or
`experiments/jit/` before the held-out run voids the stamp.
