# FH-1 result: failure handling on real recurring failures, with verification precision as the factor (2026-10-21/22)

- **Evidence grade.** Development. Dev worlds only (grading 1232–1234 × d2/d3/d5, practice 1235–1237); all eight incident
  programs and their failures were inspected before the preregistration. One session per attempt; K = 1 per arm and incident for
  the frozen decisions, with an H-C k2 replication on five incidents. No sealed or held-out claim follows, and no K = 1
  comparison is proof.
- **Protocol.** As frozen in [PREREG-FH1.md](PREREG-FH1.md) at commit `38e42fb7` (`fh1/FREEZE.json`: sha256 of 34 files and
  the bed digest `b9e5a67138d42a7f`, checked by the plan runner before every paid step; it held for every step), plus
  [AMENDMENT-FH1-1.md](AMENDMENT-FH1-1.md) (commit `c3750989`, written before any further paid call: the steps that hit the
  closed usage window ran once more after it reopened; no decision rule depends on them). Model ids from `policy/models.json`
  only: `claude-haiku-5-5`, effort high, $0.50 and 20 minutes per session, through the repo's Claude CLI executor
  (`src/executors/claude-code.mjs`) in its sandbox.
- **Spend.** **$4.615 of the $5.00 Haiku cap** (`fh1/spend.jsonl`, CLI-reported, 37 session records): k1 arms $3.758 (H-C
  $1.142, H-N $0.604, H-0 $2.012), H-C k2 $0.657, environment-faulted sessions $0.200. Grading, replay, verifiers and every
  analysis: $0. The plan stopped on the budget rule ($4.615 + $0.50 > $5.00) before three k2 steps.
- **Committed** on the worktree branch `worktree-wf_0f86d12b-ab5-2`; not pushed.

## Verdict

| Frozen rule (PREREG §5) | Verdict | Numbers (k1) |
|---|---|---|
| **H1** C3 vs regenerate | **supported (dev)** | H-C beats regeneration's expected net in **7 of 8** incidents (the exception: `ch-e8-3`, 18 vs E 78.5); Σ regressions **0** vs E 279.5; Σ cost **$1.14** vs E $8.07. Exact sign test p = 0.070 (reported, not part of the rule) |
| **H1b** C3 vs retry | **supported (dev)** | H-C keeps a recovering patch in **8 of 8** incidents; 357 recovered, 0 regressed. Retry recovers 0 (every failure is deterministic: identical journals on a second execution, all 11 builds × 12 worlds) |
| **H2** verification precision is the bottleneck | **supported (dev)** | H-C > H-N in **8 of 8** incidents (p = 0.0078); H-N recovers no go-live case in **7 of 7** go-live incidents (the N-version majority shares the go-live miss, so it cannot see it) |

**Capability number.** On the 475 real, recurring failing grading cases of eight Haiku-built E8 order-saga programs, the
classify → intervene → patch → replay loop with the 13 capability contracts as its verifier (H-C, one Haiku session per program)
removes **357 net (75.2%)**, regresses **none**, brings **7 of 8** programs to 1,022/1,022, for **$1.142** in total
($0.0032 per net case). The simple baselines: **retry 0 (0%)** at $0; **regenerate +27.5 expected (5.8%)** at $8.07 ($0.29 per
net case, with 279.5 expected regressions). The same loop with a weaker verifier: **N-version 54 (11.4%)**, **no verifier 118
(24.8%)**, all of H-0's from one program and one bug. Post hoc (practice verifier only, not a frozen rule): "heal again while the
verifier still reports failures, at most two fresh sessions" reaches **475/475 (100%) and 8 of 8 programs at 1,022/1,022 for
$1.451 in 9 sessions**, because the one program H-C k1 left short (`ch-e8-3`) was healed completely by its k2 session.

**Reading.**
- **With a verifier that sees the failure, a cheap model heals real recurring workflow defects cheaply and safely.** Retry cannot
  help here (every failure is deterministic), and regeneration trades one requirement family for another (E[regressed] 279.5
  against E[recovered] 307). A scoped patch under a precise verifier keeps everything that worked: no attempt of any arm
  regressed a single grading case.
- **The 10-08 auto-heal's failure to beat retry was not evidence against patching.** Its three incidents were a flaky target
  misrouted to the patcher, a failure its own verifier could not see, and a real fix blocked by governance (§1).
- **Verification precision is necessary.** The go-live requirement (SPEC-E §3.5) is missed by 7 of the 8 programs. Every H-C
  session fixed it (7 of 7). H-N fixed it in 0 of 7, because its majority shares the miss. H-0 fixed it in 0 of 7: one H-0
  session noticed that migrated orders "look incomplete" and declined to change anything without evidence. At class level, no
  arm with a verifier recovered a class its verifier did not see on the practice worlds, except through a shared root cause.
- **It is not sufficient.** On `ch-e8-3` the contracts flagged all 42 failing practice orders, yet the k1 patcher fixed the
  wrong layer. The root cause was one token: the error classifier read the HTTP status `code` instead of the `reason`, so a
  `400 field-renamed` was treated as transient and re-sent unchanged. The k2 session and the H-0 session both found it, and a
  $0 counterfactual confirms it (+118/−0). Three sessions wrote that they could not see the raw error payload. After verifier
  precision, the next bottleneck is **evidence for the patcher**: the raw effect results of the failing orders.

## 0. D20: the heal-kit drift, decided, and the heal suite back

Full record: [research/heal-20261008/D20-HEAL-UNBLOCK.md](../heal-20261008/D20-HEAL-UNBLOCK.md) (commit `e519ca6d`).

- **Decision.** Neither option as posed. `defaultsByRole` takes the existing "unread" proof (no file of the frozen kit names
  it). The three raised class budgets take a new, code-checked **envelope** proof: the frozen kit reads
  `inputBudgetTokensByClass` only from its own policy of record, at three audited sites, and only as an upper bound (the
  `Math.min` cap site is checked), and per class the record's bound is at most the owner's (8K/16K/32K ≤ 100K). Every call the
  kit can make is therefore inside the owner's current envelope, and nothing about the recorded evidence changes. The kit sources
  the proof reads are the frozen kit's own snapshot (`/opt/foundry-kit/7e8f0f83153c5efb`), so tonight's engine v2 merge into
  `src/` cannot touch it.
- **Why not (a), re-freeze.** Measured at $0 (`d20-proof.json`): re-freezing to the owner file changes the replay key of
  **all 2,631** recorded C0-dev and P1 model calls (the owner file's `claude-cli` provider entry enters every model digest) and the
  policy hash; every committed `runs/H-*.json` would stop reproducing. A narrow re-freeze of only the blocking paths keeps the
  keys but changes the policy hash in every run identity and would run new heal calls under budgets no recorded run had.
  Option (b) alone leaves the three budget paths blocking.
- **Tests.** The heal suite runs with **0 skips**. Re-run 2026-10-22 02:21–02:47 UTC, file by file (nice 15, concurrency 1,
  private work root deleted after), under load 9 to 18 on 4 CPUs: **98 tests, 98 pass, 0 fail, 0 skipped** (15 files; `p1`
  2/2, the test that failed once under load on 10-21; `kit-gate` 14/14, including the narrowness cases: an owner bound lowered
  below the record, a class added or dropped, a fractional bound, an unaudited read, a `Math.max` cap and a kit that names
  `defaultsByRole` each block). FH-1's own tests: `experiments/fh/test/fh.test.mjs` 8/8.

**Text for `research/decisions-20261021.md`** (not edited in the main tree from this worktree; append on merge):

| # | Pending question | Decision | Why | Reversal cost |
|---|---|---|---|---|
| D20 | Heal-kit policy drift (README "Heal-kit drift", PREREG-NEED-V1 §13 D6): (a) re-freeze the kit's policy of record, or (b) a proved exemption for `defaultsByRole` | (b) extended: `defaultsByRole` proved unread; the F/L/M class budgets proved inside the owner's envelope (read only from the record, only as an upper bound, record ≤ owner per class), re-checked on every load. The policy of record is unchanged | Keeps the frozen kit's evidence valid and is provable: all 2,631 recorded replay keys and policy hash `fe63f99b` unchanged, where (a) breaks all 2,631; heal replays unblocked; heal suite 98 tests, 0 skipped, 98 pass (re-run 10-22). First use: FH-1 (C3 supported, dev) | Empty `ENVELOPE_BOUNDS_READ_BY_KIT`, drop `defaultsByRole` from `TOP_LEVEL_KEYS_UNREAD_BY_KIT` |

## 1. Why the 10-08 auto-heal did not beat retry (root cause, from the recorded data)

| Incident | Recorded | Root cause | Kind |
|---|---|---|---|
| H-p1 | retry 8/8, healed 8/8 (+15% cost; `experiments/heal/runs/live-20261008-r4/p1-retry.json`) | A **flaky target** (base error about 1 in 36) **misrouted**: the offline classifier cannot run the variance test (`"variance not tested (needs a live provider)"`, `research/heal-20261008/runs/H-p1.json`) and labelled it `workflow-defect`, so a variance incident went to the patcher. The patch worked on its error class (0/88 → 88/88 injected), but on the natural pass rate it could only tie | classify / intervene |
| H-rec | retry 0/4 with the workflow's own verdict **pass 4/4**; healed 0/4, verdict 4/4 (`rec-escalate.json`: base `pass 0, verdictPass 4`); 0 of 16 candidates valid | **Verification precision zero**: existence-only acceptance could not see the failure, so the patch loop had no correctness signal of its own; and **patch scope**: the closed op grammar could not express a per-row guard | verifier + patch scope |
| H-cfx | retry 0 (deterministic) | Two real fixes (3/3 vs 0/3), **blocked** by governance (lint debt, relax → owner review) | promotion rules |

None of the three tested a precise verifier driving a code-level patch on deterministic defects. FH-1 does exactly that and
varies only the verifier.

## 2. Bed, baselines and verifiers ($0, before the freeze)

Eight incidents, every Haiku-built E8 program with a failing grading case: the six COMP-1 composed builds and the two imperfect
B1L-H monoliths, **475 failing grading cases** in 39 (program, class) cells (go-live §3.5 in 7 of 8; review timing; the d5
`amountMinor` → `amount` rename; refunds after a cancel during processing; partial reserve). Full tables in PREREG-FH1 §1.1.

- **Retry (R):** for all 11 builds a second execution gave byte-identical journals on all 12 worlds: retry recovers 0.
- **Regenerate (G):** leave-one-out over the recorded builds of the incident's own arm: E[net] **+27.5** of 475
  (E[recovered] 307, E[regressed] 279.5) at E[$] **8.07**. A fresh build trades one requirement family for another.
- **Verifiers on the practice worlds against the oracle:** capability contracts precision **1.000**, recall **1.000** (158
  failing orders); 9-build N-version precision **0.609**, recall **0.354**, **0/92** on go-live (seven of nine builds share
  the go-live miss, so the majority is wrong there).

## 3. Results

### 3.1 Per incident (k1, the frozen comparison)

Recovered/regressed are grading cases (9 worlds, 1,022 completed cases per program) relative to the incident. "Raw" is the
patch before the gate, "kept" after it. G is the leave-one-out expectation over the two recorded peers of the same build arm.

| Incident | Failing | Retry (R) | Regenerate (G): E[+/−], E[net], E[$] | H-C k1: gate, kept +/− (net), raw +/−, $ | H-N k1: gate, kept +/− (net), raw +/−, $ | H-0 k1: gate, kept +/− (net), raw +/−, $ |
|---|---|---|---|---|---|---|
| ch-e8-1 | 48 | +0/−0 ($0) | +15/−68.5, **-53.5**, $0.695 | ACCEPT; +48/−0 (**48**); raw +48/−0; $0.069 | no signal: no session, net 0, $0 | ACCEPT; +0/−0 (**0**); raw +0/−0; $0.232 |
| ch-e8-2 | 67 | +0/−0 ($0) | +34/−59, **-25**, $1.295 | ACCEPT; +67/−0 (**67**); raw +67/−0; $0.205 | no signal: no session, net 0, $0 | ACCEPT; +0/−0 (**0**); raw +0/−0; $0.170 |
| ch-e8-3 | 136 | +0/−0 ($0) | +118/−39.5, **78.5**, $1.130 | ACCEPT; +18/−0 (**18**); raw +18/−0; $0.397 | reject; +0/−0 (**0**); raw +0/−0; $0.323 | ACCEPT; +118/−0 (**118**); raw +118/−0; $0.320 |
| cht-e8-1 | 19 | +0/−0 ($0) | +1/−57, **-56**, $1.140 | ACCEPT; +19/−0 (**19**); raw +19/−0; $0.036 | reject; +0/−0 (**0**); raw +0/−0; $0.166 | ACCEPT; +0/−0 (**0**); raw +0/−0; $0.390 |
| cht-e8-2 | 48 | +0/−0 ($0) | +15/−27.5, **-12.5**, $1.430 | ACCEPT; +48/−0 (**48**); raw +48/−0; $0.279 | no signal: no session, net 0, $0 | ACCEPT; +0/−0 (**0**); raw +0/−0; $0.219 |
| cht-e8-3 | 102 | +0/−0 ($0) | +69/−0.5, **68.5**, $1.410 | ACCEPT; +102/−0 (**102**); raw +102/−0; $0.077 | ACCEPT; +54/−0 (**54**); raw +54/−0; $0.047 | ACCEPT; +0/−0 (**0**); raw +0/−0; $0.248 |
| b1lh-e8-2 | 48 | +0/−0 ($0) | +48/−3.5, **44.5**, $0.460 | ACCEPT; +48/−0 (**48**); raw +48/−0; $0.036 | no signal: no session, net 0, $0 | ACCEPT; +0/−0 (**0**); raw +0/−0; $0.178 |
| b1lh-e8-3 | 7 | +0/−0 ($0) | +7/−24, **-17**, $0.505 | ACCEPT; +7/−0 (**7**); raw +7/−0; $0.043 | reject; +0/−0 (**0**); raw +0/−0; $0.067 | ACCEPT; +0/−0 (**0**); raw +0/−0; $0.256 |

### 3.2 Pooled, with the headline capability number

| Arm | Incidents | Recovered | Regressed | Net | Net ÷ 475 failing | Incidents at 1,022/1,022 | $ | $ per net case |
|---|---|---|---|---|---|---|---|---|
| retry | 8 | 0 | 0 | **0** | 0.0% | 0 | $0.000 | — |
| regenerate (expected, same arm) | 8 | 307 | 279.5 | **27.5** | 5.8% | — (expected) | $8.065 | $0.293 |
| H-C k1 (kept after gate) | 8 | 357 | 0 | **357** | 75.2% | 7 | $1.142 | $0.003 |
| H-C k1 (raw patch, no gate) | 8 | 357 | 0 | **357** | 75.2% | 7 | $1.142 | $0.003 |
| H-C k2 (kept after gate) | 5 | 318 | 0 | **318** | 66.9% | 5 | $0.657 | $0.002 |
| H-C k2 (raw patch, no gate) | 5 | 318 | 0 | **318** | 66.9% | 5 | $0.657 | $0.002 |
| H-N k1 (kept after gate) | 8 | 54 | 0 | **54** | 11.4% | 0 | $0.604 | $0.011 |
| H-N k1 (raw patch, no gate) | 8 | 54 | 0 | **54** | 11.4% | 0 | $0.604 | $0.011 |
| H-0 k1 (kept after gate) | 8 | 118 | 0 | **118** | 24.8% | 0 | $2.012 | $0.017 |
| H-0 k1 (raw patch, no gate) | 8 | 118 | 0 | **118** | 24.8% | 0 | $2.012 | $0.017 |

The H-C k2 row covers 5 incidents (`ch-e8-1`, `ch-e8-2`, `ch-e8-3`, `cht-e8-1`, `cht-e8-2`). Their failing cases total 318, and
k2 recovered **all 318** (100% of its incidents). The 66.9% in the table is of all 475. Kept and raw rows are identical for
every arm because no gate rejected a good patch of its own arm and no arm produced a harmful one.

### 3.3 Replication: H-C k1 versus k2 (secondary)

Five incidents have a k2 session (each from the original program, independent of k1). Four of five give the identical outcome;
the fifth (`ch-e8-3`) is the one k1 left short.

| Incident | k1: practice contracts after, kept net, $ | k2: practice contracts after, kept net, $ | Same outcome |
|---|---|---|---|
| ch-e8-1 | 324/324, **48**, $0.069 | 324/324, **48**, $0.041 | yes |
| ch-e8-2 | 324/324, **67**, $0.205 | 324/324, **67**, $0.138 | yes |
| ch-e8-3 | 288/324, **18**, $0.397 | 324/324, **136**, $0.310 | no |
| cht-e8-1 | 324/324, **19**, $0.036 | 324/324, **19**, $0.033 | yes |
| cht-e8-2 | 324/324, **48**, $0.279 | 324/324, **48**, $0.137 | yes |

### 3.4 Post hoc: heal until the verifier is clean (at most two fresh sessions)

Not a frozen rule. The policy uses only what the arm itself sees (practice contracts after the gate), never grading. It was
written after k1 was seen, and it had exactly one occasion to act (`ch-e8-3`, the only k1 that left practice failures).

| Incident | k1 practice contracts after | Policy runs k2? | Kept | Net | Sessions | $ |
|---|---|---|---|---|---|---|
| ch-e8-1 | 324/324 | no (clean) | k1 | **48** | 1 | $0.069 |
| ch-e8-2 | 324/324 | no (clean) | k1 | **67** | 1 | $0.205 |
| ch-e8-3 | 288/324 | yes | k2 | **136** | 2 | $0.707 |
| cht-e8-1 | 324/324 | no (clean) | k1 | **19** | 1 | $0.036 |
| cht-e8-2 | 324/324 | no (clean) | k1 | **48** | 1 | $0.279 |
| cht-e8-3 | 324/324 | no (clean) | k1 | **102** | 1 | $0.077 |
| b1lh-e8-2 | 324/324 | no (clean) | k1 | **48** | 1 | $0.036 |
| b1lh-e8-3 | 324/324 | no (clean) | k1 | **7** | 1 | $0.043 |
| **all** | | | | **475** (100.0% of 475) | 9 | $1.451 |

Incidents brought to 1,022/1,022: 8 of 8.

### 3.5 Detection versus recovery, per failure class

"Sees it" counts the class's failing practice orders the verifier flags (analysis only, `verifiers.json`); "0 on practice"
means the class has no failing order on the practice worlds, so no verifier could show it to a session.

| Incident | Failure class | Failing (grading) | Contracts see it (practice) | H-C k1 kept | N-version sees it (practice) | H-N k1 kept | H-0 k1 kept |
|---|---|---|---|---|---|---|---|
| ch-e8-1 | gl-intake | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| ch-e8-1 | gl-awaiting | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| ch-e8-1 | gl-dispatched | 12 | 4/4 | 12/12 | 0/4 | 0/12 | 0/12 |
| ch-e8-2 | gl-intake | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| ch-e8-2 | gl-awaiting | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| ch-e8-2 | gl-dispatched | 12 | 4/4 | 12/12 | 0/4 | 0/12 | 0/12 |
| ch-e8-2 | review-timeout | 12 | 4/4 | 12/12 | 0/4 | 0/12 | 0/12 |
| ch-e8-2 | review-approve | 4 | 1/1 | 4/4 | 0/1 | 0/4 | 0/4 |
| ch-e8-2 | review-reject | 3 | 2/2 | 3/3 | 0/2 | 0/3 | 0/3 |
| ch-e8-3 | straight | 55 | 17/17 | 0/55 | 17/17 | 0/55 | 55/55 |
| ch-e8-3 | gl-intake | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| ch-e8-3 | decline | 13 | 2/2 | 0/13 | 0/2 | 0/13 | 13/13 |
| ch-e8-3 | cancel-processing | 9 | 3/3 | 0/9 | 3/3 | 0/9 | 9/9 |
| ch-e8-3 | cancel-after-collection | 7 | 3/3 | 0/7 | 3/3 | 0/7 | 7/7 |
| ch-e8-3 | f3-refund | 5 | 2/2 | 0/5 | 2/2 | 0/5 | 5/5 |
| ch-e8-3 | f6-carrier | 5 | 0 on practice | 0/5 | 0 on practice | 0/5 | 5/5 |
| ch-e8-3 | collection-failed | 4 | 2/2 | 0/4 | 2/2 | 0/4 | 4/4 |
| ch-e8-3 | f3-charge | 4 | 2/2 | 0/4 | 2/2 | 0/4 | 4/4 |
| ch-e8-3 | cancel-at-collection | 3 | 0 on practice | 0/3 | 0 on practice | 0/3 | 3/3 |
| ch-e8-3 | review-approve | 3 | 1/1 | 0/3 | 1/1 | 0/3 | 3/3 |
| ch-e8-3 | f4-reserve | 3 | 2/2 | 0/3 | 2/2 | 0/3 | 3/3 |
| ch-e8-3 | amend-then-cancel | 2 | 0 on practice | 0/2 | 0 on practice | 0/2 | 2/2 |
| ch-e8-3 | amend | 2 | 0 on practice | 0/2 | 0 on practice | 0/2 | 2/2 |
| ch-e8-3 | f1-charge | 2 | 2/2 | 0/2 | 2/2 | 0/2 | 2/2 |
| ch-e8-3 | action-at-deadline | 1 | 0 on practice | 0/1 | 0 on practice | 0/1 | 1/1 |
| cht-e8-1 | gl-intake | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| cht-e8-1 | cancel-processing | 1 | 1/1 | 1/1 | 0/1 | 0/1 | 0/1 |
| cht-e8-2 | gl-intake | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| cht-e8-2 | gl-awaiting | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| cht-e8-2 | gl-dispatched | 12 | 4/4 | 12/12 | 0/4 | 0/12 | 0/12 |
| cht-e8-3 | cancel-processing | 46 | 16/16 | 46/46 | 16/16 | 46/46 | 0/46 |
| cht-e8-3 | gl-intake | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| cht-e8-3 | gl-awaiting | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| cht-e8-3 | gl-dispatched | 12 | 4/4 | 12/12 | 0/4 | 0/12 | 0/12 |
| cht-e8-3 | amend-then-cancel | 8 | 2/2 | 8/8 | 2/2 | 8/8 | 0/8 |
| b1lh-e8-2 | gl-intake | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| b1lh-e8-2 | gl-awaiting | 18 | 6/6 | 18/18 | 0/6 | 0/18 | 0/18 |
| b1lh-e8-2 | gl-dispatched | 12 | 4/4 | 12/12 | 0/4 | 0/12 | 0/12 |
| b1lh-e8-3 | f4-reserve | 7 | 4/4 | 7/7 | 4/4 | 0/7 | 0/7 |
| **all** | 39 classes | **475** | 34 classes (462 cases) | **357** (24 classes) | 12 classes (153 cases) | **54** (2 classes) | **118** (15 classes) |

### 3.6 Gates scored on every graded attempt (analysis only)

A "good" patch recovers at least one grading case and regresses none. No attempt of any arm regressed anything, so here the
gates were tested only on missing good patches, never on keeping a harmful one; the regression filter was exercised in the
$0 dry run alone (`b1lh-e8-2` swap into `b1lh-e8-3`: raw +7/−48, rejected).

| Gate | Attempts (changed, loads) | Accepted | Accepted and good | Rejected but good | Precision | Recall |
|---|---|---|---|---|---|---|
| H-C | 23 | 15 | 15 | 0 | 1 | 1 |
| H-N | 23 | 3 | 3 | 12 | 1 | 0.2 |
| H-0 | 23 | 23 | 15 | 0 | 0.652 | 1 |

### 3.7 Session log

Every attempt, including the environment faults. `cht-e8-3 H-C k2` never started (budget stop rule); `b1lh-e8-2` and
`b1lh-e8-3 H-C k2` faulted twice in the closed usage window and were then stopped by the budget rule under amendment 1. The
N-version column counts every practice order with an observable signature, including orders the world does not complete. The
verifier tables (§1.1 of the prereg, §3.5) count only completed, graded orders. So `ch-e8-3` shows 60 here and 44 there, and
`cht-e8-1` 10 in both.

| Attempt | Turns | $ | Session min | Smoke runs | Error | Changed | Loads | Module tests | Practice contracts before → after | N-version disagreements before → after | Gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b1lh-e8-2.H-0.k1 | 11 | $0.178 | 7.1 | 1 | (2 env fault before) | true | true | — | 308/324 → 308/324 | 0 → 0 | ACCEPT: loads; no new arm error (no correctness signal) |
| b1lh-e8-2.H-C.k1 | 14 | $0.036 | 3.6 | 2 | — | true | true | — | 308/324 → 324/324 | 0 → 6 | ACCEPT: 16 practice orders recovered, 0 regressed |
| b1lh-e8-2.H-C.k2 | — | — | — | — | environment fault ×2 | | | | | | |
| b1lh-e8-2.H-N.k1 | 0 | $0.000 | — | 0 | — | false | true | — | 308/324 → — | 0 → — | reject: no disagreement: no session |
| b1lh-e8-3.H-0.k1 | 21 | $0.256 | 9.1 | 1 | (2 env fault before) | true | true | — | 320/324 → 320/324 | 20 → 20 | ACCEPT: loads; no new arm error (no correctness signal) |
| b1lh-e8-3.H-C.k1 | 13 | $0.043 | 4.2 | 2 | — | true | true | — | 320/324 → 324/324 | 20 → 16 | ACCEPT: 4 practice orders recovered, 0 regressed |
| b1lh-e8-3.H-C.k2 | — | — | — | — | environment fault ×2 | | | | | | |
| b1lh-e8-3.H-N.k1 | 10 | $0.067 | 5.5 | 1 | — | false | true | — | 320/324 → 320/324 | 20 → 20 | reject: program unchanged |
| ch-e8-1.H-0.k1 | 13 | $0.232 | 7.7 | 2 | — | true | true | 23 | 308/324 → 308/324 | 0 → 0 | ACCEPT: loads; no new arm error (no correctness signal) |
| ch-e8-1.H-C.k1 | 23 | $0.069 | 4.7 | 2 | — | true | true | 23 | 308/324 → 324/324 | 0 → 6 | ACCEPT: 16 practice orders recovered, 0 regressed |
| ch-e8-1.H-C.k2 | 20 | $0.041 | 3.1 | 2 | — | true | true | 24 | 308/324 → 324/324 | 0 → 6 | ACCEPT: 16 practice orders recovered, 0 regressed |
| ch-e8-1.H-N.k1 | 0 | $0.000 | — | 0 | — | false | true | — | 308/324 → — | 0 → — | reject: no disagreement: no session |
| ch-e8-2.H-0.k1 | 24 | $0.170 | 6.7 | 2 | — | true | true | 30 | 301/324 → 301/324 | 0 → 0 | ACCEPT: loads; no new arm error (no correctness signal) |
| ch-e8-2.H-C.k1 | 32 | $0.205 | 6.2 | 2 | — | true | true | 30 | 301/324 → 324/324 | 0 → 6 | ACCEPT: 23 practice orders recovered, 0 regressed |
| ch-e8-2.H-C.k2 | 27 | $0.138 | 4.7 | 1 | (2 env fault before) | true | true | 32 | 301/324 → 324/324 | 0 → 6 | ACCEPT: 23 practice orders recovered, 0 regressed |
| ch-e8-2.H-N.k1 | 0 | $0.000 | — | 0 | — | false | true | — | 301/324 → — | 0 → — | reject: no disagreement: no session |
| ch-e8-3.H-0.k1 | 30 | $0.320 | 10.6 | 4 | — | true | true | 32 | 282/324 → 318/324 | 60 → 10 | ACCEPT: loads; no new arm error (no correctness signal) |
| ch-e8-3.H-C.k1 | 39 | $0.397 | 11.6 | 5 | — | true | true | 31 | 282/324 → 288/324 | 60 → 66 | ACCEPT: 6 practice orders recovered, 0 regressed |
| ch-e8-3.H-C.k2 | 42 | $0.310 | 9.6 | 8 | (2 env fault before) | true | true | 31 | 282/324 → 324/324 | 60 → 16 | ACCEPT: 42 practice orders recovered, 0 regressed |
| ch-e8-3.H-N.k1 | 33 | $0.323 | 8.9 | 2 | — | true | true | 31 | 282/324 → 282/324 | 60 → 60 | reject: no disagreement resolved |
| cht-e8-1.H-0.k1 | 24 | $0.390 | 9.8 | 2 | — | true | true | 58 | 317/324 → 317/324 | 10 → 10 | ACCEPT: loads; no new arm error (no correctness signal) |
| cht-e8-1.H-C.k1 | 21 | $0.036 | 4.0 | 2 | — | true | true | 58 | 317/324 → 324/324 | 10 → 16 | ACCEPT: 7 practice orders recovered, 0 regressed |
| cht-e8-1.H-C.k2 | 20 | $0.033 | 3.7 | 2 | — | true | true | 59 | 317/324 → 324/324 | 10 → 16 | ACCEPT: 7 practice orders recovered, 0 regressed |
| cht-e8-1.H-N.k1 | 32 | $0.166 | 5.2 | 1 | — | false | true | 58 | 317/324 → 317/324 | 10 → 10 | reject: program unchanged |
| cht-e8-2.H-0.k1 | 17 | $0.219 | 7.8 | 2 | — | true | true | 37 | 308/324 → 308/324 | 0 → 0 | ACCEPT: loads; no new arm error (no correctness signal) |
| cht-e8-2.H-C.k1 | 34 | $0.279 | 7.4 | 3 | — | true | true | 41 | 308/324 → 324/324 | 0 → 6 | ACCEPT: 16 practice orders recovered, 0 regressed |
| cht-e8-2.H-C.k2 | 26 | $0.137 | 4.8 | 2 | — | true | true | 37 | 308/324 → 324/324 | 0 → 6 | ACCEPT: 16 practice orders recovered, 0 regressed |
| cht-e8-2.H-N.k1 | 0 | $0.000 | — | 0 | — | false | true | — | 308/324 → — | 0 → — | reject: no disagreement: no session |
| cht-e8-3.H-0.k1 | 22 | $0.248 | 9.0 | 3 | — | true | true | 37 | 290/324 → 290/324 | 18 → 18 | ACCEPT: loads; no new arm error (no correctness signal) |
| cht-e8-3.H-C.k1 | 21 | $0.077 | 4.5 | 1 | — | true | true | 37 | 290/324 → 324/324 | 18 → 6 | ACCEPT: 34 practice orders recovered, 0 regressed |
| cht-e8-3.H-N.k1 | 22 | $0.047 | 6.6 | 3 | — | true | true | 37 | 290/324 → 308/324 | 18 → 0 | ACCEPT: 18 disagreements resolved, 0 new |

## 4. Every non-recovery, root-caused (there were no regressions)

No kept or raw patch of any arm regressed a single grading case (0 regressions over 25 graded attempts). So this section is about what was
not recovered.

**H-C k1: 118 cases, all in `ch-e8-3` (every other incident reached 1,022/1,022).**
- *The defect in the program.* `modules/fulfilment.mjs` classifies an effect error with
  `const codeOf = err => (typeof err === 'string' ? err : err?.code)`. The platform's error object is `{ code: 400, reason:
  'field-renamed', field, renamedTo }` (`beds/ebed/host/mocks.mjs:131`); CONTRACT.md documents `error?` without its fields, and
  SPEC-E says "an error `400` (`invalid-args`, `field-renamed`)". So `isInvalid` never matched. On the d5 worlds, after the F5
  rename of `billing.charge` `amountMinor` → `amount` (`beds/ebed/e8/world.mjs:324`), every charge failed with
  `400 field-renamed`. That was read as transient and re-sent unchanged three times, and then the fulfilment failed. A `402
  card-declined` was likewise retried as transient. The program's own `fixArgs` correction was never reached.
- *Confirmed at $0.* `experiments/fh/counterfactual.mjs` with the one-token edit `err?.reason ?? err?.code`
  (`fh1/rootcause/ch-e8-3-codeOf.{args,result}.json`) gives grading **+118/−0**, 886 → 1,004 of 1,022, on exactly the 15 classes
  H-0 recovered. The remaining 18 cases are go-live, which H-C k1 did fix.
- *Why the k1 session missed it.* It read the smoke tally correctly ("412 `billing.charge error 400 field-renamed`") and then
  edited `fixArgs`: it paired renamed keys by type and name, widened the candidate names, raised the re-issue budget (then
  reverted that) and re-ran the smoke loop five times. Every edit sat downstream of the misclassification. It ended with "I
  couldn't find the cause from what the platform reports", at $0.40 of its $0.50 cap. The k2 session had the same inputs and
  found it ("`isInvalid` only matched a top-level `code`"): **+136/−0**. The H-0 session bypassed it by fitting every request to
  the current schema when it is emitted: +118. So this miss is patcher search variance, around an observation the loop does not
  provide. The smoke report prints `error 400 field-renamed` as one flattened string, never the error object. The H-C k1, H-C
  k2 and H-N sessions each wrote, independently, that they could not see the raw error payload.

**H-N k1: 421 cases.**
- *No signal (4 incidents, 211 cases: `ch-e8-1`, `ch-e8-2`, `cht-e8-2`, `b1lh-e8-2`).* The errors are correlated: 7 of the 9
  voters miss go-live, so the incident agrees with a wrong majority. For `ch-e8-2`'s review-timing failures (19 cases) the
  signature is too coarse: the vote compares effects, statuses and notices, not when they happen.
- *`cht-e8-1` (19).* The 10 disagreements are all false positives (0 of them fail the oracle). The session rightly changed
  nothing. The real failures (go-live 18, one cancel-processing) were never flagged.
- *`b1lh-e8-3` (7).* 20 disagreements, 4 of them true (`f4-reserve`). DISAGREEMENTS.md shows 12 of the 20 (`maxOrders`). All 12
  shown are go-live orders where `b1lh-e8-3` is right and the majority wrong, and the session judged each of them correctly
  (REPAIR-NOTES.md). It never saw the 4 true ones. Precision 0.2, combined with truncation, hid the signal.
- *`ch-e8-3` (136).* 44 flagged, 34 of them true. The session hit the same classifier defect as H-C k1 ("smoke reports only
  effect counts, not the error payloads"). Its one edit (re-issue a 400 for the whole 120-minute window) changed no effect, and
  the gate rejected it.
- *`cht-e8-3` (48).* It fixed everything it was shown (cancel-processing 46 and amend-then-cancel 8; all 18 disagreements were
  true). Go-live (48) was invisible to it.

**H-0 k1: 357 cases.** Seven of the eight sessions ended at +0/−0. Each reviewed the program "against every rule" and changed
plausible paths that the worlds do not exercise or that were already right: same-instant races (S8, S12, S13, S15),
Amsterdam-date edition choice, compensation of unknown releases, and a reserve batch cap turned into the 120-minute window. No
H-0 session fixed go-live (0 of 7). `cht-e8-2`'s session saw it ("migrated orders (§3.5) look incomplete ... I would not guess
at it") and, with no evidence, left it. The one success (`ch-e8-3`, +118) came from a symptom the ungraded smoke does show: a
tally of 412 `field-renamed` errors.

**Classes no verifier could show.** Five `ch-e8-3` classes (13 cases: f6-carrier, cancel-at-collection, amend-then-cancel, amend,
action-at-deadline) have no failing order on the practice worlds. They were recovered (by H-0 and H-C k2) only because they
share the classifier root cause.

**Not run.** `cht-e8-3`, `b1lh-e8-2` and `b1lh-e8-3` H-C k2 were stopped by the budget rule; `b1lh-e8-2` and `b1lh-e8-3` had
faulted twice inside the closed usage window first. All three incidents were already at 1,022/1,022 after k1.

## 5. Cost and efficiency

| | H-C k1 | H-C until clean (post hoc) | Regenerate (expected) | Retry |
|---|---|---|---|---|
| Net cases / 475 | 357 (75.2%) | 475 (100%) | 27.5 (5.8%) | 0 |
| Regressions | 0 | 0 | 279.5 | 0 |
| Programs at 1,022/1,022 | 7 of 8 | 8 of 8 | — | 0 |
| $ total | 1.142 | 1.451 | 8.065 | 0 |
| $ per net case | 0.0032 | 0.0031 | 0.293 | — |
| Sessions | 8 | 9 | 16 builds | — |

- H-C k1 per session: mean $0.143 (median $0.073, range $0.036–$0.397); 24.6 turns on average; 5.8 minutes on average
  (3.6–11.6); 1 to 5 smoke runs. The expensive sessions are the ones whose first hypothesis failed (`ch-e8-3` k1: 39 turns, 5
  smoke runs).
- Against the original builds: the 8 incident programs cost $8.25 to build. One heal session each ($1.14, 14% of that) removes
  75% of their failing cases; heal-until-clean ($1.45, 18%) removes all of them.
- The verifier is not in these numbers. The 13 capability contracts (`experiments/compose/capabilities.mjs`, 741 lines) were
  written once for the E8 family by the frontier analyst during COMP-1 and reused unchanged. Grading, replay and gates are local
  CPU ($0); a heal attempt takes 3–12 minutes of session time plus about 1–3 minutes of grading.
- H-N cost $0.604 for 54 cases. H-0 cost $2.012 for 118, its sessions running longest because nothing told them where to
  look.

## 6. What this does and does not show

- **Development evidence on one family.** Eight E8 programs from three build arms, every one inspected before the freeze.
  Practice and grading worlds come from the same generator (other seeds, same difficulties), so this measures generalisation
  across seeds, not across a distribution shift.
- **The verifier is close to an oracle on these programs.** The contracts agree with the oracle on every practice order
  (precision and recall 1.000). They are written apart from the oracle's transition, but they share the bed's journal indexing
  (`beds/ebed/oracle/view.mjs`) and saga planner (`beds/ebed/lib/saga.mjs`), and they were written by the frontier analyst for
  this family. FH-1 therefore shows what a cheap patcher does **given** a precise verifier. It does not show how to get one for a
  new family, what that costs, or how H-C degrades when the verifier is a cheap model's (precision < 1). That is the next
  question.
- **K.** One session per arm and incident decides the frozen rules. The k2 replication covers 5 of 8 H-C incidents (4 of 5
  identical). Regeneration is estimated from two recorded peers per incident, not from fresh builds.
- **Retry** here is a second execution of a deterministic program. It says nothing about flaky targets, where retry is the
  right action (H-p1, §1).
- **Gates.** No attempt regressed anything, so the paid runs never needed the strict gate's regression filter (§3.6).
- **The post-hoc policy** (heal until clean) uses only practice-verifier information, but it was conceived after k1 and had
  one occasion to act. Preregister it before relying on it.

## 7. Deviations and notes

1. **Usage window (2026-10-21 23:29Z).** Six steps faulted with `MODEL_RATE_LIMIT`, and the single rerun of §3 ran 1–3 s later in
   the same closed window. **Amendment 1** ([AMENDMENT-FH1-1.md](AMENDMENT-FH1-1.md), commit `c3750989`, before any further paid
   call) ran the 8 outstanding steps once more after the window reopened (02:00Z): one sequential worker, the same code (freeze
   check passed before every step), session, gates, $5 cap and 04:13:05Z deadline. `ch-e8-3 H-C k2` was put first, a choice made
   after seeing k1. Executed 02:17–03:01Z: 5 steps ran, then the budget rule stopped the last 3. No decision rule depends on these
   steps.
2. **Worker B exited silently** at 22:59:19Z, 0.12 s after creating the directory of `cht-e8-2 H-C k2`, with no exception line,
   no session and no spend. The cause is not established. Its two unstarted steps went into amendment 1.
3. **The faulted session that had spent** (`b1lh-e8-2.H-0.k1` envfault-1: 10 turns, $0.180) was discarded with its workdir, as
   §3 prescribes. Its rerun started fresh from the original program. Both sessions are counted in the spend. On a fault the
   runner renames the transcript but appends to `smoke.jsonl`, so the `smoke.jsonl` files of `b1lh-e8-2.H-0.k1` and
   `ch-e8-2.H-C.k2` each hold two lines: one smoke run of the faulted session and one of the rerun.
4. **Post-hoc analyses ($0, after unblinding, labelled where they appear):** the counterfactual tool and its `ch-e8-3` result
   (§4), the k1/k2 table and the heal-until-clean policy (§3.3–3.4, `experiments/fh/report.mjs`), and the class-level table
   (§3.5).
5. `PREREG-FH1.md` §8 still reads "(none)". The file is frozen (its sha256 is checked before every paid step), so the
   amendment lives in its own file.

## 8. What to do next (ranked by expected capability per $)

1. **FH-2: evidence for the patcher.** For each example failing order, add its raw effect results (the error object, the request
   arguments, timings) to FAILURES.md and to the smoke loop's output. Preregister it on programs whose defects sit behind an
   interface the spec leaves loose. Prediction: the `ch-e8-3` kind of miss disappears at k1.
2. **Make heal-until-clean the C3 default** (at most 2 fresh sessions, gated on the practice verifier), and preregister it with
   new builds (fresh Haiku E8 or E7 programs) graded on sealed worlds.
3. **The verifier is now the expensive part.** Run H-C with cheap-model-written contracts (the requirement tracker /
   verifier-lab line) and measure how net recovery falls as contract precision and recall fall. That curve is the real-world C3
   number.

## 9. Files

- Design and protocol: [PREREG-FH1.md](PREREG-FH1.md), [AMENDMENT-FH1-1.md](AMENDMENT-FH1-1.md), `fh1/FREEZE.json`,
  `fh1/plan-{A,B,C,R}.txt`.
- Code: `experiments/fh/{grade,baseline,heal,analyse,ensemble,freeze,baseline-table}.mjs` (frozen),
  `experiments/fh/report.mjs` (tables; post-hoc sections labelled), `experiments/fh/counterfactual.mjs` (root-cause tool),
  `experiments/fh/test/fh.test.mjs`.
- Data: `fh1/baseline/*.json` (11 builds, two executions each), `fh1/ensemble-signatures.json`, `fh1/verifiers.json`,
  `fh1/runs/<incident>.<arm>.k<k>/` (record.json, FAILURES.md or DISAGREEMENTS.md, REPAIR-NOTES.md, transcript.jsonl,
  smoke.jsonl, the patched program, grading-after.json, envfault-*.json), `fh1/spend.jsonl`,
  `fh1/rootcause/ch-e8-3-codeOf.{args,result}.json`.
- Reproduce the tables: `node experiments/fh/report.mjs`. Reproduce the root cause: `node experiments/fh/counterfactual.mjs
  research/heal-20261021/fh1/rootcause/ch-e8-3-codeOf.args.json`.
- D20: [D20-HEAL-UNBLOCK.md](../heal-20261008/D20-HEAL-UNBLOCK.md), `experiments/heal/kit.mjs`, `experiments/heal/d20-proof.mjs`,
  [`d20-proof.json`](../heal-20261008/d20-proof.json), `experiments/heal/test/kit-gate.test.mjs`.
