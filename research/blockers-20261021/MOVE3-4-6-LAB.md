# Moves 3, 4 and 6 in the verifier lab: the three-valued verdict, the free-label lab, the information-path budget (2026-11-04, revised v2)

**Scope.** ATTACK.md §6 Moves 3, 4 and 6 at $0, on top of Move 0 (`experiments/lib/certify.mjs`, merged from branch
`worktree-wf_bba577b8-b58-1` @ `d3bd7acf`). Move 3: a pure SUPPORTED / FAILED / UNKNOWN function per obligation over the
stored checks and RL2 outputs, the release rule, lexicographic selection, risk–coverage leave-one-task-out with n_eff,
certified through certify.mjs. Move 4: trajectory mutants and world twins of the officially passing stored worlds,
labelled by the official AutomationBench rubric, with ATTACK's validity check. Move 6: κ and n_eff for every stored
signal pair, the effort cost model, and the information-path budget rule as a function.

**This is v2.** An adversarial review of v1 (commit `3ff42399`) found one high, six medium and twelve lower defects; every
one is fixed or answered with evidence in §8, and every number below was recomputed after the fixes (v1's numbers are
superseded; where a v1 number moved, §8 gives both). The biggest changes: a check of an obligation the readers did not
establish is now UNKNOWN whether it passed or failed (v1 let it SUPPORT when it passed), a verdict with no obligation is
held, every effect a passing check matches is explained, the code verifiers run without the world's hidden clock (D28
(2)), the κ admission rule uses ATTACK's metric, the mutation operators were corrected and the missing "forbidden row"
operator was built, and the lab was replayed again (1,624 jobs).

**Evidence class: development / diagnostic, $0.** Every number comes from stored dev60 rows (devTrain, subset 60, seed 21,
k = 1 per arm), from the frozen verifiers recomputed on them without a model call, and from 1,624 replays through the
official environment and rubric. RL2 was designed on folds 0–2 (folds 3–4 held out); A1-C is in-sample on dev60; VERIFIER-LAB's
pool P2 was found by looking. Nothing here is a claim (D28 (4)). No look-2/look-3, devCheck, test or sealed task, run or grade
was read: rows come through a dev60 run-id allowlist (`mutlab/labio.mjs`, now with resolved-path checks), and no file of
VL-1, A1-C v1/v2, RL2, FREEZE-p2 or PREREG-OT0 changed (all new code is in new files; `bridge.py` and the lab differ are
imported unchanged). Model calls: 0. Spend: $0.

**The clock (D28 (2)), disclosed.** The stored lab rows carry the world's `meta.current_time` as `today`, and v1 passed it
to every verifier. v2 withholds it by default (`labio.viewOf`), and code-checks run clock-blind: "today" comes from the
request, else from the latest business date of the work items, else it is a labelled null, and a check only the hidden
clock could decide becomes an UNKNOWN `labelled-null` obligation. The hidden-clock runs are kept beside it as `@clock`.
**What could not be made clock-blind at $0:** the stored RL2 extractions were produced from prompts that contained the
clock (their cache key includes it), so every RL2-based number still carries that exposure; re-extraction is a paid step.

**Hygiene.** Keep this file out of every harness, verifier and model context (it carries the ceiling column and per-class
failure rates). Only generic mechanisms are in code: the mutation operators act on HTTP method, URL path vocabulary, JSON
shape, e-mail addresses, numbers and free text; no task name, grader string or ceiling note appears in any new source or
output file (checked by `mutlab.test.mjs` and a scan of the four result files). Grader assertion texts were never written
anywhere: the replay driver reduces each grade to counts per generic class.

**Outputs.** `research/blockers-20261021/move346/{tristate,mutlab,kappa,effort-cost}.json` (each lists the sha256 of what it
read; counts and rates only).

---

## 0. Verdicts

1. **Fidelity first.** The frozen RL2 check phase recomputed from stored extractions reproduces all 542 stored check rows
   exactly, and the first effect each passing message/creation check matches is the frozen evaluator's evidence address
   in 6,789 of 6,789 checks; 124 of 124 stored passing call logs replay to an official pass with the stored call-error count
   (mean 47.52 both) and the same diff shape in 121 of 124.
2. **Three-valued release on today's checks releases nothing as SUPPORTED.** With an unestablished obligation's check
   counted as an assumption whether it passed or failed (v1 counted a pass as support), fully SUPPORTED runs are **0 of 360**
   (v1: 2). ATTACK's look-1 bar is **refuted** on its own metric (SUPPORTED coverage 0% < 15%); UNKNOWN precision 0.534 is
   inside its bar.
3. **The kill clause does not fire, now by a bound rather than by construction.** UNKNOWN (6,486 items) is spec uncertainty
   (soft 4,727), model-only obligations (judged-only 1,320), unexplained or duplicate effects (389) and labelled nulls (50):
   0 unobservable, and even if every judged item were unobservable they would be 20% of it. The fix is Move 1 (Δ\*), not Move 2.
4. **FAILED is informative, release-on-no-FAILED is not enough.** FAILED rows pass 16.3% (base 34.4%); release (no FAILED,
   at least one obligation) is 176 of 360 at precision 0.534. Of m3-a1c's 11 false "all checks pass", 4 become FAILED and 7
   UNKNOWN, 0 SUPPORTED; its 17 true accepts also stay off SUPPORTED (13 released with assumptions, 4 FAILED).
5. **Nothing certifies at this n.** Learn-then-Test leave-one-task-out certifies no threshold at α 0.2 or 0.35 under any
   source or policy; at α 0.5 the 11 rows it releases are all failures. The honest output is abstention.
6. **The lab-calibrated threshold is 3.9× optimistic, and about 2.3× of that is base rate.** α 0.2 on the lab certifies
   release on no FAILED (lab risk 0.118); on the stored rows its risk is 0.466. Split: the lab's own miss and pass-accept
   rates at the stored failure share give 0.267 (×2.26, base rate); the stored miss rate is 2.5× the lab's (×1.75).
7. **Selection by (FAILED, SUPPORTED, UNKNOWN) works without a judge:** P2 34/60 (+5/−0, sign p 0.062), held-out 15/24,
   **34/53 reachable** [49.8, 76.9], at $0.144 per task; R1 33, R0 29. It needs both review fixes (with v1's first-match
   effect explanation it is 33, +5/−1); one task separates 33 from 34.
8. **The official grader passes many edits a correct run should not make:** a repeated send 80 of 80, a repeated create
   36 of 41, one more send or create for an entity the run never touched (the forbidden row) 93 of 114, a one-digit figure
   change 72 of 88, a write on an untouched record 22 of 29; pooled, 408 of 911 intended-wrong edits (45%, noops excluded).
9. **Class validity fails as ATTACK writes it, but the test is underpowered.** Spearman of the lab's per-class miss rate vs
   the real false-accept rate: RL2 −0.03 [−0.43, 0.90], three-valued T1 0.14 [−0.60, 0.90], code-checks −0.26; pooled 0.36
   (k = 18) against the 0.5 bar: **the kill rule fires** on the point estimates. Six classes, one class with 6 lab items
   (flag) decides the sign (without it RL2 0.70, T1 1.0), and the bootstrap puts 0.5 inside every interval. Thresholds
   must come from looks either way; the lab stays a regression, sensitivity and closure bench.
10. **Closure recall is zero for every verifier:** a fresh-id copy of a record the run acted on is flagged 0 of 58 times
    (RL2, T1), 0 of 40–52 (independent readers), 0 of 74 (code-checks); stability twins flip no verifier (0 of 228).
    Over-action and duplicates are nearly invisible to RL2 (forbidden row 4 of 72 flagged, duplicates 0 of 94, untouched-
    record writes 0 of 14).
11. **κ on ATTACK's metric:** forks 2.12 effective of 6; independent RL2 readers 1.48 of 3; judges 2.07 of 4. The decision of
    record (verdict κ ≤ 0.4) admits RL2, the Haiku judge and code-checks (the last two fragile at their bounds) and refuses
    the Sonnet and Mercury judges and every same-family reader; the self-report and the near-constant diff-only judge are
    excluded by rule.
12. **Effort:** every dev60 arm but Opus ran with effort UNSET; the only measured dose (Haiku reader, reasoning low →
    medium) costs ×1.22 [1.03, 1.49]; any other projection is refused as unmeasured. Recorded CLI output tokens are below
    the least output the cost can mean for haiku-a1c and m3-a1c; for Opus that bound is 0, so the claim is withdrawn there.

---

## 1. What was built (v2)

| File (all new) | What | Tests |
|---|---|---|
| `experiments/autobench/verifier/tristate/verdict.mjs` | `obligationStatus`, `verdictOf` (closed world: unexplained and duplicate effects are UNKNOWN; a verdict with no obligation is vacuous and held), `releasedAt`, lexicographic `select`, `killClause` (observability bound); policies T1, T2, T0, TJ fixed before any result; T3 and TC added after and marked post hoc | `tristate.test.mjs` 18 |
| `…/tristate/adapters.mjs` | RL2 check phase recomputed from stored extractions (`rl2Ledgers`, `rl2Check` explaining every matching effect, `rl2ReaderLedgers` + `readerAccept` for independent readers), code-checks with and without the hidden clock (`ccClock`, `businessToday`, `clockBlindWorld`), obligations from RL2, code-checks and the A1-C own checks | (same) |
| `…/tristate/riskcov.mjs` | curve, `chooseTheta` (Learn-then-Test on n_eff), `loto`, `rowSummary`; failures scaled to n_eff round up | (same) |
| `…/tristate/run.mjs` | the Move 3 analysis as exported functions (`selectPool`, `RULES`, `summarizeSelection`, `analyzeConfig`, `selectionManifest`) → `move346/tristate.json` | (same) |
| `…/mutlab/mutate.mjs`, `twins.mjs` | 11 trajectory operators (v2: `writeKind`; dup only of sends/creates; one-digit number moves; `extra_create`, the forbidden row) and 4 world twins, pure and generic | `mutlab.test.mjs` 17 |
| `…/mutlab/replay_batch.py`, `replay.sh` | batch replay in AutomationBench's venv through `bridge.py`'s own Rollout (imported, unchanged) with id carry-forward; grades reduced to class counts; no bytecode written (`-B`) | (python helpers tested) |
| `…/mutlab/labio.mjs`, `jobs.mjs`, `verify.mjs`, `score.mjs` | allowlisted lab access (resolved-path checks, clock withheld), job builder, $0 verifiers (clock-blind and `@clock`, independent readers), scoring as exported functions → `move346/mutlab.json` | (same) |
| `…/kappa/tables.mjs` | κ / n_eff tables, the four admission walks, budget → `move346/kappa.json` | `tables.test.mjs` 3 |
| `experiments/lib/infopath.mjs` | `cohenKappa`, `pairStats`, `clusterBootstrap`, `neffOfSet`, `admitSignal` (metric named, never defaulted), `admissionWalk` (self-reports and uninformative signals excluded by rule; point or bound rule), `budgetPaths` (unpriced signals not bought) | `infopath.test.mjs` 7 |
| `experiments/certify/effort-cost.mjs` | per-arm cost at the recorded effort, the measured dose, `projectCost` that refuses unmeasured doses, the implied-output range → `move346/effort-cost.json` | `effort-cost.test.mjs` 5 |

**Tests:** 18 + 17 + 3 + 7 + 5 = 50, each suite run alone at nice 15, concurrency 1, all passing; Move 0's certify suite
still 20/20. **Teeth:** every review test runs the v1 behaviour (or a broken variant) through the same assertion. A scripted
mutation check broke the v2 code 22 ways (soft rule, vacuous release, kill clause, rounding, the clock, duplicate effects,
dup restriction, number bump, forbidden-row targets, path check, clock default, noop exclusion, base-rate split, core ρ,
pooled blind spot, self-report exclusion, bound rule, defaulted metric, self-report wiring, unpriced signals, allowlist
order, cache bound): **22 of 22 made a suite fail**, after one test was strengthened when the first pass left one survivor
(forbidden-row targets); originals restored byte-for-byte and checked against a copy.

---

## 2. Move 3: the three-valued verdict over the stored checks

### 2.1 Definitions (as coded in v2)

Per obligation: **SUPPORTED** = a code- or diff-decided check of an *established* obligation (hard, 2-of-3 readers) passed;
**FAILED** = such a check failed (or nothing changed at all); **UNKNOWN** = a model verdict (judged-only, never consumed),
the actor's own checker (self-report), a check that cannot be evaluated (undecided), a check of an *unestablished*
obligation **whether it passed or failed** (soft), a check only the hidden clock could decide (labelled-null), a change in
the diff that no passing positive check matches (unexplained effect: the closed-world complement), or a repeat of an
explained change with the same addressee and content (duplicate effect). Release only with no FAILED **and at least one
obligation** (an empty verdict is vacuous and held); the UNKNOWN items are the assumption list. Selection key (FAILED ↑,
SUPPORTED ↓, UNKNOWN ↑), ties to the default fork. Policies: T1 (existence-only positives count), T2 (they do not), T0 (no
complement), TJ (a judged hard `not_met` may veto, never release); post hoc: T3 (unestablished obligations leave the count)
and TC (unestablished checks decide both ways: ATTACK's literal "a code-decided or diff-decided check").

### 2.2 Row-level outcome (six reported arms, 360 rows, base pass 124 = 34.4%, n_eff 133 by task clusters, ICC 0.34)

| Sources / policy (code-checks clock-blind unless `@clock`) | SUPPORTED rows (pass rate) | UNKNOWN rows (pass rate) | FAILED rows (pass rate) | Released (precision) | Vacuous, held |
|---|---|---|---|---|---|
| RL2 + code-checks, T1 | **0** | 176 (0.534) | 184 (0.163) | 176 (0.534) | 0 |
| RL2 + code-checks @clock, T1 (v1's sources) | 0 | 175 (0.531) | 185 (0.168) | 175 (0.531) | 0 |
| RL2, T1 | 0 | 186 (0.522) | 174 (0.155) | 186 (0.522) | 0 |
| RL2 + code-checks, T2 / T0 | 0 | 176 (0.534) | 184 (0.163) | 176 (0.534) | 0 |
| RL2 + code-checks, TJ | 0 | 173 (0.532) | 187 (0.171) | 173 (0.532) | 0 |
| code-checks alone, T1 | 0 | 285 (0.421) | 75 (0.053) | 121 (0.347) | 164 |
| code-checks alone @clock, T1 | 0 | 282 (0.422) | 78 (0.064) | 92 (0.283) | 190 |
| own checks, T1 (A1-C rows, 120) | 15 (0.467) | 56 (0.482) | 49 (0.306) | 70 (0.471) | 1 |
| RL2 + code-checks, T3 (post hoc) | 72 (0.597; one-sided 95% lower 0.40 at n_eff 24.9) | 104 (0.490) | 184 (0.163) | 176 (0.534) | 0 |
| RL2 + code-checks @clock, T3 (post hoc) | 94 (0.638; lower 0.45) | 81 (0.407) | 185 (0.168) | 175 (0.531) | 0 |
| RL2 + code-checks, TC (post hoc) | 4 (0.250) | 52 (0.654) | 304 (0.293) | 56 (0.625) | 0 |

Held-out folds 3–4 (144 rows): T1 releases 63 at precision 0.603, SUPPORTED 0; T3 SUPPORTED 19 rows at 0.632 (13.2%).

**UNKNOWN composition (T1, RL2 + code-checks, 6,486 items):** soft 4,727 (v1 1,438: v1 counted the 3,289 soft *passes* as
SUPPORTED), judged-only 1,320, unexplained-effect 355 (v1 673: 318 were artefacts of v1's first-match explanation, of which 284 are now explained and 34 are duplicates),
labelled-null 50, duplicate-effect 34, unobservable 0. Rows: 105 of the 176 UNKNOWN rows carry exactly judged-only + soft;
8 carry only soft.

**ATTACK's count (m3-a1c's own "all checks pass": 17 true, 11 false accepts).**

| Verdict source | 11 false accepts become | 17 true accepts become |
|---|---|---|
| RL2 + code-checks, T1 | 4 FAILED, 7 UNKNOWN (released with assumptions), 0 SUPPORTED | 0 SUPPORTED, 13 UNKNOWN (released), 4 FAILED |
| RL2 + code-checks, T3 (post hoc) | 4 FAILED, 5 UNKNOWN, 2 SUPPORTED | 6 SUPPORTED |
| RL2 + code-checks, TC (post hoc) | 10 FAILED, 1 UNKNOWN, 0 SUPPORTED | 1 SUPPORTED, 11 FAILED |
| own checks, T1 (the self-report baseline) | 0 FAILED, 10 UNKNOWN, 1 SUPPORTED | 3 SUPPORTED |

haiku-a1c (9 true, 16 false): T1 turns the 16 into 6 FAILED + 10 UNKNOWN and keeps 0 SUPPORTED.

### 2.3 Against ATTACK's preregistered look-1 bar (read here on dev60 as a direction check)

- **ATTACK's metric** is the SUPPORTED row: precision ≥ 0.80 at coverage ≥ 25%, UNKNOWN precision ≤ 0.55; refuted below
  0.65 precision or below 15% coverage. **T1 (every pre-declared policy): SUPPORTED coverage 0% → refuted.** UNKNOWN precision
  0.534 is inside its bar. Post hoc: T3 reaches 20.0% coverage at 0.597 (refuted on precision); TC 1.1% at 0.25.
- **The θ curve is a different quantity** (release when no FAILED and the UNKNOWN share ≤ θ), reported for the
  risk–coverage view: θ 0.25 → coverage 4.7%, precision 0.765 (17 rows); θ 0.5 → 20.8%, 0.720; θ 1 → 48.9%, 0.534. v1 quoted
  its θ 0.25 point (24.4% at 0.614) as the look-1 refutation; with soft passes no longer SUPPORTED that point moved to
  4.7% at 0.765, and the refutation stands on ATTACK's own metric.
- **Kill** ("the UNKNOWN set is dominated by unobservable kinds"): v1 could not fire it (no adapter emitted the kind). v2
  classifies every UNKNOWN kind by observability and bounds the unclassified ones: under T1 the observable kinds (soft,
  unexplained, duplicate, labelled-null) are 5,166 of 6,486, unobservable 0, and the only unclassified kind (judged-only,
  1,320 = 20.4%) could not reach half even if every judged item were unobservable: **not triggered, by a bound**. Under TC
  (post hoc) judged-only items are 75% of UNKNOWN and the clause is **not evaluable** until they are classified. The fix
  remains Move 1 (Δ\*): most UNKNOWN is spec uncertainty (soft) that establishment and derivation would decide.

### 2.4 Certification: risk–coverage leave-one-task-out

For each task, θ is chosen on the other 59 by Learn-then-Test (Hoeffding–Bentkus, binary loss, n = n_eff of the released
rows, Holm over distinct release sets, δ 0.1) and applied to the held-out task. **α 0.2 and 0.35: no task receives a
certified θ, under any source or policy; every run is held** (124 of 124 passing runs held; the fixed-sequence variant
gives the same). At α 0.5 (RL2 + code-checks, T1) 5 tasks receive θ = 0.5 and release 11 rows, **all 11 failing**: the
leave-one-task-out operating point is worse than abstaining. The binding quantity is n_eff against risks of 0.3–0.5.

**Calibrating on the free-label lab instead** (Move 3 × 4): on the 1,319 lab items (mutants and controls),
α 0.2 certifies θ = 1 (release on no FAILED; lab risk 0.118, one-sided CP upper 0.177 at n_eff 140, coverage 48.8%); α 0.1
certifies nothing. Applied unchanged to the 360 stored rows: risk **0.466** (upper 0.588), coverage 48.9%, 3.95× the lab's.
v1 read the whole ratio as "the lab understates risk". It is two things (`score.labCalibration`):

| Quantity | Lab | Stored rows |
|---|---|---|
| failing share (base rate) | 0.412 | 0.656 |
| miss rate (failing runs released) | 0.140 | 0.347 |
| pass-accept rate (passing runs released) | 0.732 | 0.758 |
| risk of the released set | 0.118 | 0.466 |

The lab's own two rates at the stored base rate predict a risk of 0.267: the base rate alone multiplies the risk by 2.26,
and the higher real miss rate (×2.48) adds the remaining ×1.75. Both parts are real: the lab is easier (real misses are
spec misreads the ledger shares) and has more passing runs than reality.

### 2.5 Selection by (FAILED, SUPPORTED, UNKNOWN)

| Pool (fork order) | Tri-state T1 (RL2 + code-checks) | R1 (RL2 accept, score) | R0 (default) | Oracle |
|---|---|---|---|---|
| **P2** m3-a1c, sonnet-a1 | **34/60 (+5/−0, sign p 0.062)**, held-out 15/24 | 33 (+4/−0), 15/24 | 29, 13/24 | 36 |
| P3 m3-a1c, haiku-a1c, haiku-a1 | 27 (+4/−6), 12/24 | 29 (+4/−4), 15/24 | 29 | 36 |
| P3s m3-a1c, sonnet-a1, haiku-a1 | 34 (+8/−3), 15/24 | 31 (+6/−4), 15/24 | 29 | 38 |
| P6 all six | 30 (+7/−6), 14/24 | 29 (+5/−5), 15/24 | 29 | 40 |
| P2 under T0 / TC / @clock / RL2 alone | 34 / 34 / 34 / 34 | | | |
| P2, code-checks veto alone | 33 (+4/−0) | | | |

The P2 tie with VERIFIER-LAB's R3 (34, +6/−1, paid Haiku judge) needed both review fixes: with soft checks UNKNOWN both
ways but v1's first-match effect explanation, P2 is 33 (+5/−1) (the reviewer's number, reproduced); explaining every
matching effect and separating duplicates restores 34 (+5/−0). One task separates 33 from 34: this is not evidence of a
difference between rules.

Headline rows with the ceiling column (`certify.headlineRow`; every fork node legacy NON-CONFORMING: effort unset). The
manifest now lists every node the selection used: m3-a1c's three Mercury ledger nodes and its Haiku act node, the Sonnet
session, and the verifier nodes (three RL2 Haiku readers at reasoning low and the code-check facts call at reasoning none;
R1 adds the judged-check calls instead of the facts call):

| Arm | Strict (95% CP) | Reachable subset | $ / task | $ / success |
|---|---|---|---|---|
| P2 tri-state T1 | 34/60 = 56.7% [43.2, 69.4] | 34/53 = 64.2% [49.8, 76.9] | 0.144 | 0.254 |
| P2 R1 | 33/60 = 55.0% [41.6, 67.9] | 33/53 = 62.3% [47.9, 75.2] | 0.145 | 0.263 |
| P2 R0 (m3-a1c) | 29/60 = 48.3% [35.2, 61.6] | 29/53 = 54.7% [40.4, 68.4] | 0.016 | 0.032 |

(m3-a1c also used ~61K Mercury 3 tokens per task, listed at $0; a shadow price is pending under D28 (7). The Sonnet fork is
$0.115 of the $0.144.) Same-family pools still lose (P3), as VERIFIER-LAB found. In-sample caveats: RL2 was designed on
folds 0–2, P2 was found by looking, and +5 vs +4 is one task.

### 2.6 The clock

`businessToday` (the latest date carried by any record of the initial world) equals the hidden clock's date on 17 of 60
tasks, is earlier on 21, later on 13, and absent on 9. Clock-blind code-checks leave 50 labelled-null obligations in the
360 reported rows (74 of all 542 lab rows carry one), flip code-checks' accept on 8 of the 542, and move T1's release from
175 (precision 0.531) to 176 (0.534). Alone, code-checks loses 3 FAILED rows (78 → 75) and 26 fewer rows are vacuous (190
→ 164 held), because a labelled null is an obligation. The hidden clock was worth
little to code-checks here; its exposure in RL2's extraction prompts is not measured (paid re-extraction).

---

## 3. Move 4: the free-label lab (v2)

### 3.1 Construction

- **Seeds:** all 124 officially passing canonical rows of the six reported dev60 arms (40 tasks). ATTACK's "~77" is the
  three harness arms' subset (29 + 28 + 20); every seed was used.
- **Replay:** each job runs in the official environment through `bridge.py`'s own Rollout on the seed's stored initial world;
  ids the replayed apps generate in place of the stored ones are carried forward to later calls. **124/124 controls reproduce
  the official pass**, with the stored call-error count (mean 47.52 replayed and stored) and the stored diff shape in 121 of
  124. Per verifier, a control's verdict differs from its stored row's on at most 1 of 124 (RL2, T1, readers 0 and 1),
  never for code-checks or reader 2. 1,624 jobs (124 controls, 1,195 mutants, 305 twins), 0 replay errors, about 31
  minutes in two shards at nice 15.
- **Trajectory operators** (v2, generic; `writeKind` classifies a write as send, create, update or delete from its method
  and the last path segment): drop one write; keep the first half of the writes; swap one recipient for an unused address
  of the world; move one figure by one in its last digit (numbers and figures in text alike; v1 scaled decimals by 1.1);
  empty one text field; repeat one write on an untouched record of the same collection (over-action); **repeat one send or
  create** (v1 also "duplicated" update-like POSTs such as modify, label or addTag); **add one more send or create for an
  entity of the world the run never referenced** (the forbidden row ATTACK lists; new in v2: recipient swapped in the copy,
  else a referenced record id or display name swapped for an untouched one); remove every read; append a neutral closing
  line; and one empty trajectory per task. **World twins:** reverse every collection; copy an untouched record (fresh id);
  rename an untouched record; copy a record the run acted on.
- **Verifiers ($0):** RL2 code checks (frozen), each RL2 reader as an independent ledger, code-checks v1.1 clock-blind and
  `@clock`, the three-valued verdict (T1, T3, TC; and T1 `@clock`), a non-empty-diff baseline. Judges cost money and were
  not run (§6).

### 3.2 What the official rubric says about each edit

| Operator | n | Official fail | Mean severity (share of assertions failed) | Intended |
|---|---|---|---|---|
| drop_write | 233 | 191 (82%) | 0.278 | wrong |
| drop_tail | 109 | 98 (90%) | 0.456 | wrong |
| swap_recipient | 97 | 83 (86%) | 0.289 | wrong |
| perturb_number | 88 | 16 (18%) | 0.027 | wrong |
| blank_text | 120 | 82 (68%) | 0.221 | wrong |
| extra_write (untouched record) | 29 | 7 (24%) | 0.016 | wrong |
| dup_write: send / create | 80 / 41 | 0 / 5 | 0.005 | wrong |
| **extra_create** (forbidden row): recipient / id / name | 85 / 21 / 8 | 16 / 3 / 2 (18%) | 0.019 | wrong |
| noop | 40 | 40 (100%) | 1.000 | wrong |
| drop_reads | 124 | 0 | 0 | equivalent |
| reword | 120 | 0 | 0 | equivalent |
| twins: permute / decoy_untouched / rename_untouched | 124 / 53 / 51 | 0 / 0 / 0 | 0 | same |
| twin: decoy_touched | 77 | 3 (4%) | 0.006 | incomplete (inferred) |

**Edits the rubric passes** (intended wrong, officially passing; whether a user would object is an inference, not a
label): a repeated send 100% (80/80), a repeated create 88% (36/41), the forbidden row 82% (93/114), a one-digit figure change
82%, a write on an untouched record 76%, an emptied text field 32%, a dropped write 18%, a swapped recipient 14%, a cut
tail 10%; **pooled 45% (408 of 911, noops excluded)**. v1's "blind to most edits a user would object to" overstated the
pooled figure; the per-operator blind spots stand. Consequences: the lab's "false alarms" on these operators are often
true detections, and a pass-rate benchmark does not reward avoiding them.

### 3.3 Verifiers on the lab (1,319 items: controls and mutants; 543 officially failing, 776 passing)

| Verifier | Kill | False alarm (all passing) | AUROC | Severity ρ, exploratory: all / without controls and noops [95% task-cluster CI] | AUROC on the 360 stored rows |
|---|---|---|---|---|---|
| RL2 code checks | 461/543 (85%) | 196/776 (25%) | 0.849 | 0.68 / **0.67** [0.60, 0.75] | 0.765 |
| three-valued T1 | 467/543 (86%) | 208/776 (27%) | 0.870 | 0.71 / **0.70** [0.62, 0.77] | 0.786 |
| three-valued TC (post hoc) | 515/543 (95%) | 612/776 (79%) | 0.793 | 0.58 / 0.55 | 0.723 |
| independent reader 0 / 1 / 2 | 89% / 86% / 88% | 37% / 29% / 45% | 0.839 / 0.848 / 0.808 | core 0.66 / 0.68 / 0.57 | 0.707 / 0.731 / 0.656 |
| code-checks v1.1 (clock-blind) | 193/543 (36%) | 26/776 (3%) | 0.633 | 0.35 / 0.27 [0.16, 0.37] | 0.700 |
| code-checks @clock | 193/543 | 32/776 (4%) | 0.631 | 0.34 / 0.27 | 0.700 |
| non-empty diff | 57/543 (10%) | 0/776 | 0.552 | 0.39 / 0.23 | 0.566 |

The severity ρ is not an ATTACK metric and v1's version included the controls and the noops (severity 1, rejected by every
verifier); without them it drops by 0.01–0.16 and keeps its order. The mutant AUROCs of RL2, the three-valued verdict and
the readers (0.79–0.87) sit 0.07–0.15 above their AUROC on the real rows: the lab is easier than reality for them
(code-checks is the exception, 0.63 vs 0.70). Hiding the clock from code-checks cost no kill and
removed 6 false alarms.

**Sensitivity** (mutants of seeds whose control the verifier accepts, so a rejection is information, not a repeat):

| Verifier | Kill | False alarm | False alarm on true equivalents (drop_reads, reword) | Blind to |
|---|---|---|---|---|
| RL2 | 348/430 (81%) | 39/521 (7%) | 0/196 | duplicates (0/94 flagged), untouched-record writes (0/6 killed, 0/14 flagged), the forbidden row when the rubric passes it (4/72) |
| three-valued T1 | 339/415 (82%) | 36/509 (7%) | 0/190 | same (forbidden row 2/70) |
| code-checks | 176/525 (34%) | 3/633 (0.5%) | 0/236 | figures (0/14), emptied text (4/79), the forbidden row (0/111) |
| independent reader 0 | 310/370 (84%) | 30/436 (7%) | 0/164 | the forbidden row 2/60 |

Per assertion class (RL2, sensitivity): content 188/205 (0.92), prohibition 46/50 (0.92), existence 182/210, action-key
6/16, flag 6/6, other 37/61. ATTACK's Move 4 success bar for Δ\* ("kills ≥ 0.85 of official-failing prohibition and
body-content mutants at ≤ 0.10 false alarms on equivalent mutants where current checks are < 0.5") cannot discriminate
here: current RL2 already kills 0.92 of both at 0/196 false alarms on equivalents, so its "where current checks are < 0.5"
condition selects nothing in those classes. The lab's prohibition and content mutants are too easy; the forbidden-row
mutants are not prohibition mutants in the rubric's eyes (it passes 82% of them).

### 3.4 Twins (closure)

No verifier flips on any stability twin: permute 0/124, decoy_untouched 0/53, rename_untouched 0/51 (all officially
consistent). On decoy_touched (a fresh-id copy of a record the run acted on; 74 officially consistent), **no verifier rejects
the unchanged run: RL2 0/58, three-valued 0/58, independent readers 0/48, 0/52, 0/40, code-checks 0/74** where the control
was accepted. This is the code-enumerated closure gap ATTACK names (Move 1 (a)), measured: the stored ledger lists items,
not a universe with a disposition per member. The twin label is an inference (a rule over identity, order or counts would
break it) and the official rubric is blind to it by construction (3 of 77 changed grade, excluded).

### 3.5 Validity: does the lab's class ordering predict the real false-accept ordering?

Lab miss rate per class (officially failing mutants with that class among their failures that the verifier accepts; v2
excludes the noops) against the real false-accept rate per class (stored failing rows with that class among their failed
assertions that the verifier accepts); cells of at least 5 on both sides; 95% interval by resampling tasks on both sides:

| Verifier | content | prohibition | existence | action-key | flag | other | Spearman (k = 6) [95% CI] | P(ρ ≥ 0.5) | without flag |
|---|---|---|---|---|---|---|---|---|---|
| RL2 | 0.07 vs 0.18 | 0.08 vs 0.32 | 0.11 vs 0.32 | 0.48 vs 0.59 | 0.00 vs 0.83 | 0.30 vs 0.31 | **−0.03** [−0.43, 0.90] | 0.24 | 0.70 |
| code-checks | 0.69 vs 0.57 | 0.65 vs 0.76 | 0.52 vs 0.66 | 0.52 vs 0.47 | 0.50 vs 1.00 | 0.77 vs 0.75 | **−0.26** [−0.71, 0.80] | 0.14 | 0.30 |
| three-valued T1 | 0.07 vs 0.18 | 0.08 vs 0.29 | 0.10 vs 0.30 | 0.38 vs 0.44 | 0.00 vs 0.83 | 0.30 vs 0.31 | **0.14** [−0.60, 0.90] | 0.23 | 1.00 |
| pooled (RL2, code-checks, T1 × 6) | | | | | | | 0.36 (k = 18; cells share rows) | | |

(lab n per class: content 259, prohibition 51, existence 252, action-key 21, flag 6, other 79; real n: 95, 72, 118, 34, 12,
36.) **ATTACK's kill rule fires as written** ("the lab ordering does not match reality"): every point estimate is below
0.5. **It is also underpowered:** with six classes and a 6-item flag cell, dropping that one class moves RL2 to 0.70 and
T1 to 1.0, and every interval contains both 0 and 0.5. What is robust is the level, not the order: real false-accept rates
are at least the lab's miss rates in every RL2 class (1.0× to 4×; flag 0 vs 0.83), because real failures are mostly *wrong or unstated spec* (the actor and
the ledger read the rule the same wrong way) while trajectory mutants break what the ledger already states. The
distribution that would match reality is **spec mutants** (perturb the rule reading, not the trajectory). The useful parts
survive: stability and closure twins, the grader-blind-spot census, the sensitivity tables, and a regression bench for
Δ\* (any verifier can be re-scored on the same replays).

---

## 4. Move 6: κ, n_eff, the budget rule and the effort cost model

### 4.1 Agreement tables (stored rows; error κ = agreement of mistakes against the official label; 95% task-cluster bootstrap)

| Pair | Verdict κ (ATTACK's metric) | Error κ | Both wrong vs independent |
|---|---|---|---|
| Haiku judge – Sonnet judge (99 rows) | 0.65 [0.47, 0.81] | 0.64 [0.46, 0.79] | 0.26 vs 0.12 |
| Mercury judge – Sonnet judge (85) | 0.64 [0.49, 0.78] | 0.58 [0.38, 0.75] | 0.25 vs 0.12 |
| Haiku judge – Mercury judge (144) | **0.46** [0.33, 0.61] | 0.38 [0.18, 0.52] | 0.20 vs 0.12 |
| RL2 – Haiku judge (360) | **0.35** [0.23, 0.46] | 0.23 [0.09, 0.36] | 0.14 vs 0.09 |
| RL2 – code-checks | 0.33 [0.21, 0.43] | 0.32 [0.21, 0.45] | 0.23 vs 0.15 |
| code-checks – Haiku judge | 0.18 [0.11, 0.25] | −0.03 [−0.14, 0.06] | 0.12 vs 0.13 |
| RL2 – independent reader 0 / 1 / 2 | 0.63 / 0.70 / 0.60 | 0.59 / 0.65 / 0.56 | 0.24 vs 0.10–0.12 |
| independent reader – reader | 0.49–0.65 | 0.44–0.62 | 0.21–0.27 vs 0.10–0.12 |
| RL2 – reader 0's share of the merged ledger (v1's "reader") | 0.58 | 0.52 | 0.22 vs 0.11 |
| RL2 – tri-state | 0.94 | 0.93 | (tri-state is RL2 + code-checks: not a new path) |
| own checks – RL2 (120) | 0.04 | −0.02 | 0.17 vs 0.18 |
| own checks – Haiku judge (120) | 0.27 | 0.26 | 0.21 vs 0.15 |

The Haiku diff-only judge accepts 2% of rows (value 0.019 over chance): near-constant. **n_eff:** six forks 2.12 of 6
(reproducing Move 0); three independent RL2 readers 1.48 of 3 (their shares of the merged ledger: 1.51); four judges 2.07;
checks (own, code-checks, RL2, tri) 2.05; RL2 + Haiku judge 1.63. An independent reader is as accurate as the merged
ledger on these rows (balanced value 0.13–0.21 vs RL2's 0.20; in-sample) and shares most of its mistakes.

### 4.2 The rule applied (`infopath.admissionWalk`, κ_max 0.4, pairwise overlaps, in the order the program bought them)

The **decision of record** uses ATTACK's metric (verdict κ, point estimate; ATTACK's anchors 0.35 vs 0.61–0.70 are verdict
κ), excludes self-reports (RC3) and uninformative signals by rule, and marks a signal *fragile* when its bootstrap upper
bound crosses the bar:

| Signal | Decision of record (verdict κ, point) | Bound rule | Error κ, point (v1's metric) |
|---|---|---|---|
| RL2 | admit (first) | admit | admit |
| Haiku judge | admit, fragile (0.35 with RL2, upper 0.47) | held | admit |
| Sonnet judge | **refuse** (0.65 with the Haiku judge) | held | refuse |
| Mercury judge | **refuse** (0.46 with the Haiku judge) | held | admit, fragile |
| Haiku diff-only judge | excluded: uninformative (accept 2%) | excluded | excluded |
| code-checks | admit, fragile (0.33 with RL2, upper 0.46) | held | admit, fragile |
| independent readers 0 / 1 / 2 | **refuse** (0.63 / 0.70 / 0.60 with RL2) | refuse | refuse |
| own checks | excluded: self-report | excluded | excluded |

The record walk reproduces VERIFIER-LAB's chosen pair (RL2 + Haiku judge), adds code-checks, and refuses every further judge
and every same-family reader, which is what ATTACK §8 says to stop buying. v1's claim that its error-κ walk did this was
false (it admitted the Mercury judge, the near-constant judge and the self-report). Under the bound rule nothing but RL2 is
admitted at this n: the point decisions are directions, not certified purchases. **Why error κ is still reported:** two
accurate verifiers with independent mistakes have a high verdict κ (both follow the label), so ATTACK's metric can refuse a
genuinely new information path (`infopath.test.mjs` shows it). Re-anchoring the 0.4 bar on error κ is an owner decision, not
a silent default; the library now requires the metric to be named.

`budgetPaths` on the seven signals scored on all 360 rows (verdict κ; the Mercury judge has no price on record and is never
bought), at ≤ $0.01 per decision: both orders pick an independent reader (reader 1), code-checks and the Haiku judge (n_eff 2.41, $0.0035
per decision), refusing RL2 and the three-valued verdict because they share reader 1's verdicts (κ 0.70, 0.71). That pick
is in-sample (reader 1's balanced value 0.21 vs RL2's 0.20 on the same 360 rows) and is not a recommendation to drop the
merged ledger. Values are in-sample balanced accuracies; the rule, not the pick, is the
deliverable.

### 4.3 Effort cost model (`effort-cost.mjs`; prices from `policy/models.json` only)

| Arm (dev60) | $ / task | Node manifest | Recorded output tokens vs the range the cost implies |
|---|---|---|---|
| haiku-a0 | 0.0132 | haiku@UNSET | (no token record) |
| sonnet-a0 | 0.1006 | sonnet@UNSET | (no token record) |
| opus-a0-xhigh | 0.4071 | opus@xhigh | 174 vs 0 – 14,829 |
| haiku-a1 / sonnet-a1 | 0.0157 / 0.1153 | @UNSET | (no token record) |
| haiku-a1c | 0.0371 | haiku@UNSET (6 nodes) | 105 vs 13,338 – 55,561 |
| m3-a1c | 0.0155 + ~61K Mercury tokens | haiku@UNSET, mercury@UNSET | 79 vs 431 – 21,908 |

The implied range's upper end ignores cache charges (v1's only number); the lower end charges every cached input token at
the full input price and every uncached one at 1.25× (the most a cache can cost; the policy file lists no Haiku cache price,
so both ends are bounds). **The incomplete-record claim holds for haiku-a1c and m3-a1c (recorded below even the lower end)
and is withdrawn for Opus (its lower end is 0).** The one paired dose in the stored data: RL2 Haiku readers at reasoning low
(1,024 thinking tokens) vs medium (8,000), 15 pairs over 5 tasks: output tokens ×1.25 [1.10, 1.45], cost ×1.22 [1.03, 1.49]
per call. `projectCost` projects "RL2 readers low → medium" ($0.0183 per task for three readers) and refuses "Haiku session
UNSET → max" (no measurement): the Haiku-max lever of ATTACK Move 6 stays a paid, preregistered step.

---

## 5. What this means for the program

1. **Move order is 1 → 3, not 3 alone.** Three-valued release is the correct semantics and the honest product output, but on
   today's ledger it supports nothing: 4,727 of 6,486 assumptions are checks of obligations the readers did not establish and
   1,320 are model-only. Δ\* (closure, derivation, labelled nulls) is what turns them into decided obligations;
   requirement-ledger-v3 should be scored first on this lab's closure twins (target: decoy_touched flagged, 0 flips
   elsewhere) and on §2.2's table.
2. **D28 (1) release on RL2 v2 = "release on no FAILED" = precision 0.53 at 49% coverage.** It removes every false accept
   of the own checks from SUPPORTED, but "released" is not trustworthy; the assumption list must be shown, not hidden.
3. **Thresholds need real labels.** The lab-calibrated threshold is 3.9× optimistic (2.3× of it base rate). Release
   thresholds are set on looks 2–3 under the frozen sequential plan, never on mutants.
4. **Selection:** the lexicographic key ties the best measured rule on P2 without a judge, by one task; VL-1's frozen R3 on
   look 2 is the test that matters (not touched here).
5. **Graders pass duplicates, the forbidden row and over-action**; Move 2's effect identity and gate remain necessary even
   when the benchmark does not reward them.
6. **κ rule:** adopt `infopath.admissionWalk` (metric named, self-reports and uninformative signals excluded) as the gate for
   any new reader, fork, judge or check; report n_eff beside every aggregate. The owner chooses the metric the 0.4 bar
   lives on (§4.2).

---

## 6. What is left, and why

- **Δ\* is not here.** Move 1's requirement-ledger-v3 lives on another branch; `tristate/adapters.mjs` and
  `mutlab/verify.mjs` take one more verifier function to score it on the same replays (manifest sha256 `b5aeead8…`; job file `213ebb8e…`, paths under the work directory).
- **Paid steps not run** (each needs a preregistration first, within D22): judge arms on the mutants (ATTACK ≤ $1); RL2
  re-extraction without the clock (to finish D28 (2) for RL2); the Haiku `max` dose and the Opus × conventions 2×2 (D19/D22).
- **Certified release thresholds** need look-2/look-3 labels under SEQUENTIAL-PLAN-v1; nothing here reads them (VL-1 and A1-C v2
  P1 are live and frozen).
- **Spec mutants** (the distribution the validity check asks for: perturb the rule reading, not the trajectory) are designed
  in §3 but not built.
- **Owner decisions:** the PREREG-AB-v1 amendment for verdict and abstention metrics should adopt §2.1's v2 definitions;
  whether to re-anchor the κ bar on error κ (§4.2); a Mercury shadow price (D28 (7)).
- **Inputs are scratch artefacts.** The stored lab, RL2 outputs, code-check facts and judge journals sit in the session
  scratchpad (as in VERIFIER-LAB §8); every output records their sha256. The replay work directory was deleted at the end
  (disk is shared and tight); the replays are deterministic from the committed code and those inputs.

## 7. Reproduce ($0)

```
S=<session scratchpad>; W=$S/m346fix/lab
node experiments/autobench/verifier/tristate/run.mjs --vlab $S/vlab --rl2 $S/rl2-out --cc-facts $S/cc-out/facts.json \
  --strata research/blockers-20261021/move0/dev60-ceiling-strata.json --out research/blockers-20261021/move346/tristate.json
node experiments/autobench/verifier/mutlab/jobs.mjs --vlab $S/vlab --out $W          # 1,624 jobs (paths under $W)
awk 'NR%2==1' $W/jobs.jsonl > $W/jobs0.jsonl; awk 'NR%2==0' $W/jobs.jsonl > $W/jobs1.jsonl
bash experiments/autobench/verifier/mutlab/replay.sh $W/jobs0.jsonl $W/out0.jsonl $W/worlds $S/live0 &   # needs corpus/AutomationBench
bash experiments/autobench/verifier/mutlab/replay.sh $W/jobs1.jsonl $W/out1.jsonl $W/worlds $S/live1; wait
node experiments/autobench/verifier/mutlab/verify.mjs --vlab $S/vlab --rl2 $S/rl2-out --cc-facts $S/cc-out/facts.json --work $W --out $W/verdicts.jsonl
node experiments/autobench/verifier/mutlab/score.mjs --vlab $S/vlab --work $W --verdicts $W/verdicts.jsonl --out research/blockers-20261021/move346/mutlab.json
node experiments/autobench/verifier/kappa/tables.mjs --vlab $S/vlab --verdicts $W/verdicts.jsonl --work $W --out research/blockers-20261021/move346/kappa.json
node experiments/certify/effort-cost.mjs --rl2 $S/rl2-out --out research/blockers-20261021/move346/effort-cost.json
nice -n 15 node --test --test-concurrency=1 <each of the five test files>
```

---

## 8. Review findings (v1 @ `3ff42399`) and what was done

| # | Finding (severity) | Disposition | Evidence after the fix |
|---|---|---|---|
| 1 | Soft passes SUPPORTED, soft failures UNKNOWN; T2 inverted (high) | **Fixed** (tristate-v2): a check of an unestablished obligation is UNKNOWN both ways in every pre-declared policy; TC (decides both ways) added as post hoc; test pins both and runs the v1 rule | SUPPORTED 2 → 0 of 360; θ 0.25 point 24.4%/0.614 → 4.7%/0.765 (the reviewer's number); TC releases 56 at 0.625 (the reviewer's number); P2 34 (see 3) |
| 2 | A verdict with no obligation is released (medium) | **Fixed**: release needs ≥ 1 obligation; `vacuous` counted | code-checks alone: 164 rows held as vacuous (190 `@clock`); release 121 at 0.347 instead of v1's 282 at 0.422 |
| 3 | "673 unexplained effects" overstated (medium) | **Fixed** (adapters-v2): every effect a passing positive check matches is explained; id-less effects can be; a same-addressee same-content repeat is a `duplicate-effect` | 673 → 355 unexplained + 34 duplicates; first match equals the frozen evidence in 6,789/6,789; with v1's explanation and the soft fix P2 is 33 (+5/−1), with both fixes 34 (+5/−0) |
| 4 | The kill clause cannot fire (medium) | **Fixed**: every UNKNOWN kind classified (observable / unobservable / unclassified) and the unclassified bounded (`killClause`) | T1 not triggered by a bound (judged-only 20.4% of UNKNOWN); TC not evaluable (75%) |
| 5 | Verifiers see the hidden clock (medium) | **Fixed for code, disclosed for RL2**: `viewOf` withholds `today`; code-checks clock-blind by default (`ccClock`, `businessToday`, labelled nulls), `@clock` kept; RL2's stored extractions saw the clock and cannot be redone at $0 | both versions reported (§2.2, §2.6, §3.3): 50 labelled nulls in the reported rows (74 of 542 lab rows); release 175 → 176; lab false alarms of code-checks 32 → 26 |
| 6 | Admission on error κ admits provisional signals; claim false (medium) | **Fixed, with a disagreement recorded**: decision of record on verdict κ (ATTACK's metric, point), self-reports and uninformative signals excluded by rule, the bound rule never admits a provisional signal; metric must be named. Error κ is still argued to be the better redundancy measure (test), but moving the bar is the owner's call | record walk refuses Sonnet, Mercury and all readers (§4.2); the claim is now true of the record walk and stated as false of v1's |
| 7 | Decision code untested (medium) | **Fixed**: `run.mjs`, `score.mjs`, `tables.mjs`, `infopath.admissionWalk` and `verify.shapeOf` are exported functions with fixture tests; mutation check over the review fixes | 50 tests; 22 of 22 mutants killed (one test strengthened after a survivor) |
| 8 | "3.7×" mixes base rate with miss rate (low-medium) | **Fixed**: `labCalibration` reports base rates, miss and pass-accept rates and splits the gap | 3.95× = 2.26× base rate × 1.75× miss rate; miss ratio 2.48 |
| 9 | Class-validity kill fragile (low-medium) | **Fixed in reporting**: noops excluded, task-cluster bootstrap interval, P(ρ ≥ 0.5), leave-one-class-out | kill still fires on the points; intervals contain 0.5; flag decides the sign (§3.5) |
| 10 | Operator labels overclaim (low-medium) | **Fixed**: dup only of sends/creates (`writeKind`); one-digit number move; wording corrected and pooled figure reported | dup 80 sends + 41 creates (none update-like); pooled blind spot 45%, not "most" |
| 11 | No "forbidden row" operator (low-medium) | **Built**: `extra_create` (114 mutants) | rubric passes 82%; RL2 flags 4 of 72 of the passing ones |
| 12 | Headline manifest incomplete, cost null (low-medium) | **Fixed**: both forks' pipeline nodes, the RL2 readers (reasoning low), the facts or judged-check call, $ per task | §2.5 table; conforming: no (legacy forks, unrecorded temperatures and verifier caps listed) |
| 13 | Reader signals not independent (low) | **Fixed**: `rl2ReaderLedgers` compiles each reader alone; the share signal kept as `readerShare` for comparison | independent readers n_eff 1.48 (shares 1.51); κ with RL2 0.60–0.70 |
| 14 | Severity ρ post hoc and inflated (low) | **Fixed**: labelled exploratory; reported without controls and noops | RL2 0.68 → 0.67, code-checks 0.35 → 0.27, non-empty 0.39 → 0.23 |
| 15 | Statistics details (low) | **Fixed**: failures scaled to n_eff round up; header updated; risk null when nothing is released | test with the reviewer's example (0.39 → 0.58) |
| 16 | Replay fidelity only at the pass label (low) | **Fixed**: per-verifier verdict differences, diff shape, call errors | §3.1: ≤ 1 of 124 per verifier; shapes 121/124; call errors equal |
| 17 | Hygiene ordering (low) | **Fixed**: allowlist before any read in `effort-cost.mjs`; resolved-path checks for host and prep (`labio.underRun`, used by `jobs.mjs`) | tests run a forbidden run without a launch file and a `..` path that passed v1's substring check |
| 18 | Evidence and wording (low) | **Fixed**: implied-output range with a cache bound; Mercury unpriced (not bought); look-1 refutation quoted on ATTACK's metric, θ curve labelled | Opus incomplete-record claim withdrawn (lower bound 0) |
| 19 | Bytecode in frozen directories (low) | **Fixed**: `replay.sh` runs python with `-B`; the test's python helpers too; the three stray `.pyc` files (git-ignored) removed | no `__pycache__` after the 1,624 replays |
