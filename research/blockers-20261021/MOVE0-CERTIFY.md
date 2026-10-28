# Move 0: one certification library, and every re-scored verdict (2026-10-22)

**Scope.** ATTACK.md §6 Move 0 and decision D28 (4)–(6): build `experiments/lib/certify.mjs` on `experiments/lib/stats.mjs`,
port the shrinkray gauntlet with its tests, add the reporting rule (ceiling column, n_eff, every node's effort /
temperature / cap, an error for a paid run with effort unset), then re-score at $0 what ATTACK lists: the E8 extraction
samples at unit level against null baselines, heal H-p1 / H-cfx / H-rec and FH-1, the M1 need negatives, and the dev60
headlines with the ceiling column.

**Evidence class.** Development/diagnostic throughout. Every number below is re-derived today from stored records, read-only,
through the new library; spend $0, no model call. Tags: **[obs]** re-derived today from stored records by
`experiments/certify/rescore.mjs`; **[carried]** a count another note measured, re-bounded here; **[code]** a property of the
library shown by its tests. No look-2/look-3, devCheck or test task or grade, and no sealed bed, was read: dev60 runs are
read through a run-id allowlist, and every row must be a task of the dev60 draw. Keep this file out of every harness,
verifier and model context (it carries the ceiling column, like VERIFIER-LAB.md).

**Outputs.** `research/blockers-20261021/move0/{e8-units,heal,need-m1,dev60}.json` (each lists the sha256 of every input it
read) and `move0/dev60-ceiling-strata.json` (the hard/soft defect strata, task names only, from VERIFIER-LAB §2).

---

## 0. Verdicts in ten lines

1. **Library built, 89 tests, all with teeth** (§1). CP(0/59) = 0.0495 ≤ 0.05 < CP(0/58) = 0.0503; the one-sided Wilson bound
   would certify at 58 (0.0446). The NP umbrella violates α in 3.4% of 2,000 replicates, the naive quantile in 56.7%;
   Learn-then-Test 2.1% vs naive 37.1% (δ = 0.1) [code].
2. **E8 extraction, unit level:** no stored model sample beats the $0 cue regex with significance (Haiku s0 68 vs 62 gold
   units, McNemar p = 0.36; s1 70 vs 62, p = 0.18); Sonnet is significantly worse than the regex (p ≤ 3·10⁻⁴). The best
   recall at $0 needs no model at all: the structural prior (zone ∪ cue) reaches 80/83 [0.898, 0.993] [obs].
3. **The paid gleaning pass buys precision, not recall:** it ties the $0 coverage-list baseline at best (80/83 vs 80/83) and
   loses 1–3 gold units elsewhere; precision 0.77–0.81 vs 0.70 [obs].
4. **The sibling-sentence credit is real and removed:** unit scoring drops U11 (the go-live anchor) from Haiku s0, which span
   scoring counts [obs].
5. **Heal, 10-08:** H-p1's control is non-evidential (0/8 vs 0/8 failures; the base never failed); its mechanism is certified
   on the injected class only (88/88, correction rate ≥ 0.961). H-cfx is accepted only in deterministic mode and only for the
   Opus candidate (3/3 replays, 0/8 regressions, 0/16 mutants, fresh failing stratum 0/2 → 2/2, CP [0.158, 1]); Sonnet's is
   rejected (3/16 mutants), Haiku's inconclusive (no fresh discrimination). H-rec is rejected, and its own verdict is an
   invalid evaluator (pass 8/8, oracle 0/8; false-accept rate ≥ 0.69) [obs].
6. **Heal, FH-1:** H-C k1 certifies **7 of 8** incidents [0.47, 0.997]; the eighth (`ch-e8-3`) is a partial fix (practice 6/42,
   grading 18/136), healed by its k2 session (5 of 5 k2 accepted). H-0's own gate accepted 8 of 8; certification accepts 0 of
   8. The 475 failing cases are worth n_eff 21.6 (24 of 39 incident × class cells fully recovered, ICC 1.0) [obs].
7. **Need, M1 negatives:** ICC 0.790; the 61 one-call tasks are worth **6.3–7.1** independent negatives: zero false triggers
   there bounds the rate only below 0.34–0.38; the NP umbrella refuses (n_min 59 for α 5%, 299 for 1%) [obs].
8. **dev60 with the ceiling column:** best arm m3-a1c 29/60 strict = **29/53 reachable (54.7% [40.4, 68.4])**, 29/49
   conservative; no arm passes a hard-defect task; union of the six arms 40/53 reachable [obs].
9. **The six dev60 arms are worth 2.12 effective arms** (mean pairwise φ 0.365; 2.31 on the reachable 53) [obs]; m3-a1c vs
   sonnet-a1 is 8 vs 7 discordant tasks, p = 1.0.
10. **Every dev60 arm is non-conforming under D28 (4):** effort unset on every node of every run (Mercury reasoning effort
    too), temperature unrecorded; the table marks them `NON-CONFORMING (legacy)`. A new paid run in that state throws [obs, code].

---

## 1. The library

| File | What | Tests |
|---|---|---|
| `experiments/lib/certify.mjs` (new) | Clopper–Pearson and Wilson (one- or two-sided); zero-failure bound; NP umbrella `npMinN`, `npUmbrellaRank`, `npUmbrella` (Tong, Feng & Li, Sci Adv 2018); exact hypergeometric and binomial elusion bounds, `elusionCertificate`, `elusionAuditPlan`, the random-selection null `selectionNullP`; Learn-then-Test `hoeffdingBentkusP`, `fwerControl`, `learnThenTest` (MAPIE 1.6.0 parity); `sequentialLook` (O'Brien–Fleming / Pocock from the shared core); exact truncated SPRT operating characteristics; Kish `effectiveN`; `signTest`; three-valued `certifyHeal` (deterministic / stochastic / mechanism); `verifierValidity`; reporting `manifestFromLaunch`, `checkManifest`, `headlineRow`, `headlineTable`, `EffortMissingError`; re-exports the build-level tests | `certify.test.mjs` 20 |
| `experiments/lib/gauntlet.mjs` (new) | faithful port of shrinkray `src/shrinkray/nondeterminism.py`: Wilson bound, Bonferroni anchor z (AS241 inverse normal), gauntlet and threshold, confirmation bar, `NondeterminismPolicy` (monotone anchor, evidence ledger, incumbent monitor, `minHits = min(12, minHits + 1)` per observed false accept), exact operating points | `gauntlet.test.mjs` 46 (45 upstream + 1 teeth block) |
| `experiments/lib/stats.mjs` (group-sequential core), `stats-builds.mjs`, `experiments/jit/stats.mjs` (re-export) | O'Brien–Fleming / Pocock boundaries by numerical integration, mixture e-value, paired permutation, paired Bayes intervals, exact McNemar; build-level exact permutation, Welch and posterior build intervals, the case-pooled test (reported, never decided on) | `stats-sequential.test.mjs` 7, `stats-builds.test.mjs` 9 |
| `experiments/certify/rescore.mjs` (new) | the four $0 re-scores of §2–§5 | `rescore.test.mjs` 7 |

**The sequential code is the existing one.** `stats.mjs`'s group-sequential section, `stats-builds.mjs` and their tests are
byte-identical to branch `worktree-wf_630f3979-599-4` (commit `2df949cb`, the D23 stats branch; `git diff` empty), brought in
with `git checkout` so `sequentialLook` uses the frozen plan's own boundaries. That branch's `experiments/agentv/run.mjs` and
`experiments/autobench/sequential.mjs` (pinned by PREREG-OT0-AMEND-1 and SEQUENTIAL-PLAN-v1) are **not** brought in, so its
later merge stays as D23 scheduled it and conflicts nowhere here. No frozen file is touched: none of the five live
experiments' pins (FREEZE-p2, PREREG-OT0 + AMEND-1, the A1-C v1/v2 manifests, requirement-ledger-v2, PREREG-VL1) names a
file this branch changes. One side effect to record: PREREG-NEED-V1's `stages.json` engine stamp hashes the whole
`experiments/lib` tree, so a future need-router label stage must re-stamp (the label factory is on ATTACK §8's stop list).

**Gauntlet source.** https://github.com/DRMacIver/shrinkray, MIT (Copyright © 2023 David R. MacIver; licence text kept in
`gauntlet.mjs`), commit `5fe6ee135d732e4b7758b3dbe3d91428523018fb` (HEAD of `main`, verified with `git ls-remote` on
2026-10-22), `src/shrinkray/nondeterminism.py` (355 lines, sha256 `c73ac190…f5ec2a`) and `tests/test_nondeterminism.py`
(45 test functions, sha256 `27374578…1464`), fetched by pinned raw URL as inert files, nothing installed or executed. All 45
upstream tests are ported under their upstream names; Hypothesis properties become seeded sampling (3,000 draws plus the
edge cases); a 46th block runs the reference operating points against deliberately broken variants.

**MAPIE parity.** MAPIE v1.6.0 = commit `f1cc3d07460b2d7198f557d40d60cd563c51822b` (`git ls-remote`, 2026-10-22); the PyPI
wheel `mapie-1.6.0-py3-none-any.whl` (sha256 `6bb6b217…1dfb`) was unpacked as inert source and
`mapie/risk_control/methods.py::compute_hoeffding_bentkus_p_value` and `fwer_control.py` were read. The port matches the
formula (`p = min(exp(−n·h1(min(r̂, α), α)), c·BinomCDF(⌈n·r̂⌉; n, α))`, c = e, or 1 for binary losses); 11 reference
values were recomputed in exact rational arithmetic in Python (MAPIE not executed, no numpy/scipy) and agree to 1e-9
relative. Bonferroni, Holm step-down and fixed-sequence follow MAPIE's FWER rules, including its reversal of a decreasing
risk curve. BSD-3-Clause; no MAPIE code is copied.

**Teeth.** Every test block runs a broken variant through the same check and requires it to fail [code]:
- Clopper–Pearson's minimum coverage on an exhaustive n = 20 grid is 0.958; Wilson's dips to 0.905.
- the hypergeometric elusion bound covers exactly; a point estimate does not;
- the deterministic heal mode rejects the V3 one-run rule's acceptance without fresh discrimination;
- a manifest adapter that fills in the CLI default effort passes a record the real adapter rejects;
- the build-level permutation says "cannot resolve at K = 3 vs 3" where the case-pooled test claims p < 10⁻⁶.

Mutation check (scratchpad scripts `m0-mutate.sh`, `m0-mutate-rescore.sh`): 8 of 8 mutants of `certify.mjs` and 6 of 6 of
`rescore.mjs` make their suites fail; the originals are restored byte-for-byte.

**Reporting rule (D28 (4)).** `headlineRow` refuses a headline without the reachable-subset column or without a launch
manifest; `checkManifest` throws `EffortMissingError` for a paid run with any model node whose effort is unset, unless the
caller marks it `legacy` (a historical run), which prints `NON-CONFORMING`. `manifestFromLaunch` reads the repo's launch and
summary records (`model`, `effort`, `temperature`, per-session budget, `harness.nodeModels` and per-node overrides, or a
`session` record) and infers nothing: an unset effort stays unset, never "medium".

---

## 2. E8 requirement extraction at unit level [obs]

Units are the tracker's own sentences (`experiments/tracker/ledger.mjs` `sentencesOf`, the segmentation the coverage guard
and the coverage-list baseline use): **163 units** on frozen SPEC-E 48535bb (sha256 `c013c04c…`; platform 62, rules 87,
readings 11, reference 3). Gold units: the unit holding each of the 76 clause anchors and 15 U anchors of `gold.json` (all
located): **83 units**. A ledger selects every unit one of its located quotes overlaps. Interval: two-sided 95% CP on unit
recall. "vs random": hypergeometric P(a random pick of the same size hits at least as many gold units). "Audit": the
probability that a simple random sample of 30 units from the design's excluded pool lets the exact hypergeometric elusion
certificate claim recall ≥ 0.9 at 95% (the no-gold certification route).

| Design | $ | Selected | Gold hit | Unit recall [95% CP] | Precision | vs random | Audit: P(certify ≥ 0.9) | vs cue regex (ledger-only / regex-only, McNemar p) |
|---|---|---|---|---|---|---|---|---|
| all units | 0 | 163 | 83/83 | 1.000 [0.957, 1] | 0.509 | 1 | — | |
| cue regex (guard `CUES`) | 0 | 94 | 62/83 | 0.747 [0.640, 0.836] | 0.660 | 6·10⁻⁶ | 0.000 | |
| zone prior (§4, §5) | 0 | 98 | 72/83 | 0.867 [0.775, 0.932] | 0.735 | <10⁻⁶ | 0.007 | |
| **zone prior ∪ cue regex** | **0** | 127 | **80/83** | **0.964 [0.898, 0.993]** | 0.630 | <10⁻⁶ | **1.000** | |
| Haiku s0 | 0.0116 | 78 | 68/83 | 0.819 [0.720, 0.895] | 0.872 | <10⁻⁶ | 0.001 | 18 / 12, p = 0.36 |
| Haiku s1 | 0.0113 | 80 | 70/83 | 0.843 [0.747, 0.914] | 0.875 | <10⁻⁶ | 0.002 | 18 / 10, p = 0.18 |
| Haiku s2 (transport failure) | 0.0115 | 1 | 0/83 | 0 | 0 | 1 | 0 | 0 / 62 |
| Sonnet s0 / s1 / s2 | 0.046–0.073 | 40–41 | 36 / 40 / 35 | 0.42–0.48 | 0.88–0.98 | <10⁻⁶ | 0 | 4–7 / 29–31, p ≤ 3·10⁻⁴ |
| union Haiku s0–s2 (K = 3, one view) | 0.035 | 90 | 77/83 | 0.928 [0.849, 0.973] | 0.856 | <10⁻⁶ | 0.036 | |
| union of all six samples | 0.21 | 93 | 77/83 | 0.928 | 0.828 | <10⁻⁶ | 0.180 | |
| coverage-list baseline s0 / s1 ($0 second pass) | +0 | 115 / 114 | 80 / 80 | 0.964 [0.898, 0.993] | 0.70 | <10⁻⁶ | 0.77 / 0.78 | 18 / 0 |
| coverage-list baseline s2 | +0 | 94 | 62/83 | 0.747 | 0.660 | 6·10⁻⁶ | 0 | 0 / 0 |
| glean s0 g0 / g1 / g2 (paid second pass) | +0.003 | 100–104 | 79 / 80 / 79 | 0.952–0.964 | 0.77–0.79 | <10⁻⁶ | 0.33–0.49 | 18 / 0–1 |
| glean s1 g0 | +0.003 | 100 | 80/83 | 0.964 | 0.800 | <10⁻⁶ | 0.54 | 18 / 0 |
| glean s2 g0 | +0.003 | 73 | 59/83 | 0.711 [0.601, 0.805] | 0.808 | <10⁻⁶ | 0 | 0 / 3 |

**Re-scored verdicts.**
- **E-1. Model extraction vs the $0 null.** Haiku's single samples are not distinguishable from the guard's own cue regex on
  unit recall (p 0.36 and 0.18); they win on precision (0.87 vs 0.66). Sonnet is worse than the regex. The original
  report's id-level "0.77 / 0.93" compares the model with nothing.
- **E-2. The structural prior is the recall baseline to beat.** Zone ∪ cue reaches 80/83 with no model call; its three
  misses are platform sentences with no cue word (U07, U08, U09), the zone where a model judgement is needed. The K = 3
  same-view union (77/83) stays below it.
- **E-3. Gleaning: precision, not recall.** On the same base sample the paid pass ties the $0 coverage-list baseline (s0 g1,
  s1 g0: 80 vs 80) or loses 1 (s0 g0, g2) or 3 (s2) gold units. Its value is the 0.70 → 0.77–0.81 precision gain.
- **E-4. Scorer defect removed.** Haiku s0 has 12/15 U statements by span and 11/15 by unit: U11 (the go-live anchor) is
  credited by span only, through a sibling sentence. Haiku s2's single entry is credited U02 the same way.
- **E-5. Certifying recall without gold.** Only designs whose excluded pool is small and nearly clean can be certified by an
  elusion audit of 30 units: zone ∪ cue with probability 1.00, the coverage-list baselines about 0.78, gleaning 0.33–0.54,
  any single sample ≤ 0.002. Every stored ledger misses one gold unit (S4a, a readings sentence with no cue word); the zone
  prior reaches it.
- **Caveats.** One spec; gold anchors written by the analyst, with no platform clause list (the sweep's M5 gold holes), so
  "gold units" understate the normative platform sentences. Units cluster by section, so the intervals are per-unit, not
  per-independent-requirement. SPEC-E is in-sample for the gleaning prompt.

---

## 3. Heal through `certifyHeal` [obs]

### 3.1 The 2026-10-08 incidents (stored records under `experiments/heal/runs/`; no kit loaded, nothing replayed)

| Incident | Record | Mode | Certificate | 10-08 decision |
|---|---|---|---|---|
| H-p1 | retry control `live-20261008-r4/p1-retry.json`: base 8/8 pass, healed v3 8/8 | stochastic | **inconclusive, non-evidential**: the base never failed in 8 runs (failure-rate upper bound 0.32); no patch effect is measurable | promoted v3 |
| H-p1 | `review-20261008/p1-mechanism.json`: 88 injected faults over 35 trials, parent wrong 88/88, healed right 88/88 | mechanism | **accept (mechanism only)**: n_eff 75.8 (Kish, ICC floor 0.1), correction rate ≥ 0.961; says nothing about the natural rate | — |
| H-p1 | what sampling would cost | exact truncated SPRT, 0.5% (healed) vs 1/36 (unhealed), α = β = 0.05 | E[runs] 192 if healed, 130 if not: certification by sampling is infeasible at agent prices; the route is mechanism + post-promotion monitoring | — |
| H-cfx | Opus candidate (`live-20261008-r4`, `p-a3336190-r4`) | deterministic | **accept**: 11/11 journal replays identical, 3/3 failing replays fixed, 0/8 regressions, 0/16 mutants, fresh stratum with the defect 0/2 → 2/2 (CP [0.158, 1], stated, not a rate claim) | blocked (lint debt) |
| H-cfx | Haiku candidate (`-r3`, `p-dfd855f4-r2`) | deterministic | **inconclusive**: fresh check unstratified, 4/4 pass on base and candidate: no fresh discrimination | blocked |
| H-cfx | Sonnet candidate (`-r2`, `p-4e3456da-r3`) | deterministic | **reject**: 3 of 16 mutants violated (crashes where a function becomes a class) | blocked |
| H-cfx | any candidate read as stochastic | stochastic | inconclusive (base unconfirmed: 3 reproductions < the confirmation bar's 4): accepted **only** in deterministic mode | — |
| H-rec | `rec-escalate.json`: own verdict pass 4/4 and oracle 0/4 on base and on escalation | `verifierValidity` | **invalid evaluator**: false-accept rate ≥ 0.69 (one-sided 95%, 8/8 verdicts wrong) | — |
| H-rec | 16 proposer rounds over 4 runs | deterministic (4/4 base scores identical) | **reject**: 8 reached the replay and each still failed; 3 invalid ops, 3 literal leaks, 1 lint, 1 pending never produced a candidate | exhausted |
| H-rec | escalation to class L as a candidate | stochastic | **reject**: still reproduces 4/4 | — |

These are the outcomes SR-3 predicted (H-p1 non-evidential, H-cfx accepted only in deterministic mode, H-rec rejected).
SR-3's further check, "at least 5 of 6 archived decisions reproduced", needs the frozen kit's replay and is not done here
(heal replays stay blocked; §7).

### 3.2 FH-1 (branch `worktree-wf_0f86d12b-ab5-2` at `9e2a2b61`, read with `git show`, never checked out)

Mapping (code: `fh1Evidence`): determinism = the incident's retry produced byte-identical journals on all 12 worlds;
failing replays = the practice worlds' oracle-failing orders the patcher could see (fixed = net oracle gain there);
regressions = grading cases that passed before; fresh = each failure class on the 9 grading worlds (never shown to the
patcher) as a failing stratum. Every FH-1 session records model `claude-haiku-5-5`, effort `high`, cap $0.50: conforming.

| Arm | Attempts | Certified heals (accept) [95% CP] | Own gate accepted | Notes |
|---|---|---|---|---|
| H-C k1 (contracts verifier) | 8 | **7** [0.473, 0.997] | 8 | `ch-e8-3`: reject, failing case still fails (practice 6/42, grading 18/136, 0 regressions) |
| H-C k2 | 5 | **5** [0.478, 1] | 5 | includes `ch-e8-3`: 42/42 practice, 136/136 grading |
| H-N k1 (N-version verifier) | 8 | 0 [0, 0.369] | 1 | 4 no session (no disagreement), 3 unchanged, `cht-e8-3` partial (18/34, 54/102) |
| H-0 k1 (no verifier) | 8 | 0 [0, 0.369] | **8** | gate is "loads; no new arm error"; `ch-e8-3` partial (36/42, 118/136) |
| H-C, heal again while the verifier still fails (post hoc, ≤ 2 sessions) | 8 incidents | 8 [0.631, 1] | 8 | k1 for 7, k2 for `ch-e8-3` |
| two k2 attempts | — | no record | — | environment faults in the closed usage window |

**Verdicts.** FH-1's C3 claim survives certification as "7 of 8 incidents healed by one H-C session, deterministic mode, 0
regressions" (8 of 8 under the post-hoc policy, which stays a hypothesis). Its "357/475 cases (75.2%)" is not 475
independent units: case outcomes are identical within an incident × class cell (ICC 1.0), so the cases are worth **n_eff
21.6**; the cell-level statement is 24 of 39 cells fully recovered (61.5% [44.6, 76.6]), the other 15 untouched. The own-gate
column is the reason for D28's rule: H-0's gate accepted every attempt and certification accepts none.

---

## 4. Need router: the M1 negatives [obs, carried]

`research/need-router-20261014/runs/{m1,m1-d5}/results.jsonl`: 144 tasks in 12 family × difficulty cells of 12; a task is a
negative ("one call suffices") if any one-call arm passed it: **61 negatives in 7 cells** (sizes 12, 12, 12, 12, 7, 4, 2).

| Quantity | Value |
|---|---|
| ICC of the one-call outcome across cells (ANOVA) | 0.790 |
| n_eff, nominal cell size 12 (design effect 9.69) | 6.29 |
| n_eff, Kish with the actual negative cluster sizes | 7.12 |
| one-sided 95% upper bound on the false-trigger rate after 0 false triggers at n_eff 6.3 / 7.1 | 0.379 / 0.343 |
| NP umbrella n_min (α 5%, δ 5%) / (α 1%, δ 5%) | 59 / 299: **refused** at n_eff ≈ 7 |

**Second population [carried]:** the need-router sweep's 351 SWE-rebench issues, one per repo (counts measured 2026-10-21,
re-bounded here, one-sided 95% CP): keyword router (any cue) 191/351 = 54.4% [≥ 49.9%]; hard cues only 20/351 = 5.7% (≤ 8.2%);
size ≥ 30K tokens 0/351 (≤ 0.85%, vacuous: issue statements are short by construction). At n = 351 the umbrella can certify
α = 1% at δ = 5% only with its largest order statistic (k* = 351): "trigger iff the score exceeds every negative".

**Verdict.** The M1 negatives are diagnostic only: zero false triggers on them bounds the rate below 34–38%, not below 1%.
A C7c never-trigger claim needs ≥ 59 (α 5%) or ≥ 299 (α 1%) independent negatives from a population declared before the run.

---

## 5. dev60 headlines with the ceiling column [obs]

Draw: devTrain, subset 60, seed 21 (the run summaries' own selection). Rows merge each arm's main run with its fill run (a
fill row replaces the non-outcome it re-ran). Reachable subset: dev60 minus the 7 hard benchmark defects (53 tasks);
conservative: minus the 4 soft defects too (49). n_eff = 60 for one arm: k = 1 per task, tasks are the independent unit and
the domain strata are fixed by design (no cluster inflation). Cost: Claude list dollars of the rows used; Mercury tokens are
separate. Development evidence only; A1-C is in-sample on dev60.

| Arm | Strict (95% CP) | Reachable subset (ceiling column) | Conservative | $ / task | $ / success | Nodes (model@effort / T / per-session cap) |
|---|---|---|---|---|---|---|
| haiku-a0 | 9/60 = 15.0% [7.1, 26.6] | 9/53 = 17.0% [8.1, 29.8] | 9/49 = 18.4% | 0.0132 | 0.088 | session: haiku@UNSET/T?/$0.75 |
| sonnet-a0 | 20/60 = 33.3% [21.7, 46.7] | 20/53 = 37.7% [24.8, 52.1] | 20/49 = 40.8% | 0.1006 | 0.302 | session: sonnet@UNSET/T?/$1.50 |
| haiku-a1 | 18/60 = 30.0% [18.8, 43.2] | 18/53 = 34.0% [21.5, 48.3] | 18/49 = 36.7% | 0.0157 | 0.052 | session: haiku@UNSET/T?/$0.75 |
| sonnet-a1 | 28/60 = 46.7% [33.7, 60.0] | 28/53 = 52.8% [38.6, 66.7] | 28/49 = 57.1% | 0.1153 | 0.247 | session: sonnet@UNSET/T?/$1.50 |
| haiku-a1c | 20/60 = 33.3% [21.7, 46.7] | 20/53 = 37.7% [24.8, 52.1] | 20/49 = 40.8% | 0.0371 | 0.111 | 6 haiku nodes @UNSET/T?/$0.75 |
| **m3-a1c** | **29/60 = 48.3% [35.2, 61.6]** | **29/53 = 54.7% [40.4, 68.4]** | 29/49 = 59.2% | 0.0155 + Mercury | 0.032 | ledger, checker: mercury-3@UNSET (100K tokens/call, 300K/session, 3M and 2.3M/run); 4 haiku nodes @UNSET/T?/$0.75 |
| union of the six (oracle selection) | 40/60 | 40/53 | — | — | — | — |

Every row is `NON-CONFORMING (legacy: pre-D28 dev run, effort unset in the launch record)`: no launch or summary record of
any arm records an effort, and none records a temperature. The full machine-written table, with the run ids and every
record's caps, is `move0/dev60.json` (`table`, `arms[].efforts`).

- **Arms are not independent evidence:** mean pairwise φ 0.365 over the 60 tasks gives Kish **n_eff 2.12 of 6 arms** (φ 0.32,
  2.31 on the reachable 53), reproducing ATTACK's 2.1 / 2.3.
- **Paired, best arm against each (exact McNemar; identical on the reachable subset):** haiku-a0 23/3 (p 0.0001), sonnet-a0
  15/6 (0.078), haiku-a1 17/6 (0.035), sonnet-a1 8/7 (1.0), haiku-a1c 13/4 (0.049, in-sample).
- **The bar, read with the column:** the best cheap arm is at 55% of what the benchmark lets any agent reach on this draw,
  and an oracle selector over the six would reach 40/53 (75%). Claims stay with looks 2–3 and the sealed rerun (D28 (4)).

**COMP-1 at build level (re-scored by `stats-builds.test.mjs` (e), same library) [obs].** C-H builds 1–3 against B1L-H
lineages 1–3 on 1,022 cases each: exact build-level permutation "cannot resolve at K = 3 vs 3", Welch and posterior
intervals of the difference both span 0 (estimate 2815/3066 − 3011/3066 = −0.064), where the case-pooled test claims
p < 10⁻⁶. The monolith 14/14 × 3 against agent-H 10/14 × 1: cannot resolve at K = 3 vs 1.

---

## 6. Amendment drafts for the owner and the tracks (dated 2026-10-22; not filed in any frozen file)

ATTACK §6 makes these the condition for the next paid comparison. Each goes in its own new amendment file, by the owning
track, before that comparison.

1. **PREREG-AB-v1 (D28 (1), (4)).** Add the per-obligation verdict SUPPORTED / FAILED / UNKNOWN, release only with no FAILED,
   and report coverage (share released) and release precision beside strict pass. Every headline carries the
   reachable-subset column (from a ceiling audit of that look, done after its grades are read and kept out of every model
   context), n_eff, and each node's effort, temperature and cap from the launch manifest; a paid launch with an unset effort
   is refused (`checkManifest`). The frozen look-2 runs and SEQUENTIAL-PLAN-v1 are unchanged: the amendment governs analyses
   and launches after it.
2. **PREREG-NEED-V1 deviation C7c (D28 (6)).** Never-trigger bound P[false-trigger rate > α] ≤ δ via `npUmbrella` on a
   negative population declared before the run, counted in independent clusters (`effectiveN`); claim grade needs
   n_eff ≥ 59 for α 5% or ≥ 299 for α 1%; the M1 negatives (n_eff 6.3–7.1) are diagnostic only.
3. **PREREG-COMP1 (build-level M1).** The decision unit is the build: `buildPermutationTest` and `buildDifferenceInterval`
   decide; case-pooled tests are descriptive only; the next comparison is sized from `stats-builds.mjs`'s power and MDE
   (K = 3 vs 3 cannot resolve).
4. **Heal (D28 (5)).** A heal claim names its `certifyHeal` mode and certificate; one-run V3 passes and own-gate accepts are
   not evidence; a rare stochastic defect is certified by mechanism injection plus post-promotion monitoring.

---

## 7. What is left, and why

- **Heal wiring into the kit.** `experiments/heal/{verify,promote}.mjs` belong to the frozen kit (D20); certification sits
  beside it, not in it. Heal replays stay blocked until the owner decides the kit question (D28 (5), ATTACK §9.6), now that
  the gauntlet exists. SR-3's "≥ 5 of 6 archived decisions reproduced" needs that replay.
- **H-cfx retry control** (≈ $0.7) was never run; it needs a paid, preregistered step.
- **E8 gold has no platform clauses** (sweep M5): unit recall understates the platform zone. gold-v2 at unit level belongs to
  the extraction / Move 5 track.
- **Second need population re-run.** The 351-issue counts are carried from the sweep (its data sit in a scratch directory);
  C7c needs a population declared before the run.
- **Selection pools with the ceiling column.** VERIFIER-LAB's P2 + R3 (34/60) picks are scratch artefacts, not repo records;
  VL-1's own analysis should emit them through `headlineRow`.
- **Amendments** (§6) are drafts; filing them is the owning tracks' and the owner's step.

## 8. Reproduce ($0)

```
nice -n 15 node --test --test-concurrency=1 experiments/lib/gauntlet.test.mjs        # 46
nice -n 15 node --test --test-concurrency=1 experiments/lib/certify.test.mjs         # 20
nice -n 15 node --test --test-concurrency=1 experiments/lib/stats-sequential.test.mjs  # 7
nice -n 15 node --test --test-concurrency=1 experiments/lib/stats-builds.test.mjs    # 9 (about 50 s)
nice -n 15 node --test --test-concurrency=1 experiments/certify/rescore.test.mjs     # 7
node experiments/certify/rescore.mjs all   # writes move0/*.json; FH-1 via --fh1-ref worktree-wf_0f86d12b-ab5-2 (default) or --fh1-dir
```

The dev60 re-score reads the m3-a1c main run from `/var/tmp/foundry-work/autobench/m3-a1c-dev60-dn` (`--autobench-root`);
every other input is in the repo, and each output lists the sha256 of what it read.
