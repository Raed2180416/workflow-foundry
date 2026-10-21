# PREREG-FH1: failure handling on real recurring failures (C3), with verification precision as the factor

| Field | Value |
|---|---|
| Experiment id | FH-1 |
| Claim tested | **C3** (ROADMAP §4.1): "classify → intervene → patch → replay recovers more failures than retry or regeneration at equal budget, with no more regressions" |
| Evidence class | **development** (dev worlds; every incident program and its failures were inspected before this file was written). No sealed or held-out claim follows |
| Pre-registration commit | the commit that adds this file (recorded in `research/heal-20261021/fh1/FREEZE.json` with the sha256 of every frozen file) |
| Date | 2026-10-21 |
| Paid budget | Haiku 5.5 only, **≤ $5 in total** (CLI-reported session cost; an open session counts at its cap) |

## 0. Why this experiment, and what failed before

The owner's brief has always asked for classify → intervene → patch → replay against plain retry and against regeneration. The
first auto-heal (research/heal-20261008/DESIGN.md §B.5–B.6, 2026-10-08) "did not beat retry". The recorded data say why, and each
reason shapes this design:

| Earlier incident | Retry (recorded) | Heal (recorded) | Root cause | What FH-1 changes |
|---|---|---|---|---|
| H-p1 (P1 status read) | 8/8 pass | 8/8 pass (+15% cost) | A **variance** incident (base error about 1 in 36): retry is the right action by the ROADMAP §2.6 ladder itself (resample → variance → no patch). It was **misrouted**: the offline classifier records `"class": "workflow-defect"` with `"variance not tested (needs a live provider)"` (`research/heal-20261008/runs/H-p1.json`), so a flaky target went to the patcher. The heal's mechanism did work (injected error class: parent 0/88, healed 88/88) but the comparison counted was the natural pass rate, at the ceiling | Incidents are **deterministic** defects (every failure reproduces exactly; measured by a second execution, which is also the retry arm), so the ladder routes them to a patch on evidence, and retry's recovery is measured, not assumed |
| H-rec (records date order) | **0/4 oracle pass, while the workflow's own verdict said `pass` 4/4** (`experiments/heal/runs/live-20261008-r4/rec-escalate.json`: base `pass 0, verdictPass 4`) | 0 valid of 16 candidates | **Verification precision zero on the failure**: the workflow's acceptance was existence-only, so the failure was invisible to it, and the patch loop's only correctness signal was the dev oracle at V3; plus **patch scope**: the closed op grammar could not express a per-row guard | The patch loop gets an **executable verifier on practice worlds** (13 capability contracts written from SPEC-E, independent of the grader) and the patch is **code** (the program itself), not a closed op set |
| H-cfx (codefix check) | 0 (a deterministic check: a retry repeats it) | 2 valid fixes (3/3 vs 0/3), **blocked** by governance (lint debt, relax → owner review) | The heal worked; promotion rules, not capability, stopped it | Promotion here is the gate alone (replay on practice worlds under the arm's verifier); no owner step |

So the 10-08 heal "did not beat retry" for three different reasons, one per incident: a flaky target it could not recognise
offline (H-p1), a verifier that could not see the failure plus a patch grammar too narrow to express the fix (H-rec), and a
governance block on a real fix (H-cfx). None of the three is evidence about a precise verifier driving a code-level patch on
deterministic defects; FH-1 is that test.

Today's working hypothesis (AutomationBench verifier-lab, `research/REQUIREMENTS-COVERAGE-20261021.md` row A2: "verification
is the bottleneck") is that **verifier precision, not the patcher, decides whether failure handling pays**. FH-1 therefore holds
the patch mechanism fixed and varies only the verifier.

## 1. Bed, worlds, incidents

- **Bed:** E8 order saga (`beds/ebed/e8`), oracle unchanged (`beds/ebed/e8/index.mjs oracle`). Bed digest (sha256 prefix of every
  `.mjs`/`.md`/`.json` under `beds/ebed/{e8,oracle,host,lib}` except tests): recorded in FREEZE.json (`bedDigest`).
- **Grading worlds** (the grader; no arm ever sees them or their oracle): dev rehearsal block 1232–1234 × d2, d3, d5 (9 worlds,
  1,022 completed cases per program), the denominator of every recorded E8 build.
- **Practice worlds** (what the arms see): 1235 d2, 1236 d3, 1237 d5, disjoint from grading (SEED-LEDGER `ebed-e8-rehearsal`).
- **Incidents** (frozen list; every Haiku-built E8 program with at least one failing grading case): the six COMP-1 composed builds
  `ch-e8-1..3`, `cht-e8-1..3` (2026-10-21) and the two imperfect B1L-H monoliths `b1lh-e8-2`, `b1lh-e8-3` (2026-10-14). Their
  baseline (graded here at $0 by `experiments/fh/baseline.mjs`, before any paid call) is §1.1. `b1lh-e8-1` (1,022/1,022) is not an
  incident; it is a regeneration sample and an N-version voter.
- **Real, recurring failures:** go-live (SPEC-E §3.5) is missed by 7 of the 8 incidents (every composed build and `b1lh-e8-2`);
  the others are one requirement family per build (review timing, the d5 F5 rename, missed refunds, partial reserve).

### 1.1 Baseline ($0, measured before the freeze)

Graded on 2026-10-21 21:27–22:05 UTC by `experiments/fh/baseline.mjs` (two executions per build; bed digest
`b9e5a67138d42a7f`), table by `experiments/fh/baseline-table.mjs`. Every count reproduces COMP-1 and B1-E8-DEV exactly.

| Build | Arm | Build $ | Grading oracle (9 worlds) | Failing cases by class | Grading contracts | Practice oracle (3 worlds) | Practice contract-failing orders | Retry (2nd execution) |
|---|---|---|---|---|---|---|---|---|
| b1lh-e8-1 | B1L-H | 0.39 | 1022/1022 | — | 1001/1001 | 331/331 | 0 | identical journals; +0/−0 |
| b1lh-e8-2 | B1L-H | 0.62 | 974/1022 | gl-intake 18, gl-awaiting 18, gl-dispatched 12 | 953/1001 | 315/331 | 16 | identical journals; +0/−0 |
| b1lh-e8-3 | B1L-H | 0.53 | 1015/1022 | f4-reserve 7 | 994/1001 | 327/331 | 4 | identical journals; +0/−0 |
| ch-e8-1 | C-H | 1.73 | 974/1022 | gl-intake 18, gl-awaiting 18, gl-dispatched 12 | 953/1001 | 315/331 | 16 | identical journals; +0/−0 |
| ch-e8-2 | C-H | 0.53 | 955/1022 | gl-intake 18, gl-awaiting 18, gl-dispatched 12, review-timeout 12, review-approve 4, review-reject 3 | 934/1001 | 308/331 | 23 | identical journals; +0/−0 |
| ch-e8-3 | C-H | 0.86 | 886/1022 | straight 55, gl-intake 18, decline 13, cancel-processing 9, cancel-after-collection 7, f3-refund 5, f6-carrier 5, collection-failed 4, f3-charge 4, cancel-at-collection 3, review-approve 3, f4-reserve 3, amend-then-cancel 2, amend 2, f1-charge 2, action-at-deadline 1 | 865/1001 | 289/331 | 42 | identical journals; +0/−0 |
| cht-e8-1 | C-H-T | 1.70 | 1003/1022 | gl-intake 18, cancel-processing 1 | 982/1001 | 324/331 | 7 | identical journals; +0/−0 |
| cht-e8-2 | C-H-T | 1.12 | 974/1022 | gl-intake 18, gl-awaiting 18, gl-dispatched 12 | 953/1001 | 315/331 | 16 | identical journals; +0/−0 |
| cht-e8-3 | C-H-T | 1.16 | 920/1022 | cancel-processing 46, gl-intake 18, gl-awaiting 18, gl-dispatched 12, amend-then-cancel 8 | 899/1001 | 297/331 | 34 | identical journals; +0/−0 |
| b1nh-e8-2 | B1N-H (repair of b1lh-e8-2) | 0.73 | 1022/1022 | — | 1001/1001 | 331/331 | 0 | identical journals; +0/−0 |
| b1nh-e8-3 | B1N-H (repair of b1lh-e8-3) | 0.58 | 1022/1022 | — | 1001/1001 | 331/331 | 0 | identical journals; +0/−0 |

**Retry (R), measured:** for all 11 builds the second execution produced byte-identical host journals on all 12 worlds, so retry
recovers **0** cases of every incident. Every failure is deterministic; the ladder routes all of them to a patch.

**Regenerate (G), computed from the recorded builds before any paid call** (`experiments/fh/analyse.mjs`, leave-one-out within
the incident's own arm; recovered / regressed are grading cases relative to the incident):

| Incident | Failing | Peer 1 (+/−) | Peer 2 (+/−) | E[net_G] | E[$_G] | P(peer fixes every failing case) |
|---|---|---|---|---|---|---|
| ch-e8-1 | 48 | ch-e8-2 +0/−19 | ch-e8-3 +30/−118 | −53.5 | 0.70 | 0 |
| ch-e8-2 | 67 | ch-e8-1 +19/−0 | ch-e8-3 +49/−118 | −25.0 | 1.30 | 0 |
| ch-e8-3 | 136 | ch-e8-1 +118/−30 | ch-e8-2 +118/−49 | +78.5 | 1.13 | 0 |
| cht-e8-1 | 19 | cht-e8-2 +1/−30 | cht-e8-3 +1/−84 | −56.0 | 1.14 | 0 |
| cht-e8-2 | 48 | cht-e8-1 +30/−1 | cht-e8-3 +0/−54 | −12.5 | 1.43 | 0 |
| cht-e8-3 | 102 | cht-e8-1 +84/−1 | cht-e8-2 +54/−0 | +68.5 | 1.41 | 0 |
| b1lh-e8-2 | 48 | b1lh-e8-1 +48/−0 | b1lh-e8-3 +48/−7 | +44.5 | 0.46 | 1 |
| b1lh-e8-3 | 7 | b1lh-e8-1 +7/−0 | b1lh-e8-2 +7/−48 | −17.0 | 0.51 | 1 |
| **Σ** | **475** | | | **+27.5** (E[regressed] 279.5) | **8.07** | |

**Verifiers on the practice worlds, against the oracle** (analysis only; `verifiers.json`, `experiments/fh/ensemble.mjs`;
an order is flagged by the contracts when it fails any contract, by N-version when the build disagrees with the strict majority
of the nine builds):

| Verifier | Flagged | True positives | Oracle-failing orders | Precision | Recall | Recall on go-live orders |
|---|---|---|---|---|---|---|
| 13 capability contracts | 158 | 158 | 158 | **1.000** | **1.000** | 92/92 |
| N-version (9 builds) | 92 | 56 | 158 | **0.609** | **0.354** | **0/92** |

Per incident, N-version flags nothing at all for `b1lh-e8-2`, `ch-e8-1`, `ch-e8-2` and `cht-e8-2` (their failures are go-live
or review timing, which the majority shares or does not resolve), flags 10 orders of `cht-e8-1` of which 0 fail the oracle, 20 of
`b1lh-e8-3` (4 fail), 44 of `ch-e8-3` (34 fail) and 18 of `cht-e8-3` (18 fail). The contracts flag exactly the failing orders of
every build. So the factor under test is large and measured before any session: one verifier is perfect on these orders, the
other misses two thirds of them, including every go-live order.

## 2. Arms

All heal arms run the same loop (`experiments/fh/heal.mjs healAttempt`) and differ **only in the verifier**:

| Arm | What it is | Verifier the session and the gate use | Cost |
|---|---|---|---|
| **R** retry | the unchanged program executed again on the grading worlds (baseline pass 2) | — | $0 |
| **G** regenerate | a fresh build by the same builder under the same conditions. Estimated, case by case, from the other recorded builds of the incident's own arm (leave-one-out: C-H ↔ C-H, C-H-T ↔ C-H-T, B1L-H ↔ B1L-H), which are independent draws of exactly that procedure; a regeneration ignores the failure by definition, so no conditioning is lost | — | the peers' recorded build cost |
| **H-C** heal, contracts | classify (contracts on practice worlds → failure classes: contract, rule, normalised finding; localised to the modules whose manifest declares the rule) → intervene (the baseline's second run reproduced every failure: workflow defect → L3 patch) → patch (one Haiku session; FAILURES.md; smoke loop that reports the contracts on practice worlds) → replay gate | 13 capability contracts (`experiments/compose/capabilities.mjs`) | session |
| **H-N** heal, N-version | same loop; DISAGREEMENTS.md = the incident's orders whose observable behaviour differs from the strict majority of the 9 recorded builds on the practice worlds (the B1N-H method); ungraded smoke | N-version consensus (oracle-free) | session |
| **H-0** heal, no verifier | same loop; the session is told only that some orders are handled wrongly; ungraded smoke | none | session |

- **Session** (every heal arm): `claude-haiku-5-5` (policy file), effort high, cap **$0.50**, **20 min**, the repo's Claude CLI
  executor (`src/executors/claude-code.mjs`) in its sandbox, tools Bash/Read/Write/Edit/Glob/Grep; the workdir holds SPEC-E.md,
  CONTRACT.md, the API schemas, (composed) COMPOSE.md and the compose kit, the program, TASK.md, the arm's report, `smoke.mjs`.
  No oracle, grading world, truth label or case class anywhere in it (FAILURES.md shows order ids, the order's inputs, the
  contract's finding and the program's own effects). One session per attempt, no revision.
- **The H-N ensemble, stated before any H-N session.** All nine recorded Haiku builds of SPEC-E vote (the incident is one of
  them, as in B1N-H). Seven of the nine miss go-live, so on go-live orders the strict majority is the *wrong* behaviour. This is
  the correlated-error condition B1N-H itself named as its limit ("a misreading shared by two builds would out-vote the right
  behaviour"); with its own three-build ensemble (majority right) B1N-H repaired `b1lh-e8-2` and `b1lh-e8-3` to 1,022/1,022 at
  $0.11 and $0.05 (`research/enterprise-20261014/B1-E8-DEV.md`). FH-1 does not re-test that favourable case; it measures the
  N-version verifier's precision and recall on the practice worlds against the oracle (`verifiers.json`, before the freeze) and
  reports them beside every H-N outcome.
- **Replay gate** (code, practice worlds): reject if the program does not load, adds an arm error, or is unchanged. H-C: accept
  iff ≥ 1 contract-failing practice order now passes and **no** practice order that passed every contract now fails. H-N: accept
  iff ≥ 1 disagreement is settled and none is new. H-0: accept (no correctness signal). A rejected patch leaves the original
  program in place (its outcome is the original's: net 0). Every attempt is also scored under all three gates (analysis only).
- **No signal, no action.** When the arm's verifier reports nothing on the practice worlds (H-N with zero disagreements: today
  `b1lh-e8-2`, `ch-e8-1`, `ch-e8-2`, `cht-e8-2`), the method has nothing to act on and its gate could never accept: no session is
  started, the outcome is net 0 at $0, recorded as `no-signal`. (H-C flags every incident; H-0 has no verifier and always runs.)
- **Grade** ($0): the patched program on the 9 grading worlds under the oracle; recoveries = cases failing before and passing
  after; regressions = the reverse.

## 3. Order, replication, stop rule

`research/heal-20261021/fh1/plan-{A,B,C}.txt` run concurrently (three workers, so the three k1 arms advance together and a
budget or time stop leaves them equally covered), each in file order:

| Worker | Steps |
|---|---|
| A | H-C k1 × 8 incidents, then H-C k2 for `ch-e8-1..3` |
| B | H-N k1 × 8 incidents, then H-C k2 for `cht-e8-1..3` |
| C | H-0 k1 × 8 incidents, then H-C k2 for `b1lh-e8-2`, `b1lh-e8-3` |

Stop rules, checked by code before each step (`experiments/fh/heal.mjs --plan`):
- **Budget:** if (spent + caps of every open session, all workers + $0.50) > **$5.00**, that worker stops.
- **Freeze:** if any frozen file's sha256 or the bed digest differs from `FREEZE.json`, that worker stops.
- **Time:** no step starts after the deadline passed on the command line, set to 6 hours after the first paid step; the steps not
  run are listed and reported as not run.
- A session that ends in a rate or usage limit, an unavailable model or no sandbox (`MODEL_RATE_LIMIT`, `MODEL_UNAVAILABLE`,
  `SANDBOX_UNAVAILABLE`) is an **environment fault**: recorded (`envfault-<n>.json`), not graded as an outcome, rerun once at the end
  of that worker's plan if budget and time remain. Every other ending (the $0.50 cap, the 20-minute timeout, an executor error) is
  an outcome of the arm: the program as the session left it goes through the gate. No other rerun.

Incident order within a phase: `ch-e8-1, ch-e8-2, ch-e8-3, cht-e8-1, cht-e8-2, cht-e8-3, b1lh-e8-2, b1lh-e8-3`.

## 4. Measurements

- **Primary (per incident i):** net(i) = recovered − regressed grading cases of the program the arm ends with. For G, the mean
  over the peers. For heal arms, attempt k1, after the gate ("kept").
- **Capability number (headline, per arm):** Σ net over the 8 incidents ÷ the 475 failing grading cases (the share of the
  real recurring failures the arm removes, net of what it breaks), the incidents brought to 1,022/1,022, and $ per net case.
- **Cost:** CLI-reported session cost (heal); recorded build cost (G); $0 (R).
- **Secondary:** recoveries per $; regressions; raw (ungated) patch outcomes; gate precision and recall per gate (a "good" patch
  recovers ≥ 1 grading case and regresses none); verifier precision and recall on the practice worlds against the oracle
  (`experiments/fh/ensemble.mjs`, analysis only); per-class recoveries (go-live and the rest); H-C k1 vs k2 agreement.

## 5. Decision rules (frozen)

- **H1 (C3 vs regeneration).** *Supported (dev)* if net_HC(i) > net_G(i) for ≥ 6 of 8 incidents **and** Σ regressions_HC ≤ Σ
  E[regressions_G] **and** Σ cost_HC ≤ Σ cost_G. *Refuted* if net_HC(i) < net_G(i) for ≥ 5 of 8, or Σ regressions_HC > Σ
  E[regressions_G]. Otherwise *inconclusive*. The exact two-sided sign test is reported beside it (not part of the rule).
- **H1b (C3 vs retry).** *Supported (dev)* if H-C keeps a patch that recovers ≥ 1 grading case in ≥ 5 of 8 incidents and
  pooled H-C regressions are smaller than pooled recoveries. Retry's recoveries are the measured baseline pass 2.
- **H2 (verification precision is the bottleneck).** *Supported (dev)* if net_HC(i) > net_HN(i) in ≥ 5 of 8 incidents **and**
  H-N recovers no go-live case in ≥ 6 of the 7 go-live incidents (the recorded majority of the ensemble misses go-live, so the
  N-version verifier cannot see it). *Refuted* if net_HN(i) ≥ net_HC(i) in ≥ 5 of 8. Otherwise *inconclusive*. H-0 is
  reported beside it (the no-verifier floor).
- **No K = 1 comparative claim is proof.** Every verdict above is development evidence about these 8 programs.

**Predictions written now** (to be scored, not part of the rules): H-C recovers the go-live class in most incidents; H-N
recovers none of it; G's expected net is negative for the better composed builds; R recovers 0.

## 6. Anti-leakage and integrity

- No arm sees a grading world, the oracle, a truth label or a case class. FAILURES.md is built from the contracts on practice
  worlds only (`contractFailuresText`), DISAGREEMENTS.md from other builds' observable effects on practice worlds.
- The contracts are an independent check written from SPEC-E (HARNESS.md §3), not the oracle; they agree with the oracle at the
  case level on the recorded builds (COMP-1 M2), which is exactly what "a precise verifier" means here.
- Frozen files (sha256 in FREEZE.json, list in `experiments/fh/freeze.mjs` `FROZEN`): this file,
  `experiments/fh/{grade,baseline,heal,analyse,ensemble,freeze,baseline-table}.mjs` and `experiments/fh/test/fh.test.mjs`, the three plan files, the 11 baseline JSONs,
  `ensemble-signatures.json`, `verifiers.json`, `experiments/compose/{capabilities,bundle,build,trace}.mjs`,
  `experiments/tracker/nversion.mjs`, `experiments/ebed/{build,smoke-service}.mjs`, `src/executors/claude-code.mjs`,
  `policy/models.json`, plus the bed digest. Checked before every paid step.
- Model ids only from `policy/models.json`; no fallback; every session journaled (transcript) and every charge in
  `fh1/spend.jsonl`.

## 7. What this cannot show

8 programs of one family (E8), all inspected; one session per attempt (k2 only for H-C); dev worlds. Regeneration is estimated
from 2 peers per incident (recorded builds). Contracts as a verifier are a "the family ships a test suite" condition; a family
without one would have to build or learn its verifier first, which this does not measure.

## 8. Amendments

(none)

## 9. Freeze checklist

1. Baseline graded for all 11 builds (two passes each) and §1.1 filled.
2. Ensemble signatures cached; verifier table computed.
3. $0 dry runs pass: `noop` (gate rejects: unchanged), `swap:b1nh-e8-2` on `b1lh-e8-2` (H-C gate accepts; grading +48/−0),
   `swap:b1lh-e8-2` on `b1lh-e8-3` (H-C gate rejects on practice regressions), `swap:cht-e8-1` on `ch-e8-1` under H-N (the composed
   path: keep, module tests, H-N gate). Measured 2026-10-21 (`runs/*.dry/record.json`): noop → reject "program unchanged", raw
   +0/−0; b1nh swap → **accept** "16 practice orders recovered, 0 regressed", raw **+48/−0**; b1lh-e8-2 swap → **reject** "16
   practice orders newly fail a contract (4 recovered)", raw +7/−48 (the gate kept a net −41 patch out); composed swap (run
   before the no-signal rule existed, so a stub session ran) → H-N reject "no disagreement resolved", raw **+30/−1** exactly as
   the two baselines predict (gl-awaiting 18, gl-dispatched 12; one cancel-processing case lost), module tests 58/58; under the
   H-C gate the same patch is rejected ("1 practice order newly fails a contract (10 recovered)"): the strict no-regression gate
   gives up a net +29 to keep regressions out, by design.
4. `experiments/fh/test/fh.test.mjs` passes (gate, classes, comparison, N-version, sign test, task texts free of grader words).
5. FREEZE.json written (`node experiments/fh/freeze.mjs write`) and committed with this file; then the paid plans start.
