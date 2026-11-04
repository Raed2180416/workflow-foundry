# PREREG-VL1: the verifier-lab live arm on look 2 (AutomationBench)

**Status: FROZEN 2026-10-22 (03:06Z).** Decision D27 (`research/decisions-20261021.md`); specification
`research/automationbench-20261014/VERIFIER-LAB.md` §4 (arms, task set) and §5 (implementation steps). Written before
any look-2 grade, result record or run log was read by the verifier lab or by the author; the only look-2 facts used
are the task names, `launch.json` files, and the line `a0o-look2-1 exit 0 (CLI 2.1.307) 2026-10-22T02:38:36Z` in
`/var/tmp/foundry-work/launches.log`. The code, prompts and rules below are frozen by sha256 (§11); the orchestrator's
commit of this file and of `experiments/autobench/verifier/live/` is the freeze commit.

**Disclosure (03:06Z).** After this text and every rule in it were written, and before the freeze commit, the author
saw the subject line of commit `b5c2e9b4` in `git log`: "Opus 5.5 xhigh on the 60 look-2 tasks: 26/60 (43.3%),
$0.385 per task, 0 faults". That is the reference arm's aggregate; no per-task grade was seen.
- Nothing was changed in response. The Opus rule in §9 and the Opus prior in §8 are VERIFIER-LAB.md's text, fixed
  before that run.
- At $0.385 per task, the rule's cost condition (≤ 20% of Opus's cost per task, ≤ $0.077) is out of reach for VL-1's
  expected ~$0.15 per task. The rule stays as written.

## 0. Evidence label

- **Development, exploratory: look 2 of SEQUENTIAL-PLAN-v1** (plan `3cd586bd…`, PREREG-AB-v1-AMEND-1, D23, D25).
- **First look for every fork and for the selector.**
  - The forks (A1-C v1-M, Sonnet 5.5 + A1, A0 Haiku, A1-C v2-M) and the verifiers (RL2, the Haiku judge) were built or
    tuned on look 1 (dev60) only.
  - The verifier lab read the look-2 list by name only.
- **Not the plan's confirmatory test.** That test is A1-C v2 against A0 (D25). VL-1 is a reported exploratory arm, like
  the Opus 5.5 xhigh reference `a0o-look2-1` (D26).
- **Protocol label A1F** (PREREG-AB-v1 §12): several attempts in copies of the world, choosing among them. It mixes
  three models (H4: Haiku 5.5 acting, Mercury 3 ledger and checker, Sonnet 5.5 acting; Haiku 5.5 verifies).
  - Every VL arm is reported in its own table. None is pooled with A1, and none is a headline.
  - A real deployment cannot fork the world, because a sent message cannot be unsent.
- **Any claim needs a sealed rerun** (testRef after A0 and A1, or a fresh pool). Look 3 (23 tasks) is too small.
- **Exposure disclosures:**
  - D25 says the need-router study used the request text of 5 look-2 tasks. No VL fork uses the need router.
  - The A1 harness knowledge comes from the dev-side raw-Haiku subset60 (forced exposure set S1), which is disjoint
    from look 2.
  - RL2 and the Haiku judge were designed on dev60 folds 0–2 (the judge prompt on 2 pilot tasks of fold 0).

## 1. Task list

- `research/automationbench-20261014/LOOK2-TASKS.json` was brought into this tree from branch
  `worktree-wf_630f3979-599-4` (commit `2df949cb`) with `git show`. It is the same file the a1c-v1 pin worktree
  (`b1e16e03`) and the A1-C v2 chain verify.
  - 60 tasks, 10 per domain.
  - File sha256: `85099131ad42ff27dd547c087797552fc424906093b5feb560ea5b81ebd2f567`.
  - List sha256 (sha256 of `JSON.stringify` of the sorted names):
    `a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f`, checked on 2026-10-22.
- **Analysis set:** all 60 tasks.
  - A task with no recorded outcome for a fork counts as a fail for that fork.
  - A task with no candidate world in a pool gets no pick and counts as a fail for the pool.
  - No task is excluded after the fact.

## 2. Forks, run ids and provenance

All runs live under `/var/tmp/foundry-work/autobench/<run-id>/`. Every arm runs CLI **2.1.307 (Claude Code)**. The
chain and the VL-1 launcher refuse any other version, and the Opus run's launches.log line records 2.1.307.

| Role in VL | Arm | Run id | Launched by | Model(s) | Harness | Checkout, runner, bridge |
|---|---|---|---|---|---|---|
| default fork (`v1m`) | A1-C v1-M | `a1c-v1m-look2` | A1-C v2 chain (`look2-chain.sh`, after its preregistration) | Haiku 5.5 acting; Mercury 3 ledger + checker | codeowned, `--harness-hash $V1MHASH` (the chain's freeze) | pin `b1e16e03`; runner `ea1dca70…`; bridge `285be4f5…` |
| challenger (`sonnet-a1`) | Sonnet + A1 | `a1s-look2` | **this preregistration (§3)** | Sonnet 5.5 | foundry a1-v1, manifest `93cbeb4b…` | pin `b1e16e03`; `ea1dca70…`; `285be4f5…` |
| cheap fork (`haiku-a0`) | A0 Haiku (plan control) | `a0-look2` | A1-C v2 chain | Haiku 5.5 | none | pin; `ea1dca70…`; `285be4f5…` |
| exploratory default (`v2m`) | A1-C v2-M | `a1c-v2m-look2` | A1-C v2 chain | Haiku 5.5; Mercury 3 | codeowned-v2, `$V2MHASH` | v2 branch `wf_3674d3bc-0a7-12` at `$V2COMMIT`; bridge `285be4f5…` |
| reference | Opus 5.5 xhigh, A0 | `a0o-look2-1` | orchestrator (D26) | Opus 5.5, effort xhigh, `--budget 3 --cap 60 --concurrency 3 --date-note` | none | main tree; runner `ea1dca70…`; bridge `caf3ddd6…`* |
| comparator | A0 Haiku | `a0-look2` | (as above) | | | |

\* The main tree's `bridge.py` differs from the pin's only by `pin_timezone`, which sets the serve time zone for input
rows that carry `info.tz`. No official task carries it, so official tasks are served identically. The Opus run finished
on 2026-10-22 at 02:38:36Z with exit 0. Its per-task grades have not been read; see the §0 disclosure for its
aggregate.

VL-1 never launches or modifies the chain's arms. If the chain has not produced `a1c-v1m-look2` or `a0-look2` when
`a1s-look2` ends, VL-1 waits; the spend is not duplicated. VL-v2 runs only if `a1c-v2m-look2` finishes. A fork counts
only once its `summary.json` exists. Environment faults are resumed, never scored: the runner keeps them out of
`results.jsonl`.

## 3. The new fork: `a1s-look2` (the only new acting spend)

**Launch**, after this file is committed, detached from a script file:
`setsid nohup bash experiments/autobench/verifier/live/launch-a1s-look2.sh > /var/tmp/foundry-work/a1s-look2.chain.log 2>&1 &`

**The command it runs**, from the a1c-v1 pin worktree, at `nice`:

```
cd /home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin
HELD=<the 60 names of research/automationbench-20261014/LOOK2-TASKS.json, comma-joined>
nice node experiments/autobench/run.mjs --harness foundry --model claude-sonnet-5-5 --budget 1.5 --cap 10 --date-note \
  --concurrency 2 --timeout-min 20 --max-steps 50 --det record --k 1 --no-copy --tasks "$HELD" --run-id a1s-look2 [--resume]
```

**Environment:** `DISABLE_AUTOUPDATER=1`. `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`,
`DISABLE_TELEMETRY` and `DISABLE_ERROR_REPORTING` are unset, as for `a1s-dev60-dn-fill` and the A1-C v2 chain.

**Same flags as the dev60 sonnet-a1 arm.** `a1s-dev60-dn` ran with `--model claude-sonnet-5-5 --harness foundry
--budget 1.5 --date-note`, with defaults max-steps 50, timeout 20, det record and k 1. Added here:
- `--tasks <look-2 list>`;
- `--cap 10`;
- `--concurrency 2` (dev60 used the default, 4), to leave room for the Opus run;
- `--no-copy`.

**A1 harness at its frozen hash.**
- Manifest sha256 `93cbeb4b7d3164821c6a9db5b4ae865503e5dfd66187b873122c97cb4ef70a86`. It is recomputed in the launch
  environment before every start and resume, and checked again in `launch.json` afterwards.
- The harness text the sessions receive is unchanged from dev60:
  - `harness/foundry.mjs` differs from commit `4049b06b` (the dev60 A1 runs) only by the line
    `executor: o.executor ?? <same default>`;
  - the harness section sha256 is `b5434aeab1592ab3ac7fb8b36dbc2231acd9c04a086bddda649afb8de560ea12`;
  - the KNOWLEDGE block is identical.
- The manifest differs from `a1s-dev60-dn`'s (`a9fddf95…`, CLI 2.1.300) and from `a1s-dev60-dn-fill`'s
  (`17cc3963…`, CLI 2.1.306) in:
  - the CLI version (2.1.307);
  - `concurrency` (2);
  - the runner file (`ea1dca70…` against `e035f589…`);
  - the imported-file hashes of `harness/foundry.mjs` (the line above), `src/executors/claude-code.mjs` and
    `src/models/policy.mjs`;
  - the openai-chat executor files the newer runner imports. Sonnet never uses them.
- The bridge is the same as dev60 (`285be4f5…`), and so is the corpus pin (`4a8e1061…`).
- `--harness-hash` is **not** passed, because in `run.mjs` it would lift the dev-only split guard. The guard stays on,
  and the launcher checks the hash itself.

**Launcher checks** before every start and resume:
- pin HEAD `b1e16e030470c077b8c09bc3fdf06a32c2a26209`, with a clean tracked tree;
- runner sha `ea1dca70…` and bridge sha `285be4f5…`;
- the look-2 file and list hashes;
- the CLI version;
- the A1 manifest hash;
- at least 1.2 GB of free disk.

**Faults and caps:**
- Exit 3 (environment fault): wait 30 min, `--resume`, at most 6 times.
- Exit 4 (cap): stop. A higher cap needs a decision.
- Every exit is appended to `launches.log` with its CLI version.

**Exposure.** The A1-C v2 chain's `heldout-look2.mjs` exempts `a1s-look2` as a D27 reference run when its `launch.json`
shows `claude-sonnet-5-5` and only look-2 tasks. The launcher guarantees both.

**Blindness.** The run log (`/var/tmp/foundry-work/a1s-look2.log`), `results.jsonl` and `summary.json` print per-task
grades. Nobody reads them before step 5. Step 2 reads `results.jsonl` only through the allowlist in §5.

## 4. Arms (VERIFIER-LAB.md §4.2, verbatim)

| Arm | Forks | Selector | New spend | Role |
|---|---|---|---|---|
| **VL-1** | v1-M (`a1c-v1m-look2`, default) + sonnet-a1 (`a1s-look2`, new) | R3 | Sonnet fork ~$7 (cap $10) + verifier ~$1 | **primary** |
| VL-1/R1, VL-1/R2 | same | R1, R2 | $0 | secondary |
| VL-1h | v1-M + A0 Haiku (`a0-look2`) | R2 | judge ~$0.3 | secondary (cheap pair; post-hoc on dev60) |
| VL-3 | v1-M + sonnet-a1 + A0 Haiku | R3 | $0 | exploratory |
| VL-v2 | v2-M (`a1c-v2m-look2`) + sonnet-a1 | R3 | $0 | exploratory (v2 is unknown) |
| VL-1R | VL-1's pick + one repair round where an HP hard check fails | – | ≤ $1 | secondary, with a regrade control |

**Protocol labels.**
- Every VL arm is **A1F** (PREREG §12: several attempts in copies of the world, choosing among them) and runs three
  models (H4).
- Each is reported in its own table, never pooled with A1 and never a headline.
- **In a real deployment the world cannot be forked**, because a sent email cannot be unsent. VL-1 measures how much a
  prompt-and-world verifier can buy. The deployable form is plan-level forking with a commit gate (§6).

**Mapping to `select.mjs` cells**: lab arms `v1m`, `sonnet-a1`, `haiku-a0`, `v2m`. The arm order is the lab's
ARM_ORDER.

| Arm | Cell |
|---|---|
| **VL-1** | **`P2/R3`** |
| VL-1/R1 | `P2/R1` |
| VL-1/R2 | `P2/R2` |
| v1-M alone | `P2/R0` |
| VL-1h | `P2h/R2` (`P2h = v1m, haiku-a0`) |
| VL-3 | `P3/R3` (`P3 = v1m, sonnet-a1, haiku-a0`) |
| VL-v2 | `P2v2/R3` (`P2v2 = v2m, sonnet-a1`) |
| VL-1R | `repair.json` on the `P2/R3` picks |

The other cells of the R0–R3 × pool grid are computed and reported as descriptive only.

## 5. Pipeline (VERIFIER-LAB.md §5; exact commands in `experiments/autobench/verifier/live/run-look2.sh`)

Each subcommand first checks `vl1/VL1-FROZEN-SHA256SUMS` and the RL2 freeze. Only RL2's `run.mjs` may differ from its
freeze, by the `--fallback-reader` option, which VL-1 does not use. It also checks the list hash and the 1.2 GB disk
floor.

1. **`lab`: step 2, $0.** `build-live.py` builds the lab from the forks' run directories into
   `/var/tmp/foundry-work/vl1-look2/lab`. The `--arm` order is `v1m, sonnet-a1, haiku-a0[, v2m]`.
   - It never opens a grade file.
   - It reads `results.jsonl` only through an allowlist: `costUsd, steps, sessionError, harnessError, skipped,
     tokens`.
   - Every row carries `label: null`.
   - It refuses a task outside devTrain or in devCheck/test, a run id that names devcheck or test, and a listed task
     outside devTrain. It skips unlisted tasks unread.
   - It writes `dataset.jsonl`, the gzipped worlds, `manifest.json`, and `load.mjs` (from `lab-load.mjs`). The loader
     throws on any labelled row.
2. **`verify`: step 3, PAID.** The frozen RL2 and the frozen Haiku judge run with replay-or-live journals:
   - `requirement-ledger-v2/run.mjs --phase extract --readers haiku:0,haiku:1,haiku:2 --usd-cap 1.5`;
   - `--phase check --readers haiku:0,haiku:1,haiku:2 --tag look2`, at $0;
   - `--phase judge --tag look2 --judge-tag look2 --judge-only-accepted --usd-cap 2`;
   - `diverse-judges/run.mjs --judge haiku --arms <lab arms> --usd-cap 0.75`.
   - The RL2 caps are cumulative over its journal.
3. **`select`: step 4, $0.** `select.mjs` writes `research/automationbench-20261014/vl1/selection.json` for pools `P2`,
   `P2h`, `P3` (and `P2v2`) under rules R0–R3.
   - It refuses any labelled row.
   - Every read goes through a guard that refuses any path under a `host/` directory.
   - It records `{pool, rule, picks: {task: run}, rows}`, the per-row verifier signals and the sha256 of every input.
   - **`selection.json` is committed before step 5. That commit is the blind boundary.**
4. **`repair`: step 6, PAID ≤ $1, optional.** It runs after the selection commit and before step 5. See §6.4.
5. **`score`: step 5.** It runs after the selection commit **and** after the A1-C v2 chain has graded every arm (its
   `analysis.json` exists) and `a0o-look2-1` has finished.
   - It runs `score.mjs --default v1m --ref a0o-look2-1 --compare A0=a0-look2 --primary P2/R3` and writes
     `vl1/RESULT.json`.
   - `score.mjs` refuses a selection that is not committed or that differs from HEAD.
   - Then `vl1/RESULT.md` is written.

## 6. Selector, verifiers and rules (frozen)

### 6.1 Signals per candidate

A candidate is one canonical outcome row: one fork's final world on one task.

- **`a` (RL2 accept).** `combine()` from `requirement-ledger-v2/verify.mjs` (`rl2-verify-v1`, SOFT_W 0.3, UNCLEAR_W
  0.5), with the RL2 judged verdicts and support weighting by the reader count, as frozen. `a` is 1 when no hard check
  (code or judged) fails and the world changed.
  - The checks come from RL2 `rl2-extract-v3 + rl2-compile-v1 + rl2-check-v1`.
  - There are three Haiku 5.5 readers at reasoning low, with a 2-of-3 merge for hard checks.
  - The extraction reads the request and the canonical initial world: the first lab arm whose initial world is not
    rebuilt, so `v1m`'s prep.
  - The judged checks use `rl2-judge-v1`, one Haiku call per accepted candidate, reasoning none.
- **`s` (RL2 score).** 1 − (weighted failures / total weight).
- **`p` (Haiku judge).** `p_done` from `diverse-judges` `dj-v3`, world variant. It sees the request, the connected apps'
  records before the run (20,000-character cap) and the candidate's changes. One Haiku 5.5 call per candidate,
  reasoning none.
- **Missing values:**
  - no RL2 checks for a row: `a = 0` and `s = 0`;
  - no judge verdict: `p = 0.5`.
  - These are the lab's conventions.
- **What the verifiers never see:** labels, task names, arms, runs, paths, the pipelines' own checks or the forks'
  write logs. A leak guard in each runner refuses any prompt that holds a task name, run, row id, `/var/tmp/foundry-work`
  or `vlab`.

### 6.2 Rules (pre-declared in the lab's `judge-eval.mjs` header before its first run; unchanged)

| Rule | Picks the candidate with the highest… |
|---|---|
| R0 | the pool's default fork (its first arm) alone |
| R1 | `[a, s]` (RL2 alone) |
| R2 | `[p]` (the Haiku judge alone) |
| **R3** | **`[a, p, s]`: the RL2 accept gate, then the judge ranks, then the RL2 score (VL-1)** |

- **Ties.** A tie means |difference| ≤ 1e-12 at every key. Ties go to fork order: the pool's arms as listed, default
  first. For P2, P2h and P3 this equals the lab's ARM_ORDER. For P2v2 it puts `v2m` first.
- **Missing candidates.**
  - A task missing the default's row is decided among the candidates present.
  - A task with no candidate gets no pick and counts as a fail.

### 6.3 Selection is deterministic

The same lab and verifier outputs always give the same `selection.json` picks (test 3).

### 6.4 VL-1R (`repair.mjs`, `vl1-repair-v1`)

**Which tasks are treated.** Every P2/R3 pick whose RL2 checks hold at least one **failing hard** check of type
`msg_to`, `msg_has`, `created_has`, `created_in` or `effect_any`.

**Per treated task:**
- **Control.** A bridge serve, from the pin checkout, starting from the pick's exported final world (the lab's copy)
  and the task's prep `input.json`. There is no session and no model call; it grades at stop.
- **Treatment.** The same serve, then one `claude-haiku-5-5` session:
  - system prompt: the official system prompt, then `adapterText(catalog, maxSteps, {dateNote: true})`, then the brief
    (sha256 `5b156ce4…`). The brief lists each failing requirement's ledger statement and the check's evidence, and
    says to read the current state first, not repeat any existing effect, change only what the listed requirements
    need, and leave a requirement the records show is wrong;
  - user message: the official one.
- **Caps:**
  - world steps: `min(10, 49 − steps the pick used)`, enforced by the bridge;
  - model responses: `50 − responses the pick used`, enforced by the CLI step guard;
  - `--budget 0.1` per session and $1 for the round.
- **Audit.** The session is audited by `auditSession` against the response allowance (H3) and for L5. A violation
  scores the treatment as a fail.
- **Blindness.** `repair.mjs` never opens a grade. `score.mjs` reads the control and treatment grades.
- **Scoring.** VL-1R takes the treatment grade on treated tasks and the live grade elsewhere. It is reported against the
  control on the treated tasks, with the control's drift from the live grade counted.

## 7. Analysis (fixed)

**Primary comparison: VL-1 (P2/R3) against v1-M alone** (`a1c-v1m-look2`'s headline), paired over the 60 tasks.
- Strict pass per task is each fork's headline `final.task_completed_correctly` in its `results.jsonl`, so the runner's
  H3/L5 overrides apply. VL-1's pass on a task is the headline of the fork it picked.
- Statistics:
  - the **exact two-sided McNemar** test on the discordant pairs (binomial(b + c, ½), exact integer arithmetic), at
    α 0.05, reported as an exploratory p-value;
  - the pass difference with gains and losses;
  - a **10,000-sample paired task bootstrap**: xorshift32, seed 20261022, tasks in sorted order, 95% interval of the
    summed difference.

**Reported comparisons**, with the same statistics, never confirmatory:
- VL-1 against **Opus 5.5 xhigh `a0o-look2-1`**;
- VL-1 against **A0 Haiku `a0-look2`**;
- the secondary and exploratory cells of §4 against v1-M and against Opus;
- VL-1R against VL-1 and against its control.

**Costs:**
- **Acting.** Every fork of a pool runs, so a pool's acting cost per task is the sum of its forks' `costUsd`.
- **Verifier.** Every RL2 extraction call of the readers used, plus the RL2 judge and Haiku-judge calls attributed by
  the pool's share of candidates, all from the verifier output files' per-call `costUsd`. The journals'
  `journalSpend` totals are reported beside them.
- **Mercury.** v1-M's Mercury tokens are reported apart.
- **Per success.** Total cost divided by passes, including Opus's cost per pass.

**Diagnostics:**
- per-domain pass rates;
- switches from the default;
- the pool's oracle (any fork passes);
- **HP-check precision on picks**: of the picks with a failing hard HP check, the share that fail;
- for analysis only, failure counts by ceiling class, if a look-2 ceiling audit is made later. It never feeds a
  verifier.

## 8. Expected results (VERIFIER-LAB.md §4.3, verbatim)

| Arm on look 2 | Strict pass, point (range) | $ / task | Basis |
|---|---|---|---|
| A0 Haiku (plan control) | 15% (12–20%) | 0.013 | dev60 15% |
| v1-M alone | 43% (38–48%) | 0.0155 + 61K Mercury tokens | dev60 48%, in-sample. A1-C (Haiku) scored 20/60 on both dev60 and devCheck, so little shrink is expected |
| sonnet-a1 alone | 43% (38–47%) | 0.115 | dev60 47% |
| **VL-1** | **50% (45–55%)** | **≈ 0.15** + 61K Mercury tokens | both-pass + q·mixed, with q 0.70–0.85 and the dev60 overlap |
| VL-1h | 47% (42–52%) | ≈ 0.034 | post-hoc dev60 32/60 |
| Opus 5.5 xhigh, A0 (`a0o-look2-1`) | prior 42% (35–50%) | prior 0.9–1.5 | leaderboard 35.8% at $0.89 (official loop, private set); our CLI setup is unmeasured |

**Statistical power.** With about 15–20 discordant pairs, a 60-task paired test detects only differences of about
8–10 tasks at α 0.05. VL-1 against Opus will most likely be **inconclusive on pass rate and decisive on cost**: about
6–10 times cheaper per task. Cost per verified success: about $0.30 for VL-1 against an expected $2–3.5 for Opus.

## 9. Decision rules (written before data)

**VERIFIER-LAB.md §4.3, verbatim:**
- **Selection works on fresh tasks** when VL-1 − v1-M ≥ +3 with at most 2 losses. Then default-plus-challenger with an
  RL2/judge selector becomes the A1F mode, and RL2 becomes the commit-gate signal for A1-C v2.1.
- **Selection is not the lever** when VL-1 − v1-M ≤ +1. Then fork selection stops and the verification budget moves to
  the in-pipeline, plan-level gate.
- **Against Opus:** if VL-1 ≥ Opus − 2 tasks at ≤ 20% of Opus's cost per task, record "a cheap mixed system at frontier
  parity on 60 unseen dev tasks (exploratory, A1F)". A claim needs a sealed rerun: testRef after A0 and A1 (§12), or
  a fresh pool. Look 3 is too small (23 tasks).
- **Repair (VL-1R)** is worth carrying into A1-C only if, on the treated tasks, it gains more than it breaks, measured
  against the regrade control, and the HP checks' precision on picks is at least 0.7.

**Added by this preregistration** (the spec left these cases open):
- **No rule fires.** If VL-1 − v1-M is +2, or ≥ +3 with 3 or more losses, the outcome is **"inconclusive"**. No plan
  changes on look 2's evidence, and the question waits for a sealed rerun.
- **Comparison costs.** The Opus comparison uses VL-1's acting plus verifier cost per task (Mercury tokens at $0)
  against `a0o-look2-1`'s `costUsd` per task.
- **"HP-check precision on picks"** is computed on all P2/R3 picks: the share of flagged picks that fail.
- **The McNemar p-value is reported and decides nothing.** The rules above use counts only, so an exploratory
  p < 0.05 is never a claim.
- **The rules are applied mechanically** by `score.mjs` `decide()` into `RESULT.json.decisions` (tested).
- **Forks not finished.** If a fork cannot finish (cap stop, faults exhausted), VL-1 is not scored on a partial run.
  That is recorded as a deviation and needs a decision.

## 10. Caps and spend (D22: non-frontier dev arms, $40 in total, shared with the A1-C v2 chain's $24 of caps)

| Item | Cap |
|---|---|
| `a1s-look2` (`--cap 10`) | $10 |
| RL2 (extract stops at $1.5 journal total; judge at $2 journal total) | $3.5 (at most $2 in practice) |
| Haiku judge (`--usd-cap 0.75`) | $0.75 |
| VL-1R (`--cap 1`) | $1 |
| **Total** | **≤ $15.25** (expected about $9: Sonnet ~$7, RL2 ~$1, judge ~$0.5, VL-1R ≤ $1) |

No Mercury tokens are spent beyond the chain's (D18). Model ids come only from `policy/models.json`:
`claude-sonnet-5-5`, `claude-haiku-5-5`, and `claude-opus-5-5` (reference, already run).

## 11. Frozen files and prompts (sha256)

All of the files below are listed in `research/automationbench-20261014/vl1/VL1-FROZEN-SHA256SUMS` (sha256 `84854d98f681dc836fac62e9e416587f74054adc4ea7da103e295b8501775c6b`),
which `run-look2.sh` checks with `sha256sum -c` before every step.

| File | sha256 |
|---|---|
| `experiments/autobench/verifier/live/build-live.py` | `8e832183a4aa2ab4ea346c27c8905eb7a4e632e79a0138997a553da68d75a44c` |
| `experiments/autobench/verifier/live/lab-load.mjs` | `9453e79f62603f23f7b5f372668b500e6637458039d4fe5bd69de9b6d3c6576a` |
| `experiments/autobench/verifier/live/select.mjs` | `4cbbd601894e966df4d1621cd92c180114aa0ebd345bf34c002c4d26ddc154ab` |
| `experiments/autobench/verifier/live/score.mjs` | `1a9a0d9c9c66f6c786025c5a8097dc8d2173279c6c28a083df225b389a9e4bd5` |
| `experiments/autobench/verifier/live/repair.mjs` | `49e161ac5a70f8d36b003bb8a3fc3152e555e768912c31410b5fb1de7c53b4c7` |
| `experiments/autobench/verifier/live/run-look2.sh` | `b83ae97221da22b0e6cd5874fdd20de803d01f71f5345f69f284281aa4af35a4` |
| `experiments/autobench/verifier/live/launch-a1s-look2.sh` | `e2e06f26cc002bb053642370974b643575830f9663681d16e3dbb97bbc51d489` |
| `experiments/autobench/verifier/live/live.test.mjs` | `6209b54711c0ae4c24b02d06f284d1288240f7c4103eff14700744718758d6da` |
| `experiments/autobench/verifier/live/repro-check.mjs` | `26c087c0997f1f9b3a358b3c9c25c928135a827a52a8cf8730b6cf3ff1b465a5` |
| `experiments/autobench/verifier/live/repro-dev60.sh` | `340e9c42e91e22a2373d686b7d800d978c4e4e3fbc01a5731fa081e2a73732e8` |
| `experiments/autobench/verifier/requirement-ledger-v2/check.mjs` | `b085993cde9d839a0c1c2bf0d4fc7f4e10f4fbb0eb74f0f88f1322f875287184` |
| `experiments/autobench/verifier/requirement-ledger-v2/compile.mjs` | `e0e7e7f34a9f50ce669d711c9a509102fc42cb29c88c71110d15f4fdf46acf20` |
| `experiments/autobench/verifier/requirement-ledger-v2/eval.mjs` | `0e398f87faa3a4f4a6a313ff7a55688ea01d8b92088cfaf1b22a506cf0696044` |
| `experiments/autobench/verifier/requirement-ledger-v2/extract.mjs` | `8a22cc2a1fe0698bfe7efa3613b87ced52315a1133172f445b14b17b09addec6` |
| `experiments/autobench/verifier/requirement-ledger-v2/judge.mjs` | `69bfba87c0b03cab02e0b0afa0f7b28fbbd7da7e32473de313fa8f6f5435b276` |
| `experiments/autobench/verifier/requirement-ledger-v2/lib.mjs` | `ca4144939a9183f945ee6d4f3ff41abeceb914c9085c94325aee75afc7afd421` |
| `experiments/autobench/verifier/requirement-ledger-v2/render.mjs` | `03c82d673e5b78a6ddb34d6fc41f8c5dbafb49f4d26796173505da50214b074d` |
| `experiments/autobench/verifier/requirement-ledger-v2/rl2.test.mjs` | `ea66e610591a79de8e3d9c51da05b3403ca9bdb68362ef4d8581cf087dcda807` |
| `experiments/autobench/verifier/requirement-ledger-v2/run.mjs` | `cec31aa260268589625525f5013e818684311e6d9ff19945056799c7d5287386` (frozen-v1 `ca02b5a4…` + `--fallback-reader`, unused) |
| `experiments/autobench/verifier/requirement-ledger-v2/verify.mjs` | `2a5184875c5d6357b64e002c9f03b6a2229de8e5e539f2d9594061d4f3631559` |
| `experiments/autobench/verifier/diverse-judges/judge.mjs` | `96f1f095fc74d98333f94b89073f3fb3dd0f6a552214772bcf11a5e46b1cce0e` |
| `experiments/autobench/verifier/diverse-judges/view.mjs` | `32589a668a6e421778a9f524880cdd22940903258d6870939240dc82d9552efb` |
| `experiments/autobench/verifier/diverse-judges/run.mjs` | `3ad5e1cf5f9361f741799e666303fb5134abbe0204e03d5f5417ac6344a8f75a` |
| `experiments/autobench/verifier/diverse-judges/test/diverse-judges.test.mjs` | `b63d1c3b66aeeb2e2f06224905094a97207a1dc270c73b10675a1caf748914eb` |
| `research/automationbench-20261014/LOOK2-TASKS.json` | `85099131ad42ff27dd547c087797552fc424906093b5feb560ea5b81ebd2f567` |
| `research/automationbench-20261014/vl1/RL2-FROZEN-SHA256SUMS` (copy of the lab's `rl2-out/frozen-v1-src/SHA256SUMS`, frozen 2026-10-21T22:55:08Z) | `9ed59f24f162e3e648a907c4e5d0633f9b755d2e05a20eb5a7753db119cca8d0` |

**Prompts and schemas.** Each hash is sha256 of the system or instructions text concatenated with
`JSON.stringify(schema)`.

| Prompt | Version | sha256 |
|---|---|---|
| Haiku judge instructions + output schema | `dj-v3` | `e7e3ce823b0bb585af4319b7e37f05b7c9c1503b23cdc17c98a2849a42c25254` (the lab's `e7e3ce823b0bb585…`) |
| RL2 extraction system + ledger schema | `rl2-extract-v3` | `f7d72efd88dd16324db48b4330452568d80429cf48e8ccac64f9857c880ba41d` |
| RL2 judged-check system + schema | `rl2-judge-v1` | `d6e63ee815a38d12423f6a3f92b1ef6f43ce0861753858c10d1aaa6d28c41fb2` |
| VL-1R brief (head + rules) | `vl1-repair-v1` | `5b156ce4c6abe7849b8266a96c69d27160779b5605cdc6f9f3f1dec6b5350e1e` |
| Rule definitions (`select.mjs` RULES) | `vl1-select-v1` | `2d489d59b55797c8b4a650c117d7a04d25d7b73e09a5d5ff5e4bb17927dd3336` |

The extraction and judged-check prompt templates are in `extract.mjs` and `judge.mjs`, and the Haiku judge's renderer
in `view.mjs`; the file hashes cover them.

**Recorded, not enforced.** These shared files belong to other tracks:

| File | sha256 |
|---|---|
| `experiments/lib/models.mjs` | `d868e7d95c442b35fca25fac5e6e81b548f7f02f85e714d3303a94317d23b4d9` |
| `src/models/port.mjs` | `bdc48f1fcd53ba2c7c788c0d97922965dbaff686a859a55f1dd3638b1068873a` |
| `src/models/policy.mjs` | `95390dec17adbfa0c68dc0e05314e7a95192e79e303b006412a1bedb4500b572` |
| `policy/models.json` (policyVersion `2026-10-21.2`) | `cffef22b216b382705b1086b004330a6d2b24366aed8cf506668b9e1a812ea69` |

## 12. $0 reproduction on the stored dev60 worlds (development evidence)

**Command:**

```
S=/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad
DEV_LAB=$S/vlab DEV_RL2=$S/rl2-out DEV_EVAL=$S/judge/judge-eval.json OUT=/var/tmp/foundry-work/vl1-dev60-repro \
  bash experiments/autobench/verifier/live/repro-dev60.sh
```

**What it runs.** The same live pipeline end to end, on the 6 reported dev60 arms (the lab's arm order and its
independent prepares for the initial-world rebuild):
- `build-live.py`;
- the frozen RL2 `check` phase;
- the RL2 `judge` phase with `--dry`, which must report 0 calls;
- the Haiku judge's stored verdicts, used only after their prompts are matched to its journals;
- `select.mjs`;
- `score.mjs` on the dev60 headline grades.

**Why no model call can happen:**
- `claude` is kept off PATH for every verifier step;
- the RL2 judge phase made 0 calls;
- the Haiku judge had 0 rows to judge.

**The checks** (`repro-check.mjs`; outputs in `research/automationbench-20261014/vl1/repro-dev60/`):

| Check | Result |
|---|---|
| live lab rows against the lab's rows, every verifier-visible field (prompt, date, services, diff, world hashes, rebuild statistics, outcome, canonical, write log) | **364/364 identical**. The 4 non-outcome rows differ only in `steps`, which the lab read from the grade file and the live builder cannot |
| RL2 checks recomputed against the lab's stored checks | **360/360 identical** |
| RL2 judged inputs with a stored judgment (same prompt key) | **173/173** |
| Haiku-judge prompts found in its journals (main + pilot), with the stored verdict equal to the journal call's verdict | **360/360** |
| scored cells against the lab's pre-declared rule table (`judge-eval.json`: P2, P3, P3s, P6 × R0–R3, all 60 and held-out folds 3–4) | **32/32 equal**. One bootstrap interval (P3/R1, all 60) matches once the tasks are fed in the lab's row order; the counts are equal either way |

**Reproduced numbers** (all 60 tasks / held-out folds 3–4, 24 tasks):

| Cell (dev60 analogue) | Passes | vs m3-a1c alone | Exact McNemar p | Bootstrap 95% | $ / task (acting + verifier) |
|---|---|---|---|---|---|
| R0, m3-a1c alone (v1-M analogue) | 29 / 13 | – | – | – | 0.0155 + 61.3K Mercury tokens (alone) |
| **P2/R3 (VL-1 analogue)** | **34 / 15** | +5 (+6/−1) / +2 (+3/−1) | 0.125 / 0.625 | [0, +10] / [−2, +6] | **0.131 + 0.021 = 0.152**; $0.268 per success |
| P2/R1 | 33 / 15 | +4 (+4/−0) / +2 | 0.125 / 0.5 | [+1, +8] / [0, +5] | 0.152 |
| P2/R2 | 34 / 14 | +5 (+6/−1) / +1 | 0.125 / 1 | [0, +10] / [−2, +4] | 0.152 |
| P2h/R2 (VL-1h analogue, post hoc) | 32 / 15 | +3 (+3/−0) / +2 | 0.25 / 0.5 | [0, +7] / [0, +5] | 0.050 |
| P3h/R3 (VL-3 analogue, with haiku-a0) | 33 / 14 | +4 (+6/−2) / +1 | 0.289 / 1 | [−1, +10] / [−2, +4] | 0.168 |
| P3/R3, P3s/R3, P6/R3 (lab pools) | 29, 34, 30 / 13, 15, 14 | as the lab: +5/−5, +9/−4, +7/−6 | | [−6, +6], [−2, +12], [−6, +8] | 0.092, 0.170, 0.329 |

**Reproduced diagnostics:**
- **HP-check precision on the P2/R3 picks: 7 of 13 flagged picks fail (0.54).** VERIFIER-LAB.md §1.5 gives 7 of 26
  failing and 6 of 34 passing flagged: the same picks.
- **VL-1R plan:** `repair.mjs --plan-only` selects the same 13 tasks.
- **m3-a1c Mercury tokens:** 3.68M over 60 tasks, 61.3K per task.
- **VL-1R plumbing, $0 smoke.** The real bridge from the pin ran on 3 of those tasks with a scripted no-model session
  that tried 14 steps:
  - the control regrade equalled the live grade on 3 of 3, so no drift;
  - the bridge stopped the session at 10 world steps;
  - no model call was made.

**Verifier cost per task.** The reproduced verifier cost for P2 is $0.021 per task, against the lab's $0.019. The
difference is extraction calls that failed and were retried. VL-1's accounting counts every call; the lab counted
the 180 successful ones.

**Tests.** `node --test experiments/autobench/verifier/live/live.test.mjs`: **6/6 pass**. They are the spec's tests
1–5, plus score statistics and the decision rules. The hygiene test also passes with `VLAB_TASKS` set to the 60 dev60
names. The frozen RL2 and Haiku-judge suites are unchanged and pass **16/16**.

## 13. Implementation decisions the spec left open (disclosed)

1. **Outcome rule.** A row is a candidate when the runner scored it: no skip, no host error, no environment fault. A
   session that ended on another error (for example a timeout) is a candidate, because the headline grades its world.
   The lab's builder excluded every session error. No dev60 row had a non-fault session error, so the reproduction is
   unaffected.
2. **Ties go to the pool's listed fork order, default first** (§6.2). This changes nothing for P2, P2h or P3, and puts
   `v2m` first in P2v2.
3. **Missing candidates and missing verifier output** are handled as in §1 and §6.1.
4. **The bootstrap feeds tasks in sorted order.** The lab fed them in its dataset row order. The distribution is the
   same; only one dev60 interval moved, by one task at each end.
5. **The A1 fork omits `--harness-hash`** to keep the dev-only guard. Its hash is enforced by the launcher instead
   (§3).
6. **VL-1R:**
   - The audit uses the round's response allowance (50 − responses used) as H3's limit.
   - The pick's world comes from the lab's copy of the exported final world.
   - The steps and responses the pick used are read from `results.jsonl` through an allowlist (`steps`,
     `session.modelResponses`).
7. **Verifier cost attribution** follows §7.

## 14. Risks

- **P2 was found by looking**, from about 60 dev60 selection cells. Look 2 is its first honest test.
- **v1-M is out of sample on look 2.** The selector may switch more, and its pick accuracy q off dev60 is unmeasured.
- **RL2 reads the full initial world from prep.** That is fine for an A1F selector, but not available inside A1.
- **Expected look-2 ceiling about 85–90%**, given the dev60 benchmark defects (VERIFIER-LAB.md §2).
- **A regrade of an exported world can drift from its live grade.** VL-1R measures this with its control.
- **The Opus reference ran from the main tree's bridge** (`caf3ddd6…`, identical for official tasks) and finished
  before this freeze. Only its aggregate was seen (§0).
