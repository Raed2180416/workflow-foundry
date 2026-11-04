# Moves 3, 4 and 6 in the verifier lab: the three-valued verdict, the free-label lab, the information-path budget (2026-11-04)

**Scope.** ATTACK.md §6 Moves 3, 4 and 6 at $0, on top of Move 0 (`experiments/lib/certify.mjs`, merged from branch
`worktree-wf_bba577b8-b58-1` @ `d3bd7acf`). Move 3: a pure SUPPORTED / FAILED / UNKNOWN function per obligation over the
stored checks and RL2 outputs, the release rule, lexicographic selection, risk–coverage leave-one-task-out with n_eff,
certified through certify.mjs. Move 4: trajectory mutants and world twins of the officially passing stored worlds,
labelled by the official AutomationBench rubric, with each verifier's Spearman validity against mutation severity. Move 6:
κ and n_eff for every stored signal pair, the effort cost model, and the information-path budget rule as a function.

**Evidence class: development / diagnostic, $0.** Every number comes from stored dev60 rows (devTrain, subset 60, seed 21,
k = 1 per arm), from the frozen verifiers recomputed on them without a model call, and from 1,510 replays through the
official environment and rubric. RL2 was designed on folds 0–2 (folds 3–4 held out); A1-C is in-sample on dev60; VERIFIER-LAB's
pool P2 was found by looking. Nothing here is a claim (D28 (4)). No look-2/look-3, devCheck, test or sealed task, run or grade
was read: rows come through a dev60 run-id allowlist (`mutlab/labio.mjs`), and no file of VL-1, A1-C v1/v2, RL2,
FREEZE-p2 or PREREG-OT0 changed (all new code is in new files). Model calls: 0. Spend: $0.

**Hygiene.** Keep this file out of every harness, verifier and model context (it carries the ceiling column and per-class
failure rates). Only generic mechanisms are in code: the mutation operators act on HTTP method, URL, JSON shape, e-mail
addresses, numbers and free text; no task name, grader string or ceiling note appears in any new source or output file
(checked by `mutlab.test.mjs` and a scan of the four result files). Grader assertion texts were never written anywhere: the
replay driver reduces each grade to counts per generic class.

**Outputs.** `research/blockers-20261021/move346/{tristate,mutlab,kappa,effort-cost}.json` (each lists the sha256 of what it
read; counts and rates only).

---

## 0. Verdicts in twelve lines

1. **Fidelity first.** The frozen RL2 check phase recomputed from stored extractions reproduces all 542 stored check rows
   exactly; rule R1 on P2 reproduces VERIFIER-LAB's 33/60; 124 of 124 stored passing call logs replay to an official pass.
2. **Three-valued release on today's checks holds almost everything.** Fully SUPPORTED runs: 2 of 360 (RL2 + code-checks,
   T1). UNKNOWN is 1,438 soft + 1,320 judged-only + 673 unexplained-effect obligations, 0 unobservable. ATTACK's look-1 bar
   (precision ≥ 0.80 at coverage ≥ 25%) is **refuted** on dev60: at 24.4% coverage precision is 0.614.
3. **ATTACK's kill clause does not fire; its dependency does.** UNKNOWN is not dominated by unobservable kinds, so the fix is
   not read-back (Move 2) but establishing and code-deciding obligations: Move 1 (Δ*) is the prerequisite of Move 3.
4. **FAILED is informative, release-on-no-FAILED is not enough.** FAILED rows pass 16.8% (base 34.4%); "no FAILED" releases
   175 of 360 at precision 0.531. Of m3-a1c's 11 false "all checks pass", 4 become FAILED and 7 UNKNOWN, 0 stay SUPPORTED.
5. **Nothing certifies at this n.** Learn-then-Test leave-one-task-out (Holm, δ 0.1, n_eff) certifies no threshold for any
   task at α 0.2, 0.35 or 0.5, under every source and policy: the honest output is abstention.
6. **The mutation lab is the wrong calibration distribution.** The threshold it certifies (α 0.2: release on no FAILED,
   lab risk 0.125, upper 0.178) has risk **0.469** on the real stored rows (upper 0.580): 3.7× the lab's.
7. **Selection by (FAILED, SUPPORTED, UNKNOWN) works without a judge:** P2 34/60 (+5/−0, sign p 0.063), held-out folds 15/24
   (+2/−0), **34/53 reachable** [49.8, 76.9]; R1 33, R0 29; VERIFIER-LAB's R3 reached 34 (+6/−1) with the paid Haiku judge.
8. **The official grader is blind to most edits a user would object to:** duplicates pass 96%, one-digit figure changes 82%,
   an extra write on an untouched record 76%, an emptied text field 32%.
9. **Severity validity holds; class validity fails.** Spearman of verifier badness vs official severity: RL2 0.71 [0.65,
   0.77], tri-state 0.74 [0.68, 0.79], code-checks 0.36, readers 0.60–0.69. But the lab's per-class miss ordering does not
   predict the real false-accept ordering (ρ −0.09 to 0.09 for RL2 / code-checks / tri; pooled 0.35 < 0.5): **ATTACK's
   Move 4 kill rule fires for thresholds** (labels must come from looks); the lab stays a regression and sensitivity bench.
10. **Closure recall is zero for every verifier:** a copy of a record the run acted on is flagged 0 of 58 times (RL2); permute,
    decoy and rename twins flip no verifier (0 of 228). Over-action and duplicates are invisible to merged RL2 (0/6, 0/94).
11. **κ budget:** forks 2.12 effective of 6; RL2 readers 1.51 of 3; judges 2.07 of 4 (Haiku–Sonnet error κ 0.64); RL2–Haiku
    judge error κ 0.23. The admission rule (error κ ≤ 0.4) admits RL2 + Haiku judge and refuses more judges and readers.
12. **Effort:** every dev60 arm but Opus ran with effort UNSET; the only measured dose (Haiku reader, reasoning low → medium)
    costs ×1.22 [1.03, 1.49]; any other projection is refused as unmeasured. Recorded CLI output tokens are not an effort
    signal (79–174 per task recorded where the cost implies up to ~15K).

---

## 1. What was built

| File (all new) | What | Tests |
|---|---|---|
| `experiments/autobench/verifier/tristate/verdict.mjs` | `obligationStatus`, `verdictOf` (closed world: an unexplained effect is UNKNOWN), `releasedAt`, lexicographic `select`; policies T1, T2, T0, TJ fixed before any result, T3 added after and marked post hoc | `tristate.test.mjs` 10 |
| `…/tristate/adapters.mjs` | RL2 check phase recomputed from stored extractions (`rl2Ledgers`, `rl2Check` with per-effect explanation), obligations from RL2, code-checks (a veto), the A1-C own checks (self-report), per-reader verdicts | (same) |
| `…/tristate/riskcov.mjs` | curve, `chooseTheta` (Learn-then-Test from certify.mjs on n_eff), `loto`, `rowSummary` | (same) |
| `…/tristate/run.mjs` | the Move 3 analysis over stored outputs → `move346/tristate.json` | |
| `…/mutlab/mutate.mjs`, `twins.mjs` | 10 trajectory operators and 4 world twins, pure and generic | `mutlab.test.mjs` 9 |
| `…/mutlab/replay_batch.py`, `replay.sh` | batch replay in AutomationBench's venv through `bridge.py`'s own Rollout (imported, unchanged) with id carry-forward; grades reduced to class counts | (python helpers tested) |
| `…/mutlab/labio.mjs`, `jobs.mjs`, `verify.mjs`, `score.mjs` | allowlisted lab access, job builder, $0 verifiers on every replay, scoring → `move346/mutlab.json` | (same) |
| `…/kappa/tables.mjs` | κ / n_eff tables, admission walk, budget → `move346/kappa.json` | |
| `experiments/lib/infopath.mjs` | the reusable budget rule: `cohenKappa`, `pairStats`, `clusterBootstrap`, `neffOfSet`, `admitSignal`, `budgetPaths` | `infopath.test.mjs` 6 |
| `experiments/certify/effort-cost.mjs` | per-arm cost at the recorded effort, the measured dose, `projectCost` that refuses unmeasured doses → `move346/effort-cost.json` | `effort-cost.test.mjs` 4 |

**Teeth.** Every block runs a broken variant through the same assertion (open-world verdict, net-score selection, in-sample
threshold, verdict-κ admission, row bootstrap, multiplier defaulted to 1, a different class map in Python). A mutation check
(scratch script, originals restored byte-for-byte) broke the code 19 ways; **19 of 19 made a suite fail**, after three tests
were strengthened when the first pass left 5 survivors (LOTO calibration, the grid filter, tie ranks, figure look-behind;
one dead line in `figuresIn` was removed and the regenerated job file was checked byte-identical modulo its output path).

**One analysis defect found and fixed during the work.** The first Learn-then-Test used fixed-sequence testing from the
strictest threshold; a 2-row strictest point (risk 1.0) stopped every sequence. The default is now Holm over one hypothesis
per distinct release set with n_eff ≥ 5; the fixed-sequence result stays in the output beside it. Neither certifies anything
on dev60 (§2.4).

---

## 2. Move 3: the three-valued verdict over the stored checks

### 2.1 Definitions (as coded)

Per obligation: **SUPPORTED** = a code- or diff-decided check of an established (hard, 2-of-3 readers) obligation passed;
**FAILED** = such a check failed (or nothing changed at all); **UNKNOWN** = a model verdict (judged-only, never consumed), the
actor's own checker (self-report), a check that cannot be evaluated (undecided), a failing check of an unestablished
obligation (soft), or a change in the diff that no passing positive check cites (unexplained effect: the closed-world
complement). Release only with no FAILED; the UNKNOWN items are the assumption list. Selection key (FAILED ↑, SUPPORTED ↓,
UNKNOWN ↑), ties to the default fork. Policies: T1 (existence-only positives count), T2 (they do not), T0 (no complement),
TJ (a judged hard `not_met` may veto, never release), T3 (post hoc: unestablished obligations leave the count).

### 2.2 Row-level outcome (six reported arms, 360 rows, base pass 124 = 34.4%, n_eff 133 by task clusters, ICC 0.34)

| Sources / policy | SUPPORTED rows (pass rate) | UNKNOWN rows (pass rate) | FAILED rows (pass rate) | Released = no FAILED (precision) |
|---|---|---|---|---|
| RL2 + code-checks, T1 | 2 (0/2) | 173 (0.538) | 185 (0.168) | 175 (0.531) |
| RL2, T1 | 3 (0/3) | 183 (0.530) | 174 (0.155) | 186 (0.522) |
| RL2 + code-checks, T2 | 0 | 175 (0.531) | 185 (0.168) | 175 (0.531) |
| RL2 + code-checks, TJ | 2 (0/2) | 170 (0.535) | 188 (0.176) | 172 (0.529) |
| RL2 + code-checks, T0 (no complement) | 4 (1/4) | 171 (0.538) | 185 (0.168) | 175 (0.531) |
| code-checks alone, T1 | 0 | 282 (0.422) | 78 (0.064) | 282 (0.422) |
| own checks, T1 (A1-C rows, 120) | 24 (0.542) | 47 (0.447) | 49 (0.306) | 71 (0.479) |
| **RL2 + code-checks, T3 (post hoc)** | **58 (0.724; one-sided 95% lower 0.50 at n_eff 18.6)** | 117 (0.436) | 185 (0.168) | 175 (0.531) |

Held-out folds 3–4 (144 rows): T1 releases at precision 0.597; T3 SUPPORTED 22 rows at 0.727 (coverage 15.3%).

**UNKNOWN composition (T1, RL2 + code-checks):** soft 1,438, judged-only 1,320, unexplained-effect 673, unobservable 0. Rows
whose only UNKNOWN kind is the complement: 2; 164 of the 173 UNKNOWN rows carry at least one judged-only item.

**ATTACK's count (m3-a1c's own "all checks pass": 17 true, 11 false accepts).**

| Verdict source | 11 false accepts become | 17 true accepts become |
|---|---|---|
| RL2 + code-checks, T1 | 4 FAILED, 7 UNKNOWN, 0 SUPPORTED | 0 SUPPORTED, 13 UNKNOWN (released with assumptions), 4 FAILED |
| RL2 + code-checks, T3 (post hoc) | 4 FAILED, 5 UNKNOWN, 2 SUPPORTED | 5 SUPPORTED |
| own checks, T1 (the self-report baseline) | 0 FAILED, 9 UNKNOWN, 2 SUPPORTED | 8 SUPPORTED |

haiku-a1c (9 true, 16 false): T1 turns the 16 into 6 FAILED + 10 UNKNOWN and keeps 0 SUPPORTED.

### 2.3 Against ATTACK's preregistered look-1 bar (read here on dev60 as a direction check)

- **Success** (SUPPORTED precision ≥ 0.80 at coverage ≥ 25%, UNKNOWN precision ≤ 0.55): not met. UNKNOWN precision is 0.538
  (inside the bar); SUPPORTED coverage is 0.6% (T1).
- **Refuted** (below 0.65 precision or below 15% coverage): yes for every pre-declared policy. On the threshold curve
  (release when no FAILED and UNKNOWN share ≤ θ): θ 0.1 → coverage 9.2%, precision 0.697; θ 0.25 → 24.4%, 0.614;
  θ 1 → 48.6%, 0.531. T3 (post hoc) sits between the bars (16.1% at 0.724).
- **Kill** ("the UNKNOWN set is dominated by unobservable kinds; then the fix is read-back coverage, Move 2"): not triggered.
  The UNKNOWN set is spec uncertainty (soft) and model-only obligations (judged): the fix is Move 1, which turns them into
  established, code-decided obligations. Move 3 cannot pass its bar on RL2 v2; it is a consumer of Δ*.

### 2.4 Certification: risk–coverage leave-one-task-out

For each task, θ is chosen on the other 59 by Learn-then-Test (Hoeffding–Bentkus, binary loss, n = n_eff of the released
rows, Holm over distinct release sets, δ 0.1) and applied to the held-out task. **Result: no task receives a certified θ at
α 0.2, 0.35 or 0.5, for any source or policy; every run is held** (124 of 124 passing runs held). The fixed-sequence variant
gives the same. The binding quantity is n_eff (≤ 61 released rows' worth) against risks of 0.30–0.47: at this n, the
guarantee ATTACK prices (19 accepted tasks with 0 errors for a 0.85 lower bound) is out of reach on dev60 alone.

**Calibrating on the free-label lab instead** (Move 3 × 4): on the 1,205 lab items, α 0.2 certifies θ = 1 (release on no
FAILED; lab risk 0.125, one-sided CP upper 0.178 at n_eff 159, coverage 47.1%). Applied unchanged to the 360 stored rows:
risk **0.469** (upper 0.580), coverage 48.6%. The lab understates real risk 3.7× (see §3.5 for why).

### 2.5 Selection by (FAILED, SUPPORTED, UNKNOWN)

| Pool (fork order) | Tri-state T1 (RL2 + code-checks) | R1 (RL2 accept, score) | R0 (default) | Oracle |
|---|---|---|---|---|
| **P2** m3-a1c, sonnet-a1 | **34/60 (+5/−0)**, held-out 15/24 (+2/−0) | 33 (+4/−0), 15/24 | 29, 13/24 | 36 |
| P3 m3-a1c, haiku-a1c, haiku-a1 | 28 (+4/−5), 12/24 | 29 (+4/−4), 15/24 | 29 | 36 |
| P3s m3-a1c, sonnet-a1, haiku-a1 | 33 (+7/−3), 14/24 | 31 (+6/−4), 15/24 | 29 | 38 |
| P6 all six | 29 (+6/−6), 13/24 | 29 (+5/−5), 15/24 | 29 | 40 |
| P2, code-checks veto alone | 33 (+4/−0) | | | 36 |

Headline rows with the ceiling column (`certify.headlineRow`; every node legacy NON-CONFORMING: effort unset):

| Arm | Strict (95% CP) | Reachable subset | n_eff | Nodes |
|---|---|---|---|---|
| P2 tri-state T1 | 34/60 = 56.7% [43.2, 69.4] | 34/53 = 64.2% [49.8, 76.9] | 60 | m3-a1c session haiku@UNSET/$0.75; sonnet-a1 session sonnet@UNSET/$1.50 |
| P2 R1 | 33/60 = 55.0% [41.6, 67.9] | 33/53 = 62.3% [47.9, 75.2] | 60 | same |
| P2 R0 (m3-a1c) | 29/60 = 48.3% [35.2, 61.6] | 29/53 = 54.7% [40.4, 68.4] | 60 | m3-a1c |

Reading: the tri-state key ties VERIFIER-LAB's best rule (R3, 34) with no loss and without the Haiku judge's verdicts (judged
items count as UNKNOWN; their stored verdict is never consumed), so it costs the RL2 extraction plus the code-check facts.
Same-family pools still lose (P3), as VERIFIER-LAB found: the selector cannot create a better candidate. In-sample caveats:
RL2 was designed on folds 0–2, P2 was found by looking, and +5 vs +4 is one task.

---

## 3. Move 4: the free-label lab

### 3.1 Construction

- **Seeds:** all 124 officially passing canonical rows of the six reported dev60 arms (40 tasks). ATTACK's "~77" is the
  three harness arms' subset (29 + 28 + 20); every seed was used.
- **Replay:** each job runs in the official environment through `bridge.py`'s own Rollout on the seed's stored initial world;
  ids the replayed apps generate in place of the stored ones are carried forward to later calls. **124/124 controls reproduce
  the official pass.** 1,510 jobs (124 controls, 1,081 mutants, 305 twins), 0 replay errors, about 50 minutes at nice 15.
- **Trajectory operators** (generic): drop one write; keep the first half of the writes; swap one recipient for an unused
  address of the world; move one figure by its last digit; empty one text field; repeat one write on an untouched record of
  the same collection (over-action); send one create twice; remove every read; append a neutral closing line; and one empty
  trajectory per task. **World twins:** reverse every collection; copy an untouched record (fresh id); rename an untouched
  record; copy a record the run acted on.
- **Verifiers ($0):** RL2 code checks (frozen), each RL2 reader alone, code-checks v1.1 (stored facts), the tri-state verdict
  (T1, T3), a non-empty-diff baseline. Judges cost money and were not run (§6).

### 3.2 What the official rubric says about each edit

| Operator | n | Official fail | Mean severity (share of assertions failed) | Intended |
|---|---|---|---|---|
| drop_write | 233 | 191 (82%) | 0.278 | wrong |
| drop_tail | 109 | 98 (90%) | 0.456 | wrong |
| swap_recipient | 97 | 83 (86%) | 0.289 | wrong |
| perturb_number | 88 | 16 (18%) | 0.027 | wrong |
| blank_text | 120 | 82 (68%) | 0.221 | wrong |
| extra_write | 29 | 7 (24%) | 0.016 | wrong |
| dup_write | 121 | 5 (4%) | 0.005 | wrong |
| noop | 40 | 40 (100%) | 1.000 | wrong |
| drop_reads | 124 | 0 | 0 | equivalent |
| reword | 120 | 0 | 0 | equivalent |
| twins: permute / decoy_untouched / rename_untouched | 124 / 53 / 51 | 0 / 0 / 0 | 0 | same |
| twin: decoy_touched | 77 | 3 (4%) | 0.006 | incomplete (inferred) |

**Grader blind spots** (intended wrong, officially passing): dup_write 96%, perturb_number 82%, extra_write 76%, blank_text
32%, drop_write 18%, swap_recipient 14%, drop_tail 10%. The rubric checks the literals and effects it was built around; a
duplicate send, a changed figure it does not check, or a write on an extra record passes. Two consequences: the lab's
"false alarms" on these operators are often true detections of real damage, and a pass-rate benchmark rewards not caring.

### 3.3 Verifiers on the lab (1,205 items: controls and mutants; 522 officially failing, 683 passing)

| Verifier | Kill | False alarm (all passing) | AUROC | Spearman ρ vs severity [95% task-cluster CI] | AUROC on the 360 stored rows |
|---|---|---|---|---|---|
| RL2 code checks | 445/522 (85%) | 171/683 (25%) | 0.859 | **0.709 [0.65, 0.77]** | 0.765 |
| tri-state T1 | 451/522 (86%) | 187/683 (27%) | 0.884 | **0.737 [0.68, 0.79]** | 0.757 |
| tri-state T3 (post hoc) | 451/522 | 187/683 | 0.874 | 0.722 [0.66, 0.78] | 0.775 |
| RL2 reader 0 / 1 / 2 | 93% / 90% / 89% | 51% / 46% / 52% | 0.843 / 0.849 / 0.802 | 0.675 / 0.692 / 0.601 | 0.716 (reader 0) |
| code-checks v1.1 | 193/522 (37%) | 28/683 (4%) | 0.638 | 0.363 [0.27, 0.45] | 0.700 |
| non-empty diff | 57/522 (11%) | 0/683 | 0.555 | 0.403 [0.35, 0.45] | 0.566 |

Mutant AUROCs (0.80–0.88) sit 0.08–0.13 above the same verifiers' AUROC on the real rows: the lab is easier than reality.

**Sensitivity** (mutants of seeds whose control the verifier accepts, so a rejection is information, not a repeat):

| Verifier | Kill | False alarm | False alarm on true equivalents (drop_reads, reword) | Blind to |
|---|---|---|---|---|
| RL2 | 333/410 (81%) | 35/449 (8%) | 0/196 | duplicates (0/94 flagged), over-action (0/6 killed, 0/14 flagged) |
| tri-state T1 | 320/391 (82%) | 33/435 (8%) | 0/188 | same |
| code-checks | 173/500 (35%) | 3/539 (1%) | 0/234 | figures (0/14), emptied text (4/78) |
| reader 0 alone | 238/274 (87%) | 17/287 (6%) | 0/128 | catches over-action 3/4 that the merged ledger drops (single-reader negatives become soft) |

Per assertion class (RL2, sensitivity): content 211/228, prohibition 35/39, existence 208/236, action-key 10/20, flag 8/8,
other 45/64. ATTACK's success bar ("Δ\* kills ≥ 0.85 of official-failing prohibition and body-content mutants at ≤ 0.10 false
alarms on equivalent mutants where current checks are < 0.5") cannot discriminate here: current RL2 already kills 0.90–0.93
of those lab mutants at 0/196 false alarms on equivalents. The lab's prohibition and content mutants are too easy.

### 3.4 Twins (closure)

No verifier flips on any stability twin: permute 0/124, decoy_untouched 0/53, rename_untouched 0/51 (all officially
consistent). On decoy_touched (a fresh-id copy of a record the run acted on; 74 officially consistent), **no verifier rejects
the unchanged run: RL2 0/58, readers 0/32, tri-state 0/58** where the control was accepted. This is the code-enumerated
closure gap ATTACK names (Move 1 (a)), measured: the stored ledger lists items, not a universe with a disposition per member.
The twin label is an inference (a rule over identity, order or counts would break it) and the official rubric is blind to it
by construction (3 of 77 changed grade, excluded).

### 3.5 Validity: does the lab's class ordering predict the real false-accept ordering?

Lab miss rate per class (officially failing mutants a verifier accepts) against the real false-accept rate per class (stored
failing rows with that class among their failed assertions that the verifier accepts):

| Verifier | content | prohibition | existence | action-key | flag | other | Spearman (k = 6) |
|---|---|---|---|---|---|---|---|
| RL2 | 0.06 vs 0.18 | 0.10 vs 0.32 | 0.10 vs 0.32 | 0.38 vs 0.59 | 0.00 vs 0.83 | 0.22 vs 0.31 | −0.09 |
| code-checks | 0.62 vs 0.56 | 0.46 vs 0.74 | 0.45 vs 0.67 | 0.42 vs 0.47 | 0.38 vs 1.00 | 0.64 vs 0.75 | −0.03 |
| tri-state T1 | 0.06 vs 0.18 | 0.10 vs 0.29 | 0.08 vs 0.30 | 0.31 vs 0.44 | 0.00 vs 0.83 | 0.22 vs 0.31 | 0.09 |
| pooled (RL2, code-checks, tri × 6) | | | | | | | 0.35 (k = 18) |

(flag: 8 lab / 12 real rows.) **ATTACK's kill rule fires**: "the lab ordering does not match reality (then mutants are the
wrong distribution and labels must come from looks)". Real misses are 2–8× the lab's in every class because real failures are
mostly *wrong or unstated spec* (the actor and the ledger read the rule the same wrong way), while trajectory mutants break
what the ledger already states. The useful parts survive: the severity ranking (ρ 0.71–0.74), stability and closure twins,
the grader-blind-spot census, and a regression bench for Δ\* (any verifier can be re-scored on the same 1,510 replays).
The distribution that would match reality is **spec mutants** (perturb the rule reading, not the trajectory), which needs a
second reader path, not more trajectory edits.

---

## 4. Move 6: κ, n_eff, the budget rule and the effort cost model

### 4.1 Agreement tables (stored rows; error κ = agreement of mistakes against the official label; 95% task-cluster bootstrap)

| Pair | Verdict κ | Error κ | Both wrong vs independent |
|---|---|---|---|
| Haiku judge – Sonnet judge (99 rows) | 0.65 [0.47, 0.81] | **0.64** [0.47, 0.80] | 0.26 vs 0.12 |
| Mercury judge – Sonnet judge (85) | 0.64 | 0.58 [0.38, 0.75] | 0.25 vs 0.12 |
| Haiku judge – Mercury judge (144) | 0.46 | 0.38 [0.22, 0.52] | 0.20 vs 0.12 |
| RL2 – Haiku judge (360) | **0.35** [0.24, 0.47] | **0.23** [0.10, 0.36] | 0.14 vs 0.09 |
| RL2 – code-checks | 0.34 | 0.32 [0.19, 0.46] | 0.23 vs 0.15 |
| RL2 – reader 0 / 1 / 2 | 0.56–0.59 | 0.50–0.53 | 0.21–0.22 vs 0.10–0.11 |
| reader – reader | 0.43–0.63 | 0.41–0.62 | 0.20–0.24 vs 0.10–0.11 |
| RL2 – tri-state | 0.93 | 0.92 | (tri-state is RL2 + code-checks: not a new path) |
| own checks – RL2 (120) | 0.04 | −0.02 | 0.17 vs 0.18 |
| own checks – Haiku judge (120) | 0.27 | 0.26 | 0.21 vs 0.15 |

The Haiku diff-only judge accepts 2% of rows: near-constant, uninformative. **n_eff:** six forks 2.12 (mean φ 0.365,
reproducing Move 0); three RL2 readers 1.51 (1.39 on the mutants); four judges 2.07; checks (own, code-checks, RL2, tri) 2.05;
RL2 + Haiku judge 1.63. On the mutants RL2 and code-checks have independent errors (error κ 0.04 [−0.12, 0.20]).

### 4.2 The rule applied (`infopath.admitSignal`, κ_max 0.4 on error κ, pairwise overlaps, in the order the program bought them)

| Signal | Decision | Reason |
|---|---|---|
| RL2 | admit | first |
| Haiku judge | admit | error κ 0.23 with RL2 |
| Sonnet judge | **refuse** | 0.64 with the Haiku judge |
| Mercury judge | provisional | 0.38 with the Haiku judge, upper bound 0.52 |
| Haiku diff-only judge | provisional | 0.28, upper 0.44 (and near-constant) |
| code-checks | provisional | 0.32 with RL2, upper 0.45 |
| RL2 readers 0 / 1 / 2 | **refuse** | 0.50–0.53 with RL2 |
| own checks | provisional | 0.27 with the Mercury judge, upper 0.43; a self-report, excluded from release anyway |

The rule reproduces VERIFIER-LAB's chosen pair (RL2 + Haiku judge) and refuses exactly what ATTACK §8 says to stop buying
(more judges, more same-family readers). `budgetPaths` on the seven signals scored on all 360 rows, at ≤ $0.01 per decision:
value-first picks tri-state + Haiku judge + code-checks (n_eff 2.14, $0.0055); value-per-dollar picks code-checks + one reader
+ Haiku judge (n_eff 2.68, $0.0035). Values are in-sample balanced accuracies; the rule, not the pick, is the deliverable.

### 4.3 Effort cost model (`effort-cost.mjs`; prices from `policy/models.json` only)

| Arm (dev60) | $ / task | Node manifest |
|---|---|---|
| haiku-a0 | 0.0132 | haiku@UNSET |
| sonnet-a0 | 0.1006 | sonnet@UNSET |
| opus-a0-xhigh | 0.4071 | opus@xhigh |
| haiku-a1 / sonnet-a1 | 0.0157 / 0.1153 | @UNSET |
| haiku-a1c | 0.0371 | haiku@UNSET (6 nodes) |
| m3-a1c | 0.0155 + ~61K Mercury tokens | haiku@UNSET, mercury@UNSET |

The one paired dose in the stored data: RL2 Haiku readers at reasoning low (1,024 thinking tokens) vs medium (8,000), 15
pairs over 5 tasks: output tokens ×1.25 [1.10, 1.45], cost ×1.22 [1.03, 1.49] per call. VERIFIER-LAB's "2.7× more" for
medium readers is a different quantity (whole-run, with retries) and is not reproduced per call. `projectCost` projects
"RL2 readers low → medium" ($0.0183 per task for three readers) and refuses "Haiku session UNSET → max" (no measurement):
the Haiku-max lever of ATTACK Move 6 stays a paid, preregistered step. Session token records are incomplete: multi-turn CLI
sessions record 79–174 output tokens per task where the reported cost implies up to ~15K (Opus) to ~56K (haiku-a1c, upper
bound), so cost, not recorded output tokens, is the effort signal.

---

## 5. What this means for the program

1. **Move order is 1 → 3, not 3 alone.** Three-valued release is correct semantics and the honest product output, but on
   today's ledger it releases nothing at certified risk: 2,758 of 3,431 assumptions are spec uncertainty or model-only
   obligations. Δ\* (closure, derivation, labelled nulls) is what turns them into decided obligations; requirement-ledger-v3
   should be scored first on this lab's closure twins (target: decoy_touched flagged, 0 flips elsewhere) and on §2.2's table.
2. **D28 (1) release on RL2 v2 = "release on no FAILED" = precision 0.53 at 49% coverage.** It removes most false accepts of
   the own checks (11 → 0 SUPPORTED) but does not make "released" trustworthy; the assumption list must be shown, not hidden.
3. **Thresholds need real labels.** The lab-calibrated threshold is 3.7× optimistic. Release thresholds are set on looks 2–3
   under the frozen sequential plan, never on mutants; the mutation lab is for sensitivity, regression and closure.
4. **Selection:** the lexicographic key is a free, judge-less tie with the best measured rule on P2; VL-1's frozen R3 on look 2
   is the test that matters (not touched here).
5. **Graders are blind to duplicates and over-action**; Move 2's effect identity and gate remain necessary even when the
   benchmark does not reward them.
6. **κ rule:** adopt `infopath.admitSignal` as the gate for any new reader, fork, judge or check; report n_eff beside every
   aggregate (tables in `move346/kappa.json`).

---

## 6. What is left, and why

- **Δ\* is not here.** Move 1's requirement-ledger-v3 lives on another branch; the tri-state adapters and `mutlab/verify.mjs`
  take one more verifier function to score it on the same 1,510 replays (worlds are regenerable; job file sha256 `38f222b4…`,
  manifest `a7f531a4…`).
- **Paid steps not run** (each needs a preregistration first, within D22): judge arms on the mutants (ATTACK ≤ $1); the
  Haiku `max` dose and the Opus × conventions 2×2 (D19/D22).
- **Certified release thresholds** need look-2/look-3 labels under SEQUENTIAL-PLAN-v1; nothing here reads them (VL-1 and A1-C v2
  P1 are live and frozen).
- **Spec mutants** (the distribution the validity check asks for) are designed in §3.5 but not built.
- **The PREREG-AB-v1 amendment** for verdict and abstention metrics (Move 0 §6 draft) should adopt §2.1's definitions; filing it
  is the owner's step.
- **Inputs are scratch artefacts.** The stored lab, RL2 outputs, code-check facts and judge journals sit in the session
  scratchpad (as in VERIFIER-LAB §8); every output records their sha256. My scratch work directory was deleted at the end
  (disk below 1.2 GB shared); the replays are deterministic from the committed code and those inputs.

## 7. Reproduce ($0)

```
S=<session scratchpad>; W=$S/m346/lab
node experiments/autobench/verifier/tristate/run.mjs --vlab $S/vlab --rl2 $S/rl2-out --cc-facts $S/cc-out/facts.json \
  --strata research/blockers-20261021/move0/dev60-ceiling-strata.json --out research/blockers-20261021/move346/tristate.json
node experiments/autobench/verifier/mutlab/jobs.mjs --vlab $S/vlab --out $W          # 1,510 jobs, sha256 38f222b4… (paths under $W)
bash experiments/autobench/verifier/mutlab/replay.sh $W/jobs.jsonl $W/out0.jsonl $W/worlds $S/m346/live   # needs corpus/AutomationBench
node experiments/autobench/verifier/mutlab/verify.mjs --vlab $S/vlab --rl2 $S/rl2-out --cc-facts $S/cc-out/facts.json --work $W --out $W/verdicts.jsonl
node experiments/autobench/verifier/mutlab/score.mjs --vlab $S/vlab --work $W --verdicts $W/verdicts.jsonl --out research/blockers-20261021/move346/mutlab.json
node experiments/autobench/verifier/kappa/tables.mjs --vlab $S/vlab --verdicts $W/verdicts.jsonl --work $W --out research/blockers-20261021/move346/kappa.json
node experiments/certify/effort-cost.mjs --rl2 $S/rl2-out --out research/blockers-20261021/move346/effort-cost.json
nice -n 15 node --test --test-concurrency=1 <each of the four test files>
```

(The run used two interleaved shards, `out0.jsonl` and `out1.jsonl`; `score.mjs` and `tables.mjs` read both.)
