# COMP-1 result: composed versus monolithic construction on E8 (2026-10-21)

- **Evidence grade.** Development: dev worlds, K = 3 builds per arm (the prereg's status rule). No sealed or held-out
  claim follows.
- **Protocol.**
  - Run as frozen in [PREREG-COMP1.md](PREREG-COMP1.md) (commit `7a64b34`), one build at a time.
  - The 16 frozen harness files matched the prereg's sha256 prefixes before the first paid call and again after the
    last build.
  - Model ids came from `policy/models.json`: `claude-opus-5-5` for the templates; `claude-haiku-5-5` at effort high,
    with $3 and 40 minutes, for every build.
  - Dev seeds only: grading 1232–1234, practice 1235–1237, faults 1161/1162/1164, drift 1165/1166.
- **Spend.** $10.77 of the $23 cap (§9).
- **Not committed** by the runner.

## Verdict

| | Rule (verbatim from the prereg) | Measured | Reading |
|---|---|---|---|
| P1 | At least 2 of 3 C-H builds produce a program that loads and passes the interface checks in strict mode | 3 of 3: no manifest problems, 0 violations, 0 trace-integrity failures, 0 arm errors | **held** |
| P2 | Pooled C-H M1 is at least 0.95 (B1L-H mean 0.982) | 2,815/3,066 = **0.918**. Without the load-flagged ch-e8-3: 1,929/2,044 = 0.944 | **missed.** The prereg's reading: "composition costs correctness at equal budget" |
| P3 | M4d: at least one C-H build loses fewer cases than the best monolith ("32 of 43 lost on 1161 d2"). M4e: the median C-H build completes every compensation, where B1L-H lineage 1 leaves 3 of 27 incomplete | M4d on 1161 d2: C-H builds lose 11, 11 and 9 of 43; the best monolith loses 8 (35/43). M4e on 1161 d2: 31/31, 24/27 and 31/31 | M4d **is ambiguous as written** (§6.1): missed against the best monolith the rule names, held against the number it quotes. M4e **held** on 1161 d2. P3 does not enter H-COMP |
| P4 | C-H-T's M1 is at least C-H's, and C-H-T's interface violations are at most C-H's | Pooled M1: 0.945 against 0.918, or 0.945 against 0.944 without the flagged C-H build. Violations: 0 against 0 | **held**; the margin is 0.001 without the flagged build |
| **H-COMP** | Supported if P1 and P2 hold. Refuted if fewer than 2 of 3 C-H builds load, or pooled C-H M1 is below 0.90. Otherwise inconclusive | P1 held; P2 missed; 3 of 3 load; 0.918 ≥ 0.90 | **inconclusive**, with or without the flagged build |

**Reading.** Haiku 5.5 can build a composed E8 workflow that loads and keeps to its declared interface. All six builds had
0 interface violations in strict mode and 0 in audit mode.

At the same budget, correctness falls short of the monolith:

| | Pooled M1 |
|---|---|
| C-H | 0.918 |
| C-H-T | 0.945 |
| Three raw B1L-H builds | 0.982 |
| Repaired lineages | 1.000 |

- Per-build M1 runs from 0.867 to 0.981.
- No composed build reached 1,022/1,022. B1L-H lineage 1 did, without repair.

The failure shape is the one B1-E8-DEV.md found for monoliths: one requirement family missed in every case of it. Go-live
(§3.5) is the common one:
- All six composed builds miss the go-live intake, 18 cases each.
- Four of the six miss all 48 go-live cases.
- One of the three raw monoliths (B1L-H lineage 2) did.

**Under faults** (§6):
- **Restarts.** Every composed build replays identically.
- **Crashes.** All six keep exactly-once, and five lose at most 3 cases. ch-e8-2 collapses: 23/43 on 1161, with 26
  critical (§6.2).
- **Same-instant duplicates.** Every composed build commits some duplicate non-money effects, and no monolith does:
  fulfilment `cancelled` status writes and `cancel-refused` notices.

**Templates.**
- C-H-T's pooled M1 is higher, and its best build (cht-e8-1, 1,003/1,022) is the best composed build.
- Its spread is as wide as C-H's: 0.900 to 0.981.
- cht-e8-3 is the only build with critical failures on the grading worlds: refunds missed after 54 cancels.
- The C-H builds also ran on a busier machine than the C-H-T builds (§4). That weakens the comparison.

## 1. Run log

Times are UTC on 2026-10-21. The window is from the session's start line to its exit line. The exit comes after the
build's own $0 grading of M1, M2 and M3 strict. "Session" is the builder session's wall time.

| Step | Label | Start–exit | $ | Turns | Session | Smoke runs | Mean load | Outcome |
|---|---|---|---|---|---|---|---|---|
| clean-room templates | `tpl-opus-1` | 12:19–12:37 | 3.50 | 15 | 18.1 min | — | 4.9 | templates written; no manifest problems |
| C-H 1 | `ch-e8-1` | 12:37–13:16 | 1.73 | 91 | 35.6 min | 14 | 6.0 | graded |
| C-H 2 | `ch-e8-2` | 13:24–13:48 | 0.53 | 46 | 20.4 min | 3 | 7.3 | graded |
| C-H 3 | `ch-e8-3` | 13:57–14:23 | 0.86 | 53 (50 + 3, §11) | 23.7 min | 2 | 12.7 | graded; **load-flagged** |
| hold | — | 14:23–16:07 | — | — | — | — | — | five-hour window at 0.95; waited for the 16:00 reset |
| C-H-T 1 | `cht-e8-1` | 16:07–16:40 | 1.70 | 85 | 31.2 min | 18 | 2.5 | graded |
| C-H-T 2 | `cht-e8-2` | 16:46–17:13 | 1.12 | 55 | 25.5 min | 5 | 4.2 | graded |
| C-H-T 3 | `cht-e8-3` | 17:18–17:46 | 1.16 | 70 | 24.9 min | 4 | 2.5 | graded; process exit delayed to 18:09 by a leftover smoke worker (§11) |
| M5 patches (6) | `*-d1` | 18:01–18:21 | 0.18 | 10–25 each | 1.7–3.6 min each | 1 each | 11.3–12.6 | §8 |

**The hold.**
- ch-e8-3's last rate-limit event put the account's five-hour window at 0.95 (`allowed_warning`).
- The runner's own session then reached the account's session limit, and the chain resumed after the 16:00 UTC reset.

**No build died on a rate or usage limit.**
- Every build transcript ends in a `success` result.
- Rate-limit statuses were only `allowed` or `allowed_warning`, and `MODEL_RATE_LIMIT` appears nowhere.
- So there was no environment fault to record or rerun, and nothing was discarded.
- The last build left the five-hour window at 0.40. The six M5 patch sessions also ended in `success`, with no rate-limit
  fault.

## 2. Clean-room templates (`tpl-opus-1`)

- **Session.** Opus 5.5: $3.50 of the $5 cap, 15 turns, 18.1 minutes.
- **Workdir.** It held exactly nine files: `TASK.md`, `COMPOSE.md`, `SPEC-E.md` and
  `api/{billing,carrier,fraud,inventory,notify,orders}.schema.json`. The session's own `find . -type f` lists them.
  - There was no oracle, no `CONTRACT.md` and no world in it.
- **What it read** (`runs/tpl-opus-1/files-read.json`, extracted from the transcript).
  - It made no Read-tool calls.
  - Its Bash reads were `cat TASK.md && cat COMPOSE.md`, `cat SPEC-E.md`, a loop over `api/*.json`, and the file
    listing.
  - Nothing was read outside the workdir (`outsideWorkdirOrOracle: []`).
- **Helper scripts.** It wrote two under `/tmp/tpl-opus-1-tools/` inside its sandbox:
  - `gen.mjs` writes `composition.json`;
  - `check.mjs` reads only the template directory.
  - Neither exists on the host.
- **Output.**
  - `DECOMPOSITION.md`, `composition.json` and `parent.mjs`.
  - Nine module skeletons: order-id, intake, fraud, customer-action, order-progress, fulfilment, cancellation, statuses
    and notices.
  - The parent leaves go-live as a stub (`resumeMigration: not implemented`). DECOMPOSITION.md notes that SPEC-E does not
    give the shape of the `migration` payload.
  - The notices table keys a refused cancel's notice by event id (`cancel-refused.<eventId>`). This matters under M4d
    (§6.1).
- **Verdict.** The run is clean-room as preregistered: it never read the oracle.

## 3. Per-build results (M1, M2, M3, paired world)

The grading worlds are 1232–1234 × d2, d3 and d5. Their nine full worlds hold 1,022 completed cases per build, the same
denominator as B1L-H's 0.982. The paired world (1232 d2 size 12, 14 cases) has its own column. Adding it to the pools
changes no reading: C-H 2,850/3,108 = 0.917; C-H-T 2,931/3,108 = 0.943.

Columns:
- **Load > 8**: the share of minute samples above 8 during the session. "FLAG" means more than half.
- **Strict / audit**: interface violations in strict mode, then in audit mode. The strict count includes effects that
  strict mode dropped (none here).
- **Arm errors**: errors the host recorded while running the program.

| Build | Modules | Module tests | Load > 8 | M1 (9 worlds) | Critical | M2, 13 contracts | Paired | Strict / audit | M1 under audit | Arm errors |
|---|---|---|---|---|---|---|---|---|---|---|
| ch-e8-1 | 5: intake, review, window, saga, notice | 23/23 | 0.28 | 974/1,022 (0.953) | 0 | 953/1,001 (0.952) | 11/14 | 0 / 0 | 974/1,022 | 0 |
| ch-e8-2 | 5: intake, review, wait, fulfil, close | 30/30 | 0.43 | 955/1,022 (0.934) | 0 | 934/1,001 (0.933) | 11/14 | 0 / 0 | 955/1,022 | 0 |
| ch-e8-3 | 4: intake, fraud, fulfilment, orderflow | 31/31 | **1.00 (FLAG)** | 886/1,022 (0.867) | 0 | 865/1,001 (0.864) | 13/14 | 0 / 0 | 886/1,022 | 0 |
| cht-e8-1 | 9, the template's | 58/58 | 0.00 | 1,003/1,022 (0.981) | 0 | 982/1,001 (0.981) | 13/14 | 0 / 0 | 1,003/1,022 | 0 |
| cht-e8-2 | 9, the template's | 37/37 | 0.00 | 974/1,022 (0.953) | 0 | 953/1,001 (0.952) | 11/14 | 0 / 0 | 974/1,022 | 0 |
| cht-e8-3 | 9, the template's | 37/37 | 0.00 | 920/1,022 (0.900) | 202 | 899/1,001 (0.898) | 10/14 | 0 / 0 | 920/1,022 | 0 |

**M3.**
- No build tried an undeclared effect or call. Strict and audit modes therefore give identical M1 and M2.
- On these builds, honesty and consequence do not separate, because nothing was attempted outside the declared
  interface.
- The trace re-verification (`decisions.composition` against the journal and the trusted manifest) found 0 integrity
  failures. The trace itself is not graded.

**M2.** It fails as many cases as M1 in every build (M2 counts 1,001 of the 1,022 cases). Contract failures by
capability on the nine worlds (a case can fail several contracts):

| Build | Contracts failed (cases) |
|---|---|
| ch-e8-1 | intake 18, customer-action 18, reservation 25, tracking 30 |
| ch-e8-2 | intake 18, customer-action 18, reservation 25, tracking 30, fraud 19 |
| ch-e8-3 | compensation 118, failure 118, capture 113, cancellation 21, intake 18, reservation 18, tracking 18 |
| cht-e8-1 | intake 18, reservation 18, tracking 18, compensation 1 |
| cht-e8-2 | intake 18, customer-action 18, reservation 25, tracking 30 |
| cht-e8-3 | reservation 79, refund 54, compensation 54, tracking 30, intake 18, customer-action 18 |

## 4. Pooled per arm, with and without the load flag

| Arm | Builds | Pooled M1 | Pooled M2 | Per-build M1 | Strict violations | Paired | $ total (mean) |
|---|---|---|---|---|---|---|---|
| C-H | 3 | **2,815/3,066 (0.918)** | 2,752/3,003 (0.916) | 0.953, 0.934, 0.867 | 0 | 35/42 | 3.12 (1.04) |
| C-H without the flagged ch-e8-3 | 2 | 1,929/2,044 (0.944) | 1,887/2,002 (0.943) | 0.953, 0.934 | 0 | 22/28 | 2.26 (1.13) |
| C-H-T | 3 | **2,897/3,066 (0.945)** | 2,834/3,003 (0.944) | 0.981, 0.953, 0.900 | 0 | 34/42 | 3.97 (1.32), plus $3.50 for the templates |

**The load flag.**
- Only ch-e8-3 is flagged: load was above 8 in 24 of 24 minute samples, with a mean of 12.7.
- With or without it, P2 is missed and H-COMP is inconclusive.

**A confound the flag rule does not capture.**
- The C-H builds ran first (12:37–14:23 UTC) beside other jobs (mean load 6.0, 7.3 and 12.7).
- The C-H-T builds ran later (16:07–17:46 UTC) on a quieter machine (2.5, 4.2 and 2.5).
- The order was fixed by the prereg (C-H first), so arm and time of day are confounded. A slower smoke loop gives a
  builder less feedback in the same 40 minutes.
- Read P4 with that in mind. Its margin without the flagged build is 0.001.

## 5. Raw failures

Every failing completed case is preserved with its first failure in `runs/<label>/result.json`
(`rows[].oracle.failing`). Each run directory also holds:
- the builder transcript (`transcript.jsonl`) and the smoke log (`smoke.jsonl`);
- the files the builder read (`files-read.json`);
- the program as built (`program/`);
- the audit-mode run (`m3-audit.json`) and the fault battery (`m4-faults.json`).

Below, one row per failure signature. The d2, d3 and d5 columns sum over the three seeds; the paired world is extra.

**ch-e8-1**: 48 failing cases, all go-live.

| Case class | First failure | Detail | d2 | d3 | d5 | Total | Paired |
|---|---|---|---|---|---|---|---|
| gl-intake | L3 missed | R1.1 `create` | 3 | 6 | 9 | 18 | 1 |
| gl-awaiting | L3 missed | R3.2 `fst` | 3 | 6 | 9 | 18 | 1 |
| gl-dispatched | L3 missed | R4.4 `fst` | 3 | 3 | 6 | 12 | 1 |

**ch-e8-2**: 67 failing cases.

| Case class | First failure | Detail | d2 | d3 | d5 | Total | Paired |
|---|---|---|---|---|---|---|---|
| gl-intake | L1 decision | `subject` expected, got `null` | 3 | 6 | 9 | 18 | 1 |
| gl-awaiting | L1 decision | `subject` expected, got `null` | 3 | 6 | 9 | 18 | 1 |
| gl-dispatched | L1 decision | `subject` expected, got `null` | 3 | 3 | 6 | 12 | 1 |
| review-timeout | L2 early | `fst` | 0 | 5 | 7 | 12 | 0 |
| review-approve | L2 early | `fst` | 0 | 1 | 3 | 4 | 0 |
| review-reject | L2 early | `fst` | 0 | 2 | 1 | 3 | 0 |

**ch-e8-3**: 136 failing cases.
- 18 are gl-intake: L1 decision, `subject` expected, got `null`. That is 3, 6 and 9 across d2, d3 and d5, plus 1 in the
  paired world.
- 118 are an L2 outside-allowed `inventory.release`, all on d5 (43, 37 and 38 on 1232, 1233 and 1234). They span 15 case
  classes:

  | Case class | Cases |
  |---|---|
  | straight | 55 |
  | decline | 13 |
  | cancel-processing | 9 |
  | cancel-after-collection | 7 |
  | f3-refund | 5 |
  | f6-carrier | 5 |
  | collection-failed | 4 |
  | f3-charge | 4 |
  | cancel-at-collection | 3 |
  | review-approve | 3 |
  | f4-reserve | 3 |
  | amend-then-cancel | 2 |
  | amend | 2 |
  | f1-charge | 2 |
  | action-at-deadline | 1 |

**cht-e8-1**: 19 failing cases.

| Case class | First failure | Detail | d2 | d3 | d5 | Total | Paired |
|---|---|---|---|---|---|---|---|
| gl-intake | L3 missed | R1.1 `create` | 3 | 6 | 9 | 18 | 1 |
| cancel-processing | L2 order | `rf` before `csh` (1234 d2 o0030) | 1 | 0 | 0 | 1 | 0 |

**cht-e8-2**: 48 failing cases, all go-live. These are the same 48 cases with the same signatures as raw B1L-H lineage 2
(B1-E8-DEV.md).

| Case class | First failure | Detail | d2 | d3 | d5 | Total | Paired |
|---|---|---|---|---|---|---|---|
| gl-intake | L3 missed | R1.1 `create` | 3 | 6 | 9 | 18 | 1 |
| gl-awaiting | L3 missed | R3.2 `fst` | 3 | 6 | 9 | 18 | 1 |
| gl-dispatched | L3 missed | R4.4 `fst` | 3 | 3 | 6 | 12 | 1 |

**cht-e8-3**: 102 failing cases.

| Case class | First failure | Detail | d2 | d3 | d5 | Total | Paired |
|---|---|---|---|---|---|---|---|
| cancel-processing | L3 missed | R6.2 `rf` | 10 | 12 | 24 | 46 | 1 |
| gl-intake | L3 missed | R1.1 `create` | 3 | 6 | 9 | 18 | 1 |
| gl-awaiting | L3 missed | R3.2 `fst` | 3 | 6 | 9 | 18 | 1 |
| gl-dispatched | L3 missed | R4.4 `fst` | 3 | 3 | 6 | 12 | 1 |
| amend-then-cancel | L3 missed | R6.2 `rf` | 0 | 1 | 7 | 8 | 0 |

**Mechanisms.** Each is marked as observed in program source or journals, or as inference.

- **Go-live (SPEC-E §3.5), all six builds.** Observed in the source:
  - ch-e8-2 has no `migration` handler at all, so it answers the event with `subject: null`.
  - ch-e8-1, ch-e8-3, cht-e8-1, cht-e8-2 and cht-e8-3 have one, and all five still fail every gl-intake case: R1.1
    `create` is never sent. cht-e8-1, for example, closes the instance when `records['orders.orders']` is empty.
    Inference: these are go-live orders still at intake, which have no order record yet.
  - ch-e8-1, cht-e8-2 and cht-e8-3 also miss the awaiting and dispatched go-live orders.
  - SPEC-E does not give the shape of the `migration` payload; the clean-room template says so and leaves go-live as a
    stub. So the template arm got no help there.
- **ch-e8-2, review-\*** (19 cases, d3 and d5): a fulfilment status (`fst`) is committed before its window opens (L2
  early). Observed in the oracle's first failure; the cause in the program was not traced.
- **ch-e8-3, d5 (118 cases).**
  - Observed: only the d5 worlds rename `billing.charge`'s `amountMinor` to `amount` (fault F5, 2026-03-10 08:36Z on all
    three seeds). Every one of the 118 failures is an `inventory.release` the rules do not allow, committed after that
    instant (the first at 09:25–10:21Z).
  - Inference: after the rename the program treats the charge's rejection as a failed charge and compensates orders
    that should proceed. This is also why its compensation counts are incomplete even without faults on 1164 (§6).
- **cht-e8-3, R6.2 (54 cases).** For a cancel during processing, the refund (`rf`) is never sent: L3 missed, critical.
  These are the only critical failures on the grading worlds in the six builds.
- **cht-e8-1, one case.** A refund committed before the shipment cancel (`rf` before `csh`, L2 order).

## 6. Faults (M4)

The fault battery ran on dev worlds 1161 d2 (size 40), 1162 d3 (40) and 1164 d5 (60), in sandbox, at $0.
- The monolith rows are B1L-H lineage 1 and B1N-H lineages 2 and 3, regraded here with the same battery
  (`runs/m4-monolith-*.json`).
- Raw B1L-H lineages 2 and 3 on 1161 d2 are in HARNESS.md §4.2.

### 6.1 M4d, same-instant duplicate (MR5), reported on its own

Every inbound message is delivered twice in its instant, under a new event id (`<id>~mr5`). Cells show passed/completed,
then (in brackets) the cases lost against the build's own fault-free run.

| Subject | 1161 d2 | 1162 d3 | 1164 d5 | Logical effects committed twice (money) |
|---|---|---|---|---|
| ch-e8-1 | 32/43 (−8) | 36/44 (−3) | 49/69 (−11) | 9, 5, 13 (0). All are fulfilment `cancelled` status writes |
| ch-e8-2 | 32/43 (−8) | 34/44 (−4) | 46/69 (−14) | 4, 3, 9 (0). Status writes, and one `cancel-refused` notice |
| ch-e8-3 | 34/43 (−8) | 38/44 (−4) | 43/69 (−13) | 0, 3, 3 (0). Status writes and `cancel-refused` notices |
| cht-e8-1 | 34/43 (−8) | 38/44 (−4) | 51/69 (−14) | 0, 1, 3 (0). `cancel-refused` notices |
| cht-e8-2 | 32/43 (−8) | 35/44 (−4) | 46/69 (−14) | 0, 1, 3 (0). `cancel-refused` notices |
| cht-e8-3 | 29/43 (−8) | 33/44 (−3) | 45/69 (−14) | 0, 1, 3 (0). `cancel-refused` notices |
| B1L-H l1 | 35/43 (−8) | 41/44 (−3) | 57/69 (−11) | 0 |
| B1N-H l2 | 35/43 (−8) | 41/44 (−3) | 58/69 (−10) | 0 |
| B1N-H l3 | 35/43 (−8) | 41/44 (−3) | 57/69 (−11) | 0 |
| raw B1L-H l2 (HARNESS.md §4.2) | 32/43 (−8) | — | — | 0 |

**What it shows.**
- On 1161 every subject loses exactly 8 cases to the fault, composed or not. E8's known MR5 gap is part of it.
- On 1164 the composed builds lose 11 to 14 cases, against 10 to 11 for the monoliths.
- Only composed builds commit effects twice.
  - All three C-H-T builds commit the same `cancel-refused` duplicates. That fits the template's key
    `cancel-refused.<eventId>` meeting a duplicate with a new event id (inference).
  - The scripted composed reference passes 43/43 here (HARNESS.md §4.2). So the runtime does not force this; the built
    programs' keys do.

**P3 (M4d) as written.**
- The rule is "at least one C-H build loses fewer cases than the best monolith (32 of 43 lost on 1161 d2)". The
  parenthesis matches no monolith.
  - The best monolith passes 35/43 and loses 8.
  - 32/43 is raw B1L-H lineage 2's *pass* count (HARNESS.md §4.2), the worst monolith.
- Three readings:
  - **The comparison the rule names** (fewer than 8 lost): C-H loses 11, 11 and 9, so it is **missed**. Counted
    against each build's own fault-free run, C-H loses 8, 8 and 8 against the monolith's 8, which is also not fewer.
  - **The number it quotes, as written** (fewer than 32 lost): **held** by all three builds.
  - **The number read as a pass count** (32/43, i.e. 11 lost): **held** by ch-e8-3 (9 lost).
- The runner does not pick a reading. P3 is not part of the H-COMP rule, so the H-COMP verdict does not depend on it.

### 6.2 The full battery

Cells show oracle passed/completed. Markers:
- `=` means the journal is identical to the fault-free run.
- `dup n(m)` means n logical effects committed twice, m of them money.
- `comp a/b` means a of b due compensations are complete.
- `crit` counts critical findings.

| Subject | World | None | M4a restart | M4b crash | M4c dup-delayed | M4d dup-same | M4e downstream |
|---|---|---|---|---|---|---|---|
| ch-e8-1 | 1161 | 40/43 | 40/43 = | 39/43 | 40/43 | 32/43, dup 9(0) | 38/42, comp 31/31 |
| ch-e8-1 | 1162 | 39/44 | 39/44 = | 39/44 | 39/44 | 36/44, dup 5(0), crit 2 | 39/46, comp 37/37 |
| ch-e8-1 | 1164 | 60/69 | 60/69 = | 57/69 | 60/69 | 49/69, dup 13(0) | 58/70, comp 47/47 |
| ch-e8-2 | 1161 | 40/43 | 40/43 = | **23/43, comp 9/12, crit 26** | 40/43 | 32/43, dup 4(0) | 37/42, comp 24/27 |
| ch-e8-2 | 1162 | 38/44 | 38/44 = | **23/44, comp 7/10, crit 33** | 38/44 | 34/44, dup 3(0), crit 2 | 38/46, comp 32/34 |
| ch-e8-2 | 1164 | 60/69 | 60/69 = | **29/69, comp 16/19, crit 54** | 60/69 | 46/69, dup 9(0) | 58/70, comp 38/41 |
| ch-e8-3 | 1161 | 42/43 | 42/43 = | 42/43 | 42/43 | 34/43 | 41/42, comp 31/31 |
| ch-e8-3 | 1162 | 42/44 | 42/44 = | 42/44 | 42/44 | 38/44, dup 3(0), crit 2 | 44/46, comp 37/37 |
| ch-e8-3 | 1164 | 56/69, comp 17/37 | 56/69 =, comp 17/37 | 54/69, comp 17/37 | 56/69, comp 17/37 | 43/69, dup 3(0), comp 17/37 | 59/70, comp 42/57 |
| cht-e8-1 | 1161 | 42/43 | 42/43 = | 41/43 | 42/43 | 34/43 | 41/42, comp 24/24 |
| cht-e8-1 | 1162 | 42/44 | 42/44 = | 42/44 | 42/44 | 38/44, dup 1(0), crit 2 | 44/46, comp 29/29 |
| cht-e8-1 | 1164 | 65/69 | 65/69 = | 63/69 | 65/69 (1 arm error) | 51/69, dup 3(0) | 66/70, comp 39/39 |
| cht-e8-2 | 1161 | 40/43 | 40/43 = | 39/43 | 40/43 | 32/43 | 39/42, comp 24/24 |
| cht-e8-2 | 1162 | 39/44 | 39/44 = | 39/44 | 39/44 | 35/44, dup 1(0), crit 2 | 41/46, comp 29/29 |
| cht-e8-2 | 1164 | 60/69 | 60/69 = | 58/69 | 60/69 | 46/69, dup 3(0) | 61/70, comp 39/39 |
| cht-e8-3 | 1161 | 37/43, comp 7/12, crit 12 | 37/43 =, comp 7/12, crit 12 | 37/43, comp 7/12, crit 12 | 37/43, comp 7/12, crit 12 | 29/43, comp 7/12, crit 12 | 35/42, comp 17/24, crit 16 |
| cht-e8-3 | 1162 | 36/44, comp 6/10, crit 8 | 36/44 =, comp 6/10, crit 8 | 36/44, comp 6/10, crit 8 | 36/44, comp 6/10, crit 8 | 33/44, dup 1(0), comp 6/10, crit 8 | 37/46, comp 22/29, crit 14 |
| cht-e8-3 | 1164 | 59/69, comp 16/19, crit 6 | 59/69 =, comp 16/19, crit 6 | 59/69, comp 16/19, crit 6 | 59/69, comp 16/19, crit 6 | 45/69, dup 3(0), comp 16/19, crit 6 | 58/70, comp 33/39, crit 14 |
| B1L-H l1 | 1161 | 43/43 | 43/43 = | 43/43 | 43/43 | 35/43 | 40/42, comp 24/27 |
| B1L-H l1 | 1162 | 44/44 | 44/44 = | 44/44 | 44/44 | 41/44, crit 2 | 44/46, comp 32/34 |
| B1L-H l1 | 1164 | 68/69 | 68/69 = | 67/69 | 68/69 | 57/69 | 66/70, comp 38/41 |
| B1N-H l2 | 1161 | 43/43 | 43/43 = | 43/43 | 43/43 | 35/43 | 42/42, comp 24/24 |
| B1N-H l2 | 1162 | 44/44 | 44/44 = | 44/44 | 44/44 | 41/44, crit 2 | 46/46, comp 29/29 |
| B1N-H l2 | 1164 | 68/69 | 68/69 = | 66/69 | 68/69 | 58/69 | 69/70, comp 39/39 |
| B1N-H l3 | 1161 | 43/43 | 43/43 = | 43/43 | 43/43 | 35/43 | 42/42, comp 27/27 |
| B1N-H l3 | 1162 | 44/44 | 44/44 = | 44/44 | 44/44 | 41/44, crit 2 | 46/46, comp 34/34 |
| B1N-H l3 | 1164 | 68/69 | 68/69 = | 66/69 | 68/69 | 57/69 | 69/70, comp 41/41 |

**M4a, restart** (47 to 119 injected per world). Every build's journal is identical to its fault-free run on all three
worlds, as with the monoliths.

**M4b, crash after apply, with carry rollback and redelivery** (42 to 105 injected per world).
- No build commits a logical effect twice. Five of six lose 0 to 3 cases against their fault-free runs, with no
  critical finding beyond their fault-free ones.
- ch-e8-2 loses 17, 15 and 31 cases, with 26, 33 and 54 critical findings:
  - on 1161, 17 cases commit an `L2 outside-allowed` effect, 3 fail at L1, and 3 compensations are left incomplete;
  - inference from the journal: it fires compensation after its carried state rolls back.
- Monoliths lose 0 to 2 cases.

**M4c, delayed duplicate.** Every build equals its fault-free run. One arm error came up for cht-e8-1 on 1164; the case
count did not change.

**M4e, downstream failure after a side effect (MR11).**
- Complete on all three worlds: ch-e8-1, cht-e8-1, cht-e8-2, and B1N-H lineages 2 and 3.
- ch-e8-2 leaves 3, 2 and 3 compensations incomplete. That is the same counts as B1L-H lineage 1 (24/27, 32/34, 38/41).
- ch-e8-3 is complete on 1161 and 1162 but not on 1164 (42/57). Its d5 defect leaves compensations incomplete even
  without faults (17/37).
- cht-e8-3 is incomplete everywhere, which follows from its missed refunds.
- **P3 (M4e) reading.** On 1161 d2, the world the rule anchors on, the C-H builds complete 31/31, 24/27 and 31/31.
  The median build completes every compensation: **held**.
  - Across all three worlds, only ch-e8-1 completes every compensation everywhere.

## 7. M3 interface (strict and audit)

Covered in §3: 0 violations, 0 drops and 0 integrity failures in strict mode for all six builds, on all ten grading
worlds. The audit mode gives 0 recorded violations, and M1 is identical to strict mode. The fault battery also records
interface violations: 0 in every cell.

## 8. M5 drift D1 (`review-timeout-clears`, R2.2): patch

The patch run is cheap, so M5 was run with a $1 cap per program, per the run instruction. The driver is
`experiments/compose/patch-drift.mjs`, written after the freeze (§11). It imports the frozen modules unchanged.

Each patch session gets:
- the builder's own program;
- the drifted SPEC-E;
- the changed passages, before and after;
- the same CONTRACT, COMPOSE, API and kit files;
- the smoke loop on drifted practice worlds 1235–1237.

There is no grading in the loop. Afterwards, at $0:
- patch locality: which files and modules changed, against the modules that declare R2.2;
- the module tests;
- the patched and unpatched programs on drifted dev worlds 1165 d2 and 1166 d3 (size 30). The drift converts 4 cases per
  world.

| Program | Patch $ | Turns | Session | Code changed | Comment-only changes | R2.2 owner in the manifest | Manifest changed | Module tests after | Changed cases pass: after (before) | Drifted M1 on 1165 d2 + 1166 d3: after (before) | Other cases changed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ch-e8-1 | 0.019 | 10 | 1.7 min | parent | — | review | no | 23/23 | 8/8 (0/8) | 59/67 (51/67) | 0 |
| ch-e8-2 | 0.031 | 20 | 2.8 min | parent, review | — | review | no | 31/31 (+1) | 8/8 (0/8) | 59/67 (51/67) | 0 |
| ch-e8-3 | 0.033 | 15 | 2.7 min | fraud | orderflow | fraud | no | 32/32 (+1) | 8/8 (0/8) | 64/67 (56/67) | 0 |
| cht-e8-1 | 0.024 | 18 | 2.3 min | fraud | parent | fraud | no | 59/59 (+1) | 8/8 (0/8) | 64/67 (56/67) | 0 |
| cht-e8-2 | 0.046 | 23 | 3.6 min | fraud | — | fraud | yes: fraud's declared outputs | 39/39 (+2) | 8/8 (0/8) | 59/67 (51/67) | 0 |
| cht-e8-3 | 0.030 | 25 (23 + 2, §11) | 2.5 min | fraud | parent | fraud | yes: fraud's declared outputs | 38/38 (+1) | 8/8 (0/8) | 55/67 (47/67) | 0 |

Columns:
- **Code changed / comment-only**: from a diff of `runs/<p>/program` against `runs/<p>-d1/program`.
  `patchLocality` in `result.json` counts comment-only edits as changes. So it reports ch-e8-3 as non-local (the
  orderflow comment), and cht-e8-1 and cht-e8-3 as touching the parent.
- **Manifest changed**: cht-e8-2 and cht-e8-3 dropped the `fraud-review-timeout` reason from fraud's declared outputs.
- **Other cases changed**: (pass after − pass before) − (changed cases newly passing). 0 means the patch moved only the 8
  drift-changed cases. The cases still failing on the drifted worlds are each build's existing defects.

**M5 reading.**
- **Pass.** All six programs pass all 8 drift-changed cases after one patch session, and change no other case.
- **Cost.** $0.02–0.05 per patch, 1.7–3.6 minutes, one smoke run each; $0.18 for all six. For comparison, the B1N-H
  repairs cost $0.05–0.11 each.
- **Which modules changed.**
  - ch-e8-3 and all three C-H-T programs confined the code change to the module the manifest names for R2.2 (fraud).
  - The template puts R2.2 wholly in fraud, and the three C-H-T patches followed it.
  - ch-e8-1's review module only reports the timeout; its parent decides to cancel. So its patch changed only the
    parent, outside the owner module.
  - ch-e8-2 changed both its parent and its review module.
- **Limits.**
  - This run has no monolith drift row, and the prereg asked for none.
  - Eight changed cases on two dev worlds is small.
  - Other jobs kept the load at 11–13 during the patches.
  - The driver was written after the freeze (§11).

## 9. M6 cost and wall time

| Item | Prereg estimate | Cap | Spent |
|---|---|---|---|
| Clean-room templates | $1–3 | $5 | $3.50 |
| C-H builds (3) | about $2–5 | $9 | $3.12 ($0.53–1.73) |
| C-H-T builds (3) | as C-H | $9 | $3.97 ($1.12–1.70) |
| M5 patches (6) | not estimated | $1 each | $0.18 ($0.019–0.046) |
| **Total** | | **$23** | **$10.77** |

- **Builder sessions.** C-H took 20.4–35.6 minutes; C-H-T took 24.9–31.2 minutes.
- **B1L-H builds.** They cost $0.39–0.62 (mean $0.51) and took 18.8–24.3 minutes (B1-E8-DEV.md).
- **Per build, then:**
  - A composed build cost 2–2.6× a monolithic one: C-H mean $1.04, C-H-T mean $1.32, plus the one-off $3.50
    templates.
  - It took about 1.3× the session time: means of 26.6 and 27.2 minutes, against 21.1.
  - It wrote 4–9 modules and 23–58 module tests.
- **Running a built program** costs $0. The nine grading worlds and the battery run in seconds to minutes per world.

## 10. Comparison with the monolith rows

All rows use the same SPEC-E and contract text, and the same Haiku 5.5 builder conditions (except the agent rows).
Monolith M1 and M2 were regraded here at $0 (`runs/m2-monolith-*.json`); M1 equals the recorded values.

| Row | What it is | M1, 9 grading worlds | M2, 13 contracts | Paired 1232 d2 s12 | Build or run $ | Source |
|---|---|---|---|---|---|---|
| B1L-H lineage 1 | monolith, smoke loop | 1,022/1,022 | 1,001/1,001 | 14/14 | $0.39 | B1-E8-DEV.md |
| B1L-H lineage 2 (raw) | monolith, before repair | 974/1,022 (0.953) | 953/1,001 | 11/14 | $0.62 | B1-E8-DEV.md |
| B1L-H lineage 3 (raw) | monolith, before repair | 1,015/1,022 (0.993) | 994/1,001 | 14/14 | $0.53 | B1-E8-DEV.md |
| **B1L-H, lineages 1–3 pooled** | the prereg's 0.982 | **3,011/3,066 (0.982)** | 2,948/3,003 (0.982) | 39/42 | $1.54 | |
| B1N-H lineage 2 | lineage 2 after N-version repair | 1,022/1,022 | 1,001/1,001 | 14/14 | $0.62 + $0.11 | B1-E8-DEV.md |
| B1N-H lineage 3 | lineage 3 after N-version repair | 1,022/1,022 | 1,001/1,001 | 14/14 | $0.53 + $0.05 | B1-E8-DEV.md |
| agent-H | Haiku agent per case-tick, no workflow | not run: a full world exceeds the 2-hour job limit | — | 10/14 (27 invalid outputs) | $1.45 for this one world | B1-E8-DEV.md |
| agent-H + V | agent-H plus a contract validator | not run | — | 12/14 | $1.85 metered | AGENTV-E8-PREREG.md |
| **C-H, pooled** | composed; Haiku chooses the decomposition | **2,815/3,066 (0.918)** | 2,752/3,003 (0.916) | 35/42 (11, 11, 13) | $3.12 | this file |
| **C-H-T, pooled** | composed from clean-room Opus templates | **2,897/3,066 (0.945)** | 2,834/3,003 (0.944) | 34/42 (13, 11, 10) | $3.97 + $3.50 | this file |

**What the comparison says.**
- **Against the raw monolith builds** (same builder, same budget, same loop), composition costs correctness:
  - 0.918 and 0.945, against 0.982;
  - 2 of 3 raw monolith builds were at 0.993 or better; none of the six composed builds was (the best is 0.981).
- **Against the agent arms**, on the 14 paired cases:
  - The composed builds score 10–13, against agent-H's 10/14 and agent-H + V's 12/14.
  - They are built once and then run at $0, against $1.45–1.85 per world for the agent arms.
- **Against the repaired monoliths**, which score 14/14 and 1,022/1,022 each, no composed build is close.
- **Under faults**, composition did not help:
  - Restart and delayed duplicates are neutral.
  - Crashes hurt one composed build badly.
  - Same-instant duplicates cost the composed builds as many cases as the monoliths, or more, and only the composed
    builds commit duplicates.
  - Compensation after a downstream failure is complete in 3 of 6 composed builds, against 2 of 3 monoliths.
- **The interface checks** gave nothing to catch: 0 violations in all six builds. The value of declared effects and
  strict mode is untested by these builders (HARNESS.md §5.2 shows they catch planted mis-compositions).

## 11. Deviations and notes

1. **`patch-drift.mjs` was added after the freeze.**
   - It is the M5 driver and is not one of the 16 frozen files. It changes none of them; it imports them unchanged.
   - M5 carries no prediction in the prereg.
   - Its $0 grading path was checked on an unchanged program before the first paid patch.
2. **ch-e8-3 and the cht-e8-3 patch each have two result events.**
   - ch-e8-3's builder session ended (50 turns, $0.807), then resumed for 3 turns after a background smoke task
     finished. `result.json` records the last segment's turn count (3); the table shows the total, 53. Its cost ($0.857)
     is cumulative and within the cap.
   - The cht-e8-3 patch session did the same: 23 turns, then 2 more. Its $0.030 is cumulative.
3. **ch-e8-3 is load-flagged** under the prereg's rule. It is reported with and without; no reading changes.
4. **The P3 parenthesis** ("32 of 43 lost") does not describe the best monolith (§6.1). All readings are reported, and
   none is chosen.
5. **The M4 monolith rows** are B1L-H lineage 1 and B1N-H lineages 2 and 3, the prereg's comparator rows.
   - Their battery was run here with the frozen fault harness (`runs/m4-monolith-*.json`).
   - The raw B1L-H lineage 2 and 3 battery on 1161 d2 is the HARNESS.md §4.2 table (`runs/faults-b1lh-e8-{1,2,3}.json`).
6. **Load sampling.** `/proc/loadavg` (1-minute average) every 60 seconds into `runs/<label>/load.log`. The share is over
   the samples inside each builder session's wall time. Other jobs ran on the same 4 CPUs throughout.
7. **The machine and the account were shared**, with SOP-Bench phase 2 and a sealed benchmark run. No build overlapped
   another build, and grading ran between builds. The one exception: a $0 check of the M5 driver's grading path (one
   drift world, about a minute) ran at 17:20, during cht-e8-3's first minutes, at load below 4. Other jobs pushed the
   load to about 12–13 during the M5 patches.
8. **A leftover smoke worker in cht-e8-3.**
   - A fifth smoke run started at 17:39:32 and was still in flight when the builder's session ended (about 17:43).
     The builder never saw its result. `smokeRuns` counts the 4 completed runs.
   - Its sandbox worker (`arm-worker.mjs`) stayed alive and idle (77 s of CPU in all). That kept `build.mjs` from exiting
     after it had written `result.json` and its summary (17:46).
   - The runner stopped the worker at 18:09, and `build.mjs` then exited 0.
   - Scoring is unaffected: grading runs after the session, on fresh sandboxes.
   - The frozen smoke service does not stop an in-flight run when the session ends. That is a hygiene gap, not a fairness
     one, and it is left unpatched as the run rules require.

## 12. Files

All paths are under `research/composition-20261021/runs/`.

- `tpl-opus-1/`: the clean-room templates, the transcript, `files-read.json` and `result.json`.
- `{ch,cht}-e8-{1,2,3}/`, one directory per build, holding:
  - `result.json` (M1, M2, M3 strict, the build record, every failing case);
  - `m3-audit.json` and `m4-faults.json`;
  - `program/`, `transcript.jsonl`, `smoke.jsonl`, `files-read.json` and `load.log`.
  - No builder read anything outside its workdir (`outsideWorkdirOrOracle: []` for all six).
- `{ch,cht}-e8-{1,2,3}-d1/`: M5 patch sessions (`result.json`, the patched `program/`, the transcript, the smoke log,
  `files-read.json` and `load.log`). No patch session read anything outside its workdir.
- `m2-monolith-*.json` and `m4-monolith-*.json`: the monolith rows regraded at $0.
- Analysis scripts are in the runner's scratchpad (not committed). They are `analyze.py` (tables, reading rules, load
  flags), `failures2.py` (failure tables) and `audit-transcript.py` (files read).
