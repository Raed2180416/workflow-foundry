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
- **Reviewed 2026-11-04** (no blocker, six majors, ten minors). Every finding is applied or answered in **§10**, at $0 (no new
  paid call; the FH-1 ledger stays at $4.615). The frozen verdicts below are unchanged, because they are what the frozen rules
  give; what they mean is narrowed in §10.0, and the capability table that should be quoted is **§10.1**, not §3.2.

## Verdict

| Frozen rule (PREREG §5) | Verdict (as frozen) | Numbers (k1) | After the 2026-11-04 review (§10) |
|---|---|---|---|
| **H1** C3 vs regenerate | **supported (dev)** | H-C beats regeneration's expected net in **7 of 8** incidents (the exception: `ch-e8-3`, 18 vs E 78.5); Σ regressions **0** vs E 279.5; Σ cost **$1.14** vs E $8.07. Exact sign test p = 0.070 (reported, not part of the rule) | The 0-vs-279.5 regression gap is the **gate's**, not healing's: regenerate under the same gate also regresses 0 (E[net] 64; best-of-2 128). The cost conjunct holds only if the frontier-written contracts are free: counted at the $6.69 lower bound it still holds ($7.83 ≤ $8.06), at the $19.58 allocated estimate it fails, which would make H1 *inconclusive* (§10.5) |
| **H1b** C3 vs retry | **supported (dev)** | H-C keeps a recovering patch in **8 of 8** incidents; 357 recovered, 0 regressed. Retry recovers 0 (every failure is deterministic: the second execution's case outcomes are identical, all 11 builds × 12 worlds) | **Vacuous as a comparison.** The programs are model-free code, so retry is 0 by construction and the classify → intervene step never had to choose. Restated: *patch → replay beats re-execution on deterministic defects* (§10.6) |
| **H2** verification precision is the bottleneck | **supported (dev)** | H-C > H-N in **8 of 8** incidents (p = 0.0078); H-N recovers no go-live case in **7 of 7** go-live incidents (the N-version majority shares the go-live miss, so it cannot see it) | **Mislabelled and largely predetermined.** The gap is chiefly **recall (visibility)**, plus report content; 4 of the 8 "wins" are no-signal incidents with no H-N session. Where both arms ran a session: **4 of 4, p = 0.125** (§10.4) |

**Capability number (as first reported; superseded by §10.1, which adds the gated regeneration baselines, the go-live split,
the defect count and the verifier's authoring cost).** On the 475 real, recurring failing grading cases of eight Haiku-built E8 order-saga programs, the
classify → intervene → patch → replay loop with the 13 capability contracts as its verifier (H-C, one Haiku session per program)
removes **357 net (75.2%)**, regresses **none**, brings **7 of 8** programs to 1,022/1,022, for **$1.142** in total
($0.0032 per net case). The simple baselines: **retry 0 (0%)** at $0; **regenerate +27.5 expected (5.8%)** at $8.07 ($0.29 per
net case, with 279.5 expected regressions). The same loop with a weaker verifier: **N-version 54 (11.4%)**, **no verifier 118
(24.8%)**, all of H-0's from one program and one bug. (A post-hoc "heal until clean" policy is in §3.4; it is not a capability number: it was conceived after k1, the k2 run order was
chosen after k1, and it had one occasion to act. It must be preregistered before it is quoted, §10.8 m1.)

**Reading.**
- **With a verifier that sees the failure, a cheap model heals real recurring workflow defects cheaply.** Retry cannot help
  here (every failure is deterministic), and ungated regeneration trades one requirement family for another (E[regressed] 279.5
  against E[recovered] 307). *Review correction:* the "safely" belongs to the replay gate, not to patching: regeneration behind
  the same gate also regresses nothing (§10.2), and no heal attempt of any arm regressed anything for the gate to stop.
- **The 10-08 auto-heal's failure to beat retry was not evidence against patching.** Its three incidents were a flaky target
  misrouted to the patcher, a failure its own verifier could not see, and a real fix blocked by governance (§1).
- **Verifier recall (visibility) is necessary** (*review correction*: first written "precision"). The go-live requirement (SPEC-E §3.5) is missed by 7 of the 8 programs. Every H-C
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
  it). The three raised class budgets take a new **envelope check** (*review correction m3*: an audited textual check, not a
data-flow proof; the flow was audited by hand, D20 record §3): the frozen kit reads
  `inputBudgetTokensByClass` only from its own policy of record, at three audited sites, and only as an upper bound (the
  `Math.min` cap site is checked), and per class the record's bound is at most the owner's (8K/16K/32K ≤ 100K). Every call the
  kit can make is therefore inside the owner's current envelope, and nothing about the recorded evidence changes: 0
  `CONTEXT_OVERFLOW` refusals and 0 of 1,820 compiled calls at the class cap, where a truncated call would sit (the largest
  is 67% of its budget; counted 2026-11-04). The kit sources
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
| D20 | Heal-kit policy drift (README "Heal-kit drift", PREREG-NEED-V1 §13 D6): (a) re-freeze the kit's policy of record, or (b) a proved exemption for `defaultsByRole` | (b) extended: `defaultsByRole` proved unread; the F/L/M class budgets proved inside the owner's envelope (read only from the record, only as an upper bound, record ≤ owner per class), re-checked on every load. The policy of record is unchanged | Keeps the frozen kit's evidence valid and is provable: all 2,631 recorded replay keys and policy hash `fe63f99b` unchanged, where (a) breaks all 2,631; heal replays unblocked; heal suite 98 tests, 0 skipped, 98 pass (re-run 10-22). FH-1 does not use the heal kit (corrected 2026-11-04) | Empty `ENVELOPE_BOUNDS_READ_BY_KIT`, drop `defaultsByRole` from `TOP_LEVEL_KEYS_UNREAD_BY_KIT` |

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

- **Retry (R):** for all 11 builds a second execution gave identical case outcomes (+0/−0 case by case) and identical journal
  digests on all 12 worlds: retry recovers 0. *Review correction (m7):* the digest covers a projection of each row (type, time,
  instance, key, system, op, committed, status; `grade.mjs:80`), not payloads, so "byte-identical journals" overstated it; the
  retry result rests on the case-level comparison, which is exact.
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

*Review note (m1): the k2 sample is not random. Amendment 1 put `ch-e8-3` first because k1 had left it short, and the budget
rule then dropped the three k2 steps of incidents k1 had already fixed completely, so the sample over-represents the one
disagreement; "4 of 5 identical" is not an agreement rate.*

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
  written once for the E8 family by the frontier analyst during COMP-1 and reused unchanged. *Review addition (M6):* their
  authoring cost, bounded from the authoring session's transcript at list price, is **$6.69 (lower bound) / $19.58 (allocated
  estimate) / ≤ $179 (the whole harness-building session)**; per program that is $0.84 to $2.45 at the first two (§10.5). Grading, replay and gates are local
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
- **Added by the review (§10):** the regeneration baseline was confounded (no gate); the headline is case-weighted and 58% of it
  is one shared misreading; H2's factor is recall plus report content, not precision; the verifier's cost was uncounted; the
  classify → intervene step was never exercised; the freeze missed transitive dependencies (none changed). On the positive side,
  the heals generalise across nine more unseen dev worlds (78.0%, 0 regressions). They also inherit the originals' fault
  weaknesses and do not carry over to a requirement drift (§10.7).

## 7. Deviations and notes

1. **Usage window (2026-10-21 23:29Z).** Six steps faulted with `MODEL_RATE_LIMIT`, and the single rerun of §3 ran 1–3 s later in
   the same closed window. **Amendment 1** ([AMENDMENT-FH1-1.md](AMENDMENT-FH1-1.md), commit `c3750989`, before any further paid
   call) ran the 8 outstanding steps once more after the window reopened (02:00Z): one sequential worker, the same code (freeze
   check passed before every step), session, gates, $5 cap and 04:13:05Z deadline. `ch-e8-3 H-C k2` was put first, a choice made
   after seeing k1. Executed 02:17–03:01Z: 5 steps ran, then the budget rule stopped the last 3. No decision rule depends on these
   steps.
2. **Worker B exited silently** at 22:59:19Z, 0.12 s after creating the directory of `cht-e8-2 H-C k2`, with no exception line,
   no session and no spend. Its two unstarted steps went into amendment 1. **Correction (2026-11-04, review m8): worker B did
   not exit. The FH-1 build agent suspended it with `kill -STOP` at 22:59:19Z and never resumed it** (an undeclared manual
   intervention in the plan runner; it affected only the two k2 steps above). Evidence in §10.8.
3. **The faulted session that had spent** (`b1lh-e8-2.H-0.k1` envfault-1: 10 turns, $0.180) was discarded with its workdir, as
   §3 prescribes. Its rerun started fresh from the original program. Both sessions are counted in the spend. On a fault the
   runner renames the transcript but appends to `smoke.jsonl`, so the `smoke.jsonl` files of `b1lh-e8-2.H-0.k1` and
   `ch-e8-2.H-C.k2` each hold two lines: one smoke run of the faulted session and one of the rerun.
4. **Post-hoc analyses ($0, after unblinding, labelled where they appear):** the counterfactual tool and its `ch-e8-3` result
   (§4), the k1/k2 table and the heal-until-clean policy (§3.3–3.4, `experiments/fh/report.mjs`), and the class-level table
   (§3.5).
5. `PREREG-FH1.md` §8 still reads "(none)". The file is frozen (its sha256 is checked before every paid step), so the
   amendment lives in its own file.

## 8. What to do next (ranked by expected capability per $; revised after the review)

1. **$0, done in §10:** regeneration under the same gate and best-of-2; the healed programs on nine more unseen dev worlds, under
   the COMP-1 fault battery and under drift, beside the bed's reference policy; the routing step replayed on recorded evidence.
2. **Cents per session: a verifier dose-response (FH-2), preregistered.** One report renderer for every arm, and the verifier
   varied alone: the 13 contracts; the contracts without the §3.5 contract (recall cut where it matters most); the contracts plus
   injected false positives on passing practice orders (precision cut). Same 8 incidents, K ≥ 2. This is the review's M5 test and
   separates what recall and precision are each worth.
3. **Raw evidence for the patcher** (the error object, request arguments and timings of the failing orders' effects in FAILURES.md
   and in the smoke output), as an arm of the same preregistration. Prediction: the `ch-e8-3` kind of miss disappears at k1.
4. **Heal-until-clean, preregistered** (at most two fresh sessions, gated on the practice verifier) on new builds graded on sealed
   worlds, next to a fair regeneration that is given the same FAILURES.md.
5. **Variance incidents through the ladder.** Programs with model nodes (or the 10-08 H-p1, re-executed live K = 8 times) so that
   classify → intervene must choose between retry and patch, and the three 10-08 incidents through the unblocked heal kit and the
   code-patch loop side by side.
6. **Cheap-model-written contracts.** The real-world C3 number is net recovery as a function of the verifier a cheap model can
   write for a new family; the frontier-written contracts here are its upper end.

## 9. Files

- Design and protocol: [PREREG-FH1.md](PREREG-FH1.md), [AMENDMENT-FH1-1.md](AMENDMENT-FH1-1.md), `fh1/FREEZE.json`,
  `fh1/plan-{A,B,C,R}.txt`.
- Code: `experiments/fh/{grade,baseline,heal,analyse,ensemble,freeze,baseline-table}.mjs` (frozen),
  `experiments/fh/report.mjs` (tables; post-hoc sections labelled), `experiments/fh/counterfactual.mjs` (root-cause tool),
  `experiments/fh/test/fh.test.mjs`.
- Data: `fh1/baseline/*.json` (11 builds, two executions each), `fh1/ensemble-signatures.json`, `fh1/verifiers.json`,
  `fh1/runs/<incident>.<arm>.k<k>/` (record.json, FAILURES.md or DISAGREEMENTS.md, REPAIR-NOTES.md, transcript.jsonl,
  smoke.jsonl, patch.json and patch.diff (the kept program as a patch; `node experiments/fh/lean.mjs verify` rebuilds every one),
  grading-after.json, envfault-*.json), `fh1/spend.jsonl`,
  `fh1/rootcause/ch-e8-3-codeOf.{args,result}.json`.
- Added by the review (2026-11-04, $0, not frozen): `experiments/fh/posthoc.mjs` (§10.1-10.5, writes `fh1/posthoc.json`),
  `experiments/fh/durability.mjs` (§10.7, `fh1/durability-{faults,seeds,drift}.json`), `experiments/fh/ladder.mjs` (§10.6),
  `experiments/fh/architect-cost.mjs` (`fh1/architect-cost.json`), `experiments/fh/closure.mjs` (`fh1/FREEZE-CLOSURE.json`),
  `experiments/fh/lean.mjs` (each kept program is now `runs/<attempt>/patch.json` + `patch.diff` against its recorded original;
  the full copies were removed after every patch rebuilt its recorded bundle digest), `experiments/fh/test/fh-review.test.mjs`.
- Reproduce the tables: `node experiments/fh/report.mjs`. Reproduce the root cause: `node experiments/fh/counterfactual.mjs
  research/heal-20261021/fh1/rootcause/ch-e8-3-codeOf.args.json`.
- D20: [D20-HEAL-UNBLOCK.md](../heal-20261008/D20-HEAL-UNBLOCK.md), `experiments/heal/kit.mjs`, `experiments/heal/d20-proof.mjs`,
  [`d20-proof.json`](../heal-20261008/d20-proof.json), `experiments/heal/test/kit-gate.test.mjs`.

## 10. Review response (2026-11-04)

The review found no blocker, six major and ten minor findings. Everything below is post hoc, after unblinding, at $0 (no model
call; the FH-1 ledger stays at $4.615) and development evidence. None of it changes a frozen verdict; it changes what the
verdicts may be taken to mean. Code: `experiments/fh/{posthoc,durability,ladder,architect-cost,closure,lean}.mjs`, tests in
`experiments/fh/test/fh-review.test.mjs`.

### 10.0 What changes in the reading

- **The claim is narrower.** What FH-1 shows is *patch → replay on deterministic defects, given a near-oracle, frontier-written
  verifier*: one Haiku session per program removes 75.2% of the failing cases with no regression. It does not show the classify →
  intervene step (never exercised), a cheap way to get the verifier (its authoring cost was uncounted), or safety from healing
  itself (the gate supplies it).
- **The fair baseline is regeneration under the same gate**: E[net] 64 (13.5%), best-of-2 128 (26.9%), both with 0 regressions.
  Heal still leads, 357 against 128, at $1.14 against $16.13 of Haiku, but by ×2.8, not by the ×13 of the ungated comparison.
- **58% of the headline is one shared misreading** (go-live, SPEC-E §3.5: 276 of the 475 cases, in 7 programs). Off go-live, H-C
  recovers 81 of 199 cases (40.7%), the no-verifier arm 118 (59.3%), best-of-2 gated regeneration 80. Counted in defects, H-C
  fixes 11 of 12 (4 of the 5 that are not go-live); H-0 and H-N fix 1 each.
- **H2 is about recall, not precision**, is largely predetermined by the verifier measurements taken before any session, and
  holds 4 of 4 (p = 0.125), not 8 of 8 (p = 0.0078), where both arms actually ran a session.
- **H1's cost conjunct depends on how the verifier is charged.** Free (as frozen): holds. At the lower bound of its authoring
  cost ($6.69): holds, barely. At the allocated estimate ($19.58): fails, and H1 would be *inconclusive*.
- **Durability, at $0** (§10.7).
  - *Seeds:* on nine more unseen dev worlds the healed programs recover 361 of the originals' 463 failing cases (78.0%), with 0
    regressions. 7 of 8 reach 995/995, like the hand-written reference; that reference reads world truth.
  - *Effort:* they emit the reference's effects plus two lookups per order, and use 1.02–1.30× its ticks.
  - *Faults:* under the COMP-1 fault battery they keep their gains (+506, −10). The 10 losses are crash-phase displacement,
    root-caused. They inherit the originals' fault weaknesses unchanged.
  - *Drift:* under drift D1 no heal carries over (0 of 8 changed cases). Durability under change needs a new heal.
- **A protocol deviation was misreported.** Worker B's "silent exit" was the FH-1 build agent suspending it with `kill -STOP`
  (§10.8 m8). It touched only two k2 steps and no decision rule, but it was an undeclared manual intervention in the plan runner.
- **The owner's A4 ask stays open (⚠)**, with the items listed in §10.7.

### 10.1 The capability table to quote

Haiku dollars only; the architect column names what frontier-side work each arm relies on and whether it is counted. Defects are
a post-hoc grouping (§10.3). "Fully fixed" = the program ends at 1,022/1,022.

| Arm | Net / 475 | Go-live (276) | Other (199) | Regressions | Defects fixed (of 12) | Programs fully fixed | Haiku $ | Architect assistance (frontier-written; not in the $ unless stated) |
|---|---|---|---|---|---|---|---|---|
| Retry (re-execution) | 0 (0%) | 0 | 0 | 0 | 0 | 0 of 8 | 0 | none (0 by construction: deterministic programs) |
| Regenerate, ungated (E over recorded peers) | 27.5 (5.8%) | 24 | 3.5 | 279.5 | — | — | 8.07 | the builder kit and templates of the original build arms |
| **Regenerate behind the H-C gate** (E) | **64 (13.5%)** | 24 | 40 | 0 | — | — | 8.07 | + the 13 contracts as gate |
| **Regenerate, best-of-2 behind the gate** (picked by practice contracts) | **128 (26.9%)** | 48 | 80 | 0 | — | 2 of 8 | 16.13 | + the 13 contracts as gate and selector |
| **Heal, contracts (H-C k1)** | **357 (75.2%)** | **276** | **81** | **0** | **11** | **7 of 8** | **1.14** | the 13 contracts ($6.69 lower bound / $19.58 allocated / ≤ $179 whole harness session) + the FAILURES.md renderer (grouping, module owners, order inputs) |
| Heal, N-version (H-N k1) | 54 (11.4%) | 0 | 54 | 0 | 1 | 0 of 8 | 0.60 | the DISAGREEMENTS.md renderer; 9 recorded builds as voters |
| Heal, no verifier (H-0 k1) | 118 (24.8%) | 0 | 118 | 0 | 1 | 0 of 8 | 2.01 | none beyond the task text |

Off the grading block (§10.7, $0): on nine more unseen dev worlds the H-C k1 programs recover **361 of the originals' 463 failing
cases (78.0%), 0 regressions**, 7 of 8 at 995/995. Under the fault battery the heals keep their gains (+506, −10, crash-phase
displacement), and under drift D1 none carries over (0 of 8 changed cases).

Not in the table any more: "heal until clean, 475/475" (§3.4). It was conceived after k1, its k2 order was chosen after k1, and it
acted once; it is a hypothesis for a preregistration (§8 item 4), not a capability number.

### 10.2 M3: regeneration under the same gate

`experiments/fh/posthoc.mjs` applies the H-C replay gate (practice contracts: at least one failing order recovered, none
regressed, no new arm error; checked equal to `heal.mjs gateDecision` by a test) to each recorded same-arm peer as if it were the
incident's regenerated program, then grades it on the 9 grading worlds. The review's numbers reproduce exactly.

| Incident | Peers: gate on practice, grading +/− | Ungated E[net] | Gated E[net] | Best-of-2 by practice (pick) | H-C k1 |
|---|---|---|---|---|---|
| ch-e8-1 | ch-e8-2 reject (7 newly fail), +0/−19; ch-e8-3 reject (36), +30/−118 | −53.5 | 0 | 0 (none accepted) | 48 |
| ch-e8-2 | ch-e8-1 **accept** (7 recovered), +19/−0; ch-e8-3 reject (36), +49/−118 | −25 | 9.5 | 19 (ch-e8-1) | 67 |
| ch-e8-3 | ch-e8-1 reject (10), +118/−30; ch-e8-2 reject (17), +118/−49 | 78.5 | 0 | 0 (none accepted) | 18 |
| cht-e8-1 | cht-e8-2 reject (10), +1/−30; cht-e8-3 reject (28), +1/−84 | −56 | 0 | 0 (none accepted) | 19 |
| cht-e8-2 | cht-e8-1 reject (1), +30/−1; cht-e8-3 reject (18), +0/−54 | −12.5 | 0 | 0 (none accepted) | 48 |
| cht-e8-3 | cht-e8-1 reject (1), +84/−1; cht-e8-2 **accept** (18), +54/−0 | 68.5 | 27 | 54 (cht-e8-2) | 102 |
| b1lh-e8-2 | b1lh-e8-1 **accept** (16), +48/−0; b1lh-e8-3 reject (4), +48/−7 | 44.5 | 24 | 48 (b1lh-e8-1) | 48 |
| b1lh-e8-3 | b1lh-e8-1 **accept** (4), +7/−0; b1lh-e8-2 reject (16), +7/−48 | −17 | 3.5 | 7 (b1lh-e8-1) | 7 |
| **Σ** | 4 of 16 peers accepted | **27.5** (reg 279.5), $8.06 | **64** (reg 0), $8.06 | **128** (reg 0), $16.13 | **357**, $1.14 |

- *Method note (partial disagreement).* The review's best-of-2 took the larger grading net, i.e. it selected with the oracle;
  that is an upper bound, not a baseline. Selected with the gate's own information (more practice orders recovered), best-of-2
  picks the same peers and gives the same 128, so the number stands as a fair baseline.
- The gate keeps regeneration safe but rejects 12 of 16 peers: a fresh build almost always breaks something that worked. The
  two cases where gated regeneration matches heal (`b1lh-e8-2`, `b1lh-e8-3`) are the monolith arm, whose peer `b1lh-e8-1` is
  fully correct.
- Still not fair in one direction: regeneration here is *unconditioned* (a peer build never saw FAILURES.md). A regeneration
  given the failure report is the stronger baseline and needs paid builds (§8 item 4).

### 10.3 M4: the go-live share, per class and per defect

Go-live (classes `gl-*`) is 276 of the 475 failing cases, in 7 of the 8 programs: one requirement (SPEC-E §3.5) that 7 of 9
recorded Haiku builds misread the same way.

| Arm | Net on go-live (276) | Net on the other 199 | Net, all |
|---|---|---|---|
| regenerate, ungated (E) | 24 | 3.5 (1.8%) | 27.5 |
| regenerate behind the gate (E) | 24 | 40 (20.1%) | 64 |
| regenerate, best-of-2 behind the gate | 48 | 80 (40.2%) | 128 |
| H-C k1 | 276 (100%) | 81 (40.7%) | 357 (75.2%) |
| H-N k1 | 0 | 54 (27.1%) | 54 (11.4%) |
| H-0 k1 | 0 | 118 (59.3%) | 118 (24.8%) |

Per failure class (§3.5): H-C k1 recovers 24 of 39 (incident, class) cells, H-0 15, H-N 2. Per defect, a post-hoc grouping
(`posthoc.mjs DEFECTS`; one root cause confirmed at $0, the others by the requirement family PREREG-FH1 §1 names; a test checks
that the grouping partitions every failing cell exactly once):

| Defect | Incident | Failing | H-C k1 | H-N k1 | H-0 k1 |
|---|---|---|---|---|---|
| go-live intake (§3.5) | 7 programs | 276 | **7 of 7 fixed** | 0 | 0 |
| review timing (R2.2) | ch-e8-2 | 19 | fixed | 0 | 0 |
| error classifier reads `code`, not `reason` (d5 rename; confirmed, §4) | ch-e8-3 | 118 | 0 | 0 | **fixed** |
| refund after a cancel during processing | cht-e8-1 | 1 | fixed | 0 | 0 |
| refunds after a cancel (processing, amend) | cht-e8-3 | 54 | fixed | **fixed** | 0 |
| partial reserve (R4.2) | b1lh-e8-3 | 7 | fixed | 0 | 0 |
| **defects fixed** | | 12 (5 not go-live) | **11** (4 of 5) | **1** (1 of 5) | **1** (1 of 5) |

- *Agreement:* the headline is case-weighted and dominated by go-live; the per-incident sign tests count 7 programs that share
  one misreading as 7 independent successes. Restricted to the non-go-live cases, H-C k1 beats ungated regeneration in 6
  incidents and loses 1 (p = 0.125), and beats gated regeneration in 4 and loses none (p = 0.125).
- *Partial disagreement with "off go-live, the no-verifier arm beat the contracts arm":* true case-weighted (118 against 81), but
  H-0's 118 is one defect in one program, the very one H-C k1 missed and H-C k2 then fixed (+136 with go-live). Counted in
  defects, H-C fixes 4 of the 5 non-go-live defects and H-0 1. Both counts are reported; neither alone is the capability.

### 10.4 M5: H2 relabelled

- **What the factor is.** The measured verifier difference is chiefly **recall**: the contracts see 158 of 158 failing practice
  orders, the N-version vote 56 (0 of 92 go-live); precision is 1.000 against 0.609. The two arms also differ in **report
  content**, not only in the verifier: FAILURES.md groups classes, names the owning modules and flags likely common causes;
  DISAGREEMENTS.md shows the majority's behaviour. So H2 measures *verifier plus report*, and its label should have been
  "verification recall (visibility) is the bottleneck". Precision did matter in one incident: in `b1lh-e8-3`, 16 of 20 flags were
  false and the 12 shown (truncation) were all false, so the session never saw the 4 true ones.
- **Largely predetermined.** The ensemble was fixed knowing 7 of 9 voters miss go-live, so the second conjunct ("H-N recovers no
  go-live in ≥ 6 of 7") was nearly certain before any session; and 4 of the 8 "H-C > H-N" are no-signal incidents where H-N
  never ran, so the first conjunct needed little more than H-C recovering something.
- **Where both arms ran a session** (`ch-e8-3`, `cht-e8-1`, `cht-e8-3`, `b1lh-e8-3`): H-C ahead in 4 of 4, exact sign test
  **p = 0.125**. The p = 0.0078 in the verdict table counts the no-signal incidents and should not be quoted.
- *Disagreement with "H-0 (118) > H-N (54) shows a misleading verifier is worse than none":* per incident H-N and H-0 each lead
  once (H-N in `cht-e8-3`, H-0 in `ch-e8-3`) and tie in 6. Each pooled number is one defect; the data do not order the two arms.
- **The test the review asks for** (recall and precision degraded separately, one renderer for every arm) is a paid
  experiment and is §8 item 2. It was not run: the FH-1 cap has $0.385 left, too little for a preregistered K ≥ 2 design.

### 10.5 M6: the verifier's cost

`experiments/fh/architect-cost.mjs` reads the transcript of the Opus 5.5 (effort xhigh) subagent that wrote
`experiments/compose/capabilities.mjs` during COMP-1 (329 calls, 2026-10-21 11:10–18:23Z; it also built the composition runtime,
builder kit, reference, faults, drift and the COMP-1 documents) and prices it at the policy file's list price ($4 / $20 per
MTok; cache reads 0.1×, cache writes 1.25×, 1-hour writes 2×, assumed). The transcript's output-token field holds only the
stream-start value, so output is estimated from the characters written (3.5 per token) and thinking tokens are not counted.
Result (`fh1/architect-cost.json`):

| Bound | $ | What it counts |
|---|---|---|
| lower | **6.69** | every call up to and including the contracts' first write (reading SPEC-E, the bed and the oracle views), plus the file's own output; later validation and tests not counted |
| allocated | **19.58** | the whole session × the contracts' share (14.9%) of all characters the session wrote |
| upper | **179.23** | the whole session at the 1-hour cache-write rate |

| H1 cost conjunct (Σ$ H-C k1 + contracts ≤ Σ E[$] regenerate = $8.06) | H-C + contracts | Holds? | Per program |
|---|---|---|---|
| contracts free (as frozen) | 1.14 | yes | 0.14 |
| lower bound | 7.83 | yes (by $0.23) | 0.98 |
| allocated | 20.72 | **no** → H1 inconclusive | 2.59 |
| upper | 180.37 | no | 22.55 |

The contracts are a family-level asset: COMP-1 used them as a grader and DUR-1 reuses them, so charging all of them to these 8
programs overstates the marginal cost. But a new family would have to pay for its own, which is why the cheap-model-written
verifier (§8 item 6) is the number that decides whether C3 pays in general. The gated regeneration baselines of §10.2 use the same
contracts, so they carry the same uncounted cost.

### 10.6 M2: retry, and the classify → intervene step

- *Agreement:* the E8 programs are model-free code run under `unshare --net` (`beds/ebed/host/sandbox-arm.mjs:70`), so retry is 0
  by construction, and `intervene` in `heal.mjs` is a recorded string that no branch reads. H1b is therefore a statement about H-C,
  not a comparison, and the 10-08 root cause #1 (a flaky target misrouted to the patcher) was not tested by FH-1. The claim is
  restated as *patch → replay beats re-execution on deterministic defects*.
- *Added at $0:* `experiments/fh/ladder.mjs` makes the first two checks of the ROADMAP §2.6 classifier executable (re-execute at
  the same state; a Wilson lower bound on the flip rate above τ = 0.05 → retry, no patch; a deterministic reproduction → patch; a
  workflow verdict that passes what the oracle fails → patch only with an independent verifier; no live re-execution → resample
  first) and replays it on every incident with recorded re-execution evidence:

| Incident | Live re-executions passing | Route | What the loop actually did |
|---|---|---|---|
| H-p1 (10-08) | 8 of 8 | **retry** (Wilson lower 0.676 > 0.05: variance, no patch) | patched; heal tied retry 8/8 vs 8/8 at +15% cost |
| H-rec (10-08) | 0 of 4 | resample to K = 8; flags the blind verifier (own verdict passed 4 of 4) | patched with its own blind verifier; 0 of 16 valid |
| H-cfx (10-08) | none recorded (only strict replays, which always reproduce) | resample first | patched |
| the 8 FH-1 incidents | 0 of 1, identical journals, no model call | patch | patched |

  So the router sends H-p1 to retry, the action that tied the heal at lower cost, and it would have refused to route H-cfx without
  a live re-execution. This is the routing *decision* replayed on recorded evidence; a live test needs variance incidents and
  paid re-executions (§8 item 5).

### 10.7 M1: durability and the hand-written reference ($0)

`experiments/fh/durability.mjs` grades each incident's original build and its kept H-C k1 program on three batteries. It also
grades `ch-e8-3` H-C k2, `ch-e8-3` H-0 k1 and `cht-e8-3` H-N k1, the other kept patches that recovered grading cases. Kept programs
are rebuilt from `patch.json`, and each bundle digest is checked against its attempt's record. No heal session saw any world used
here; the sessions saw only practice 1235–1237. The run was $0, post hoc and development evidence (dev seeds only). Raw results:
`fh1/durability-{seeds,faults,drift}.json`. Tables: `node experiments/fh/durability.mjs --report <faults> <seeds> <drift>`.

**Nine more unseen dev worlds** (E-bed dev seeds 1191–1193 × d2, d3, d5, default size, the shape of the grading block), fault-free,
beside the bed's hand-written reference policy (`beds/ebed/oracle/policy.mjs`, timing `earliest`; it reads world truth, so it is a
ceiling and a yardstick, not a deployable peer). The reference passes 995/995 with 10,938 ticks and 12,913 effects.

| Program | Original | H-C k1 | H-C k1 vs original | Ticks × reference, original → H-C k1 | Effects × reference, original → H-C k1 |
|---|---|---|---|---|---|
| ch-e8-1 | 947/995 (95.2%) | **995/995** | +48 / −0 | 1.01 → 1.04 | 1.12 → 1.16 |
| ch-e8-2 | 935 (94.0%) | **995** | +60 / −0 | 1.14 → 1.18 | 1.12 → 1.16 |
| ch-e8-3 | 875 (87.9%) | 893 (89.7%) | +18 / −0 | 0.91 → 0.93 | 1.21 → 1.23 |
| cht-e8-1 | 977 (98.2%) | **995** | +18 / −0 | 1.17 → 1.19 | 1.14 → 1.16 |
| cht-e8-2 | 947 (95.2%) | **995** | +48 / −0 | 1.25 → 1.29 | 1.12 → 1.16 |
| cht-e8-3 | 880 (88.4%) | **995** | +115 / −0 | 1.16 → 1.30 | 1.10 → 1.16 |
| b1lh-e8-2 | 947 (95.2%) | **995** | +48 / −0 | 1.25 → 1.28 | 1.12 → 1.16 |
| b1lh-e8-3 | 989 (99.4%) | **995** | +6 / −0 | 1.22 → 1.23 | 1.16 → 1.16 |
| **Σ** | 7,497/7,960 (94.2%) | **7,858/7,960 (98.7%)** | **+361 / −0 (78.0% of 463 failing)** | | |
| `ch-e8-3` H-C k2 / H-0 k1; `cht-e8-3` H-N k1 | | 995 / 977 / 947 | +120 / +102 / +67, −0 each | 1.02 / 0.98 / 1.18 | 1.18 / 1.14 / 1.12 |

- **The heals hold on unseen worlds.** On the grading block H-C k1 recovered 75.2% of the failing cases; here it recovers 78.0%,
  with 0 regressions, and the same 7 of 8 programs end fully correct. None of the 11 kept patches graded here regresses a case.
- **Pass rate against the hand-written reference.** 7 of 8 healed programs match it (995/995), against 0 of 8 originals.
- **Effort against the reference.** Every fully correct program emits exactly 14,929 effects, 1.16× the reference's. On 1191 d2
  the entire surplus (102 of 695 effects) is one `fraud.check` and one `inventory.allocate` per placed order. The reference skips
  these lookups because it reads world truth. Every other effect count is identical, so the healed programs do the same work on the
  world, plus the two lookups a real deployment needs. They use 1.02–1.30× the reference's ticks (arm calls). The heal itself
  added 0.4–3.0% ticks per program, and 11.5% for `cht-e8-3`, whose fix adds the refund branch.

**COMP-1 fault battery** (`experiments/compose/faults.mjs`, worlds 1161 d2 s40, 1162 d3 s40 and 1164 d5 s60, 156 completed
cases; 158 under `downstream`, which adds cases). Passed cases are summed over the three worlds.

| Program | Fault-free, original → H-C k1 | Cases lost to the 5 faults (Σ), original → H-C k1 | H-C k1 vs original under faults | Compensation complete | Critical findings |
|---|---|---|---|---|---|
| ch-e8-1 | 139 → 155 | 30 → 30 | +80 / −0 | 320/320 → 320/320 | 2 → 2 |
| ch-e8-2 | 138 → 155 | 94 → 102 | +82 / −5 (all `crash`) | 290/307 → 290/307 | 115 → 129 |
| ch-e8-3 | 140 → 146 (k2 155) | 27 → 27 (k2 28) | +31 / −1 (k2 +73 / −1) | 305/420 → 305/420 (k2 320/320) | 2 → 2 |
| cht-e8-1 | 149 → 155 | 29 → 28 | +32 / −1 | 297/297 → 297/297 | 2 → 2 |
| cht-e8-2 | 139 → 155 | 29 → 29 | +81 / −1 | 297/297 → 297/297 | 2 → 2 |
| cht-e8-3 | 132 → 155 | 27 → 26 | +118 / −0 | **217/297 → 297/297** | **174 → 2** |
| b1lh-e8-2 | 139 → 155 | 23 → 23 | +82 / −2 | 297/297 → 297/297 | 2 → 2 |
| b1lh-e8-3 | 155 → 155 | 24 → 24 | +0 / −0 | 307/307 → 307/307 | 2 → 2 |
| **Σ H-C k1** | 1,131 → 1,231 | 283 → 289 | **+506 / −10** | | |

- **Gains survive restarts and delayed duplicates.** Under `restart` and `dup-delayed` every program, original or healed, passes
  exactly its fault-free count.
- **The heals inherit the originals' fault weaknesses, unchanged.** No heal was asked to fix them, and the contracts and gate never
  ran under faults.
  - Same-instant duplicates (`dup-same`, E8's known MR5 gap, COMP-1 §6.1) cost every program 21 to 26 cases, healed or not.
  - `ch-e8-2`'s crash defect (it fires compensation after its carried state rolls back, COMP-1 §6.2) is untouched: it loses 18,
    18 and 35 cases under `crash`, with 29, 36 and 62 critical findings.
  - The 27 duplicate effects of `ch-e8-1` remain.
  - One improvement came for free: `cht-e8-3`'s refund fix also completes its compensations and removes 172 critical findings.
- **The 10 case-level "regressions" are crash-phase displacement, not new defects (root-caused).** All 10 are under `crash`.
  - `withCrash` crashes every third effectful tick, counted across all instances (`experiments/compose/faults.mjs:58-80`). A healed program
    emits more effectful ticks (the go-live intake), so the same orders are crashed at different ticks.
  - Checked on `cht-e8-1`, 1164 d5: both programs crash `o0016`, `o0022`, `o0038` and `o0042` once each. The original's crash of
    `o0016` falls on a three-effect tick and `o0016` fails; the healed program's crash of `o0016` falls on a one-effect tick three
    minutes earlier and `o0016` passes. The reverse happens for `o0022`. Each program loses 2 cases.
  - The vulnerable paths are a shared defect of the originals. In the 7 programs other than `ch-e8-2`, every case lost to a crash,
    original or healed, is a `decline` or `f6-carrier` order, and the per-world count of crash-lost cases moves by at most 1.
    `ch-e8-2` is the exception: its crash defect now also reaches go-live orders that pass only after the heal (lost 17, 15, 31 →
    18, 18, 35).
- **One shared residual on 1164 d5 (size 60), root-caused: `o0064` (review-approve).**
  - It fails for every program that is otherwise complete there, and for COMP-1's best monoliths (68/69). The reference passes it.
  - It is not a divergence. The grader marks it unfinished, arm-censored (`beds/ebed/oracle/grade.mjs:212`, `:220`, `:223`).
  - What happens: the reviewer's first answer is malformed (`humanTask.answerRejected`). The programs ask again (a second review
    task, which the oracle does not flag), get "approve" at 23:42 and ship. The first parcel's 3,341-minute transit then ends at
    23:41Z on the last day, after the world's 23:00Z horizon.
  - The reference instead lets the review time out at 24 h and cancels, which completes in time.
  - So this is a horizon effect on a path the oracle allows (or a SPEC-E ambiguity about re-asking after a malformed answer),
    not a heal regression. The grading block contains no such case.

**Drift D1** (review-timeout-clears, R2.2; `experiments/compose/drift.mjs`) on 1165 d2 and 1166 d3 (size 30), with no new patch:

| | Original | H-C k1 | Drift-changed cases passing |
|---|---|---|---|
| all 8 programs (Σ over 2 worlds) | 47–59 of 67 each | **59 of 67 each** (= every unchanged case) | **0 of 8, every subject, every arm** |

- **A heal does not carry over to a requirement change it was not built for.** Every subject, in every arm, passes 0 of the 8
  drift-changed cases. The healed programs pass all 59 unchanged cases (the originals 47 to 59). Adapting to drift takes a new heal
  over the changing stream; that is DUR-1's preregistered paid run, not FH-1.

**The owner's A4 ask stays ⚠.** Closed: the heal block (D20) and a code-level patch loop that adds missing behaviour (the go-live
intake). Open, with what would close each:
- *Comparison with a hand-crafted workflow.* E8 has no deployable hand-crafted workflow; its reference policy reads world truth,
  so it is a ceiling for pass rate and a yardstick for effort (above), not a peer. A hand-written E8 program without truth access
  (or a family that has one) is needed for [46]'s "equivalent or more efficient than the human-curated workflow".
- *"Durable state" over a changing stream:* the $0 battery above tests robustness of a fixed program; healing again after a drift
  or a fault-induced failure (Phase 4 exit: "C3 on injected faults") is DUR-1's preregistered paid run, not FH-1.
- *Flaky targets:* routed correctly on recorded evidence (§10.6); untested live.
- *"Add a missing tool":* untested (every FH-1 fix used the tools the program already had).

**Suggested A4 row for the coverage matrix (replaces the one in the build report; the matrix itself is not edited here):**
"⚠ heal unblocked (D20); FH-1 (dev): patch → replay with a frontier-written near-oracle verifier removes 75.2% net (357/475, 0
regressions, 11 of 12 defects, $1.14 Haiku + $6.7–19.6 verifier) vs retry 0, regenerate 5.8% ungated / 13.5% gated / 26.9%
best-of-2 gated ($16.13); 58% of cases are one shared go-live misreading; on 9 unseen dev worlds the heals hold (78.0% of failing cases, 0 regressions, 7 of 8 at the hand-written reference's 100% with 1.02–1.30× its ticks) but inherit the originals' fault weaknesses and do not carry over to drift (0 of 8 changed cases) | open: hand-crafted comparison,
heal after drift/faults (DUR-1), live variance routing, add-a-tool, cheap-model-written verifier (FH-2 dose-response)."

### 10.8 Minor findings

| # | Disposition |
|---|---|
| m1 | Post-hoc heal-until-clean moved out of the capability statements (§0 capability paragraph, §10.1, README, suggested A4 row); §3.3 now says the k2 sample is selected. Its direction: the selection over-represents the one *disagreement* (`ch-e8-3` first; the dropped k2 steps were all on programs k1 had fixed completely), so "4 of 5 identical" is not an agreement rate either way. Preregistration is §8 item 4. |
| m2 | Corrected in the D20 record (§5) and §0: FH-1 does not use the heal kit (`experiments/fh` imports nothing from `experiments/heal`); the unblocked kit pipeline has not run live. The 10-08 incidents through the new loop are §8 item 5. |
| m3 | Renamed an *audited textual check* (D20 record §3), with the read → use flow audited by hand (`runtime.mjs:598` → `context.mjs:67,111-113` and the receipt only). Truncations counted: 0 of 1,820 compiled recorded calls at ≥ 98% of their class budget (largest 67%), besides 0 `CONTEXT_OVERFLOW` (`d20-proof.json`). |
| m4 | `experiments/fh/closure.mjs`: the import closure of the frozen entry points plus the files read at run time is 134 files; FREEZE.json hashed 16 of them and the bed digest covers 28, leaving 90 uncovered (the compose runtime, loader, faults, reference, kit and templates, `beds/lib/{rng,canonical}.mjs`, `beds/ebed/e7/*`, `src/data.mjs`, `src/models/policy.mjs`, the recorded programs). `git diff 38e42fb7 9e2a2b61` over all 134: **no change**, so the runs used exactly the frozen closure (`fh1/FREEZE-CLOSURE.json`, with every sha256). FREEZE.json is unchanged (it is itself frozen); the next preregistration should freeze `closureFiles()`. |
| m5 | New `experiments/fh/test/fh-review.test.mjs` (16 tests): `spent()` and the budget stop (the recorded ledger now refuses any paid session; the test asserts that before it calls), the environment-fault path, `decisions()` at every rule boundary and on the records, leakage over every TASK text, every workspace file, all 18 recorded FAILURES.md and 9 DISAGREEMENTS.md and the renderers on all 8 incidents (grading seeds, grading-world order ids, oracle class names as whole tokens, `firstDivergence`), `compareStrict`, record integrity, the post-hoc gate, the ladder, lean rebuilds, the closure, the cost reader, the durability helpers, and (with `FH_SLOW=1`) a harmful scripted patch rejected by the H-C gate with the original program kept. The frozen `fh.test.mjs` is unchanged. |
| m6 | `compareStrict` counts a case missing after as a regression. Re-run over all 29 graded attempts from `grading-after.json`: **0 missing, 0 extra**, and all 29 agree with their record and with the kept rule (rejected → net 0; accepted → kept = raw). `grade.mjs` is frozen and unchanged; new code uses `compareStrict`. |
| m7 | Reworded in §2 and the verdict table (the digest is a row projection without payloads; retry rests on the exact case comparison). PREREG-FH1 §1.1 keeps its frozen wording. |
| m8 | **Worker B: root cause established, and the original report was wrong.** Worker B did not exit. The FH-1 build agent itself suspended it: at 22:56:44Z it ran `until grep -q "cht-e8-1.H-C.k2: gate" <worker-B log>; do sleep 0.2; done; kill -STOP 24250` (tool description "Pause worker B between steps"; transcript `subagents/workflows/wf_0f86d12b-ab5/agent-ad8e407c8dec607bc.jsonl`, outside the repo). The result at 22:59:20Z shows `24250 TNsl node experiments/fh/heal.mjs --plan …plan-B`, state T (stopped); at 23:09:56Z the process was still listed; no SIGCONT or kill for it appears later in that transcript, so it stayed stopped until the container restart at 02:05Z. The physical traces fit exactly: the STOP landed within the 0.2 s poll after the gate line, after the next step's `mkdirSync` (22:59:19.419Z) and before its FAILURES.md (first written at 02:54Z by the amendment-1 rerun). So §7 item 2 and AMENDMENT-FH1-1 ("exited silently … cause not established") misreported a **manual, undeclared intervention in the plan runner**, which PREREG-FH1 §3 does not allow. Its effect: the two remaining worker-B steps (`cht-e8-2 H-C k2`, `cht-e8-3 H-C k2`) did not run in the first launch; it touched no k1 step, no spend (no session was open) and no decision rule. The likely purpose (holding budget for the k1 arms of workers A and C) is not recorded. Corrections are added to §7 and to the amendment. An OOM kill, ENOSPC and an exception were each excluded first; the earlier search for `pkill`/`kill` missed this because it matched by command name, not by PID. **p1 flake: reproduced and root-caused.** `experiments/heal/heal.mjs buildIncident` now records, for every excluded trial, which fidelity checks diverged and how the replay ended (status, error code), and `p1.test.mjs` prints them. The flake recurred on 2026-11-04, 14:59–15:13Z, at load 20.6 on 4 vCPUs (nice 15): 27 of 35 trials pooled, and the 8 excluded trials all ended `failed` with **`CODE_TIMEOUT`**, diverging in pass, score and verdict (2 also in calls). So the mechanism is the code sandbox's own wall-clock budget (frozen kit `src/sandbox.mjs:166`; 10 s by default, `src/runtime.mjs:683`; 10–30 s on the records-v3 code nodes). A CPU-starved strict replay times a code node out where its record succeeded. It is not the tool timeout or run deadline named as candidates on 10-21, and not a divergence of the evidence. Not fixed here, because each fix changes replay semantics in the frozen kit or in `src/` (which tonight's engine merge touches). The candidates: a strict replay should not time out a code node whose record succeeded on a budget below its recorded duration with a margin; or `buildIncident` should re-run a replay whose only divergence is a timeout once, sequentially, before excluding it. Until then `p1` is load-sensitive above a load of about 20 on 4 vCPUs, and its failure message names the cause. |
| m9 | Negative results added to `docs/RESEARCH.md`. Lean storage: the 29 full program copies (3.3 MB) are replaced by `patch.json` + `patch.diff` against the recorded originals, each verified to rebuild its recorded bundle digest before the copy was removed. *Partial disagreement:* the session transcripts (18.9 MB) stay. They are the raw evidence behind §4's root causes (for example the three sessions that independently wrote they could not see the raw error payload), and AGENTS.md asks to preserve raw failures. History is not rewritten (ROADMAP §6.11), so the removed copies remain at `9e2a2b61`, where DUR-1's preregistration pins them. |
| m10 | README bullet rewritten with both caveats (near-oracle, frontier-written verifier; its uncounted cost) and the gated baseline. |

### 10.9 Tests run for this response

All runs were one file at a time, `nice -n 15 node --test --test-concurrency=1`. The disk was at 96–98% throughout, so every temp
dir went under the session scratchpad and was deleted afterwards.

| File | When (UTC), load on 4 vCPUs | Result |
|---|---|---|
| `experiments/fh/test/fh.test.mjs` (frozen, unchanged) | 11-04 17:35, load 28 | **8/8** |
| `experiments/fh/test/fh-review.test.mjs`, `FH_SLOW=1` | 11-04 17:35–17:46, load 28–38 | **16/16**, including the slow end-to-end test (a harmful scripted patch is rejected by the H-C gate, the original is kept, net 0; 603 s). Its run dir under `fh1/runs/` was removed by the test |
| `experiments/heal/test/kit-gate.test.mjs` (D20 check renamed, truncation count) | 11-04 14:47, load 13.6 | **14/14** |
| `experiments/heal/test/verify.test.mjs` (exercises `buildIncident`) | 11-04 14:47–14:59 | **9/9** |
| `experiments/heal/test/p1.test.mjs` | 11-04 14:59–15:13, load 20.6 | **1/2**: the load-sensitive flake recurred and is now root-caused (`CODE_TIMEOUT`, §10.8 m8). Not re-run: the load stayed at 28–38 for the rest of the session, which would only reproduce it. The 10-22 re-run at load 9–18 passed 2/2 |

- **Durability reproducibility.** The tables in §10.7 are rendered from the stored JSON. The `seeds` part (14:35–15:17Z) loaded
  `durability.mjs` before its last edit (14:49Z), while the `faults` and `drift` parts ran the committed code. So `seeds` was
  re-run with the committed code for two subjects (`cht-e8-3`, `ch-e8-3.H-C.k1`) and the reference (17:49–18:04Z): **27 of 27
  cells identical** (every field but wall time), and the bundle digests match.
- **Lean storage.** Every stored patch rebuilds its recorded bundle digest (the `lean storage` test). The durability runs also
  check the digest of every kept program they rebuild.
