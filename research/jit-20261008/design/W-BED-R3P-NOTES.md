# W-bed R3′: the planted-defect sweep bed

*2026-10-14, cloud session. Cost $0: no model calls. `beds/sealed/` was not read. Design references: PROOF-LEDGER J5 (the
bed) and J4 (arm c′); [PRIOR-ART-MANAGED-AGENTS-DW.md](PRIOR-ART-MANAGED-AGENTS-DW.md) §1 (the benchmark row), §3.H and
§4; [W-BED.md](W-BED.md) §2, §2.4, §3.3, §3.8, §5, §6 and §8. Conventions follow
[W-BED-R5-NOTES.md](W-BED-R5-NOTES.md) and [W-BED-R2R3-NOTES.md](W-BED-R2R3-NOTES.md). Tags: **[M]** means measured
here or read in the repo, **[I]** means inference, **[S]** is PRIOR-ART's secondary-source tag (their benchmark has no
primary source). Every number marked [M] comes from the test diagnostics in §13 or from the scratch runs described where
it is quoted.*

## 0. Summary

- **What it is.** A seeded generator of fictional JavaScript repositories. Defects of stated classes are planted in
  them, together with decoys (correct code that looks wrong) and one or two defective shared helpers whose callers
  inherit the misbehaviour. A hidden manifest lists every defect as (file, function, class).
- **How it is scored.** Exactly: precision, recall and F1 per class and pooled, every false positive attributed to a
  cause, and cost per verified finding from the host's cost. Pass needs precision ≥ 0.90 and recall ≥ 0.80.
- **Why it is honest.** Every manifest entry is proved by running code:
  - each defect differs from the correct function on a valid input (the bed's witness);
  - each decoy equals the correct function on every probe;
  - each caller of a defective helper is classified, by execution, as inheriting the defect or not.
- **The shape.** Their benchmark's shape (PRIOR-ART §1 row "Benchmark"): planted defects in a repository, fan-out per
  file, verify before report. Here the manifest is exact and hidden, so precision, recall and cost per verified finding
  are scored, not self-reported.
- **Controls.** All 15 fail at d2–d5 on 20 seeds each. The reference passes with precision and recall 1, and all of its
  witnesses reproduce [M].

## 1. Files

| path | what |
|---|---|
| `beds/wbed/r3p/index.mjs` | family `wbed-r3p` v1.0.0. The bed interface plus `stages`, `relations`, `composedOracle`, `referenceTrace`, `structure`, `invariants`, `necessityControls`, and the sweep exports `manifestOf`, `trapsOf`, `checkWitness`, `costPerVerifiedFinding`, `aggregateSweeps`, `impactManifestOf`, `callLogFor`, `scoreImpact`, `scoreReplay`, `sizeOf`, `skimmedBy`, `taskTokens` |
| `beds/wbed/r3p/vocab.mjs` | the 9 classes and their definitions (stated in the task), `LEVELS`, classes in scope per difficulty, house conventions, repository areas, comment pools |
| `beds/wbed/r3p/families.mjs` | 49 function families: 36 can host a defect, 29 a decoy, 13 are fillers. Each has a contract, a parameter domain, correct bodies in one or two styles, defect and decoy variants, and probes |
| `beds/wbed/r3p/exec.mjs` | `node:vm` execution of generated functions on JSON arguments, the observation (return value or error name, plus arguments after the call), and the domain validator |
| `beds/wbed/r3p/world.mjs` | `buildSweep`: files and slots, role planning (helper defects, class quotas, balanced placement, decoys), instances, proof by execution, tests and comments, the decisiveness re-draw |
| `beds/wbed/r3p/render.mjs` | repository text: `src/**.js` with JSDoc, `test/**.test.js`, `docs/CONVENTIONS.md`, `README.md`, `package.json`; function spans; prompt; inputs |
| `beds/wbed/r3p/score.mjs` | `outputSchema`, `scoreSweep` (exact), `witnessHolds`, `costPerVerifiedFinding`, `aggregateSweeps` |
| `beds/wbed/r3p/pipeline.mjs` | the exact solver as stages: inventory → candidates (per file) → verify (per suspect) → reduce (root cause, report); options reproduce mistakes |
| `beds/wbed/r3p/stages.mjs` | stage contracts and oracles, relations V1–V4, `composeOracle` |
| `beds/wbed/r3p/controls.mjs` | 12 bad controls and 3 necessity controls |
| `beds/wbed/r3p/lint.mjs` | text-only tools: `parseFunctions`, 19 linter rules, the TODO grep, report-everything |
| `beds/wbed/r3p/impact.mjs` | the retroactive sweep (F2): impact sets, a deterministic production call log, exact scorers |
| `beds/wbed/r3p/r3p.test.mjs` | 29 oracle-health tests |
| `beds/wbed-r3p/index.mjs` | one-line registration shim; `loadFamily('wbed-r3p')` works (tested) |
| `beds/wbed/attacks/triviality.mjs` | **modified**: rung table gains `r3p`, with its own attack seeds (479–490). `plan()` uses a rung's own seeds when none are passed, and the CLI no longer forces 379–390 |
| `research/jit-20261008/SEED-LEDGER.json` | **modified**: three new rows (§7) |

No lib file and no other bed changed.

## 2. The task

A task is one repository of a fictional back-office library, `@<org>/<package>`, delivered as `task.files`:
- `src/<area>/<file>.js` for the areas billing, payments, calendar, export, platform, reporting and customers;
- `src/lib/money.js` and `src/lib/dates.js`;
- `test/**/*.test.js`, `docs/CONVENTIONS.md`, `README.md` and `package.json`.

Every exported function has a JSDoc contract. Each `@param` states its domain (for example "integer from 1 to 10", or
"date YYYY-MM-DD, years 1600-2400"). `docs/CONVENTIONS.md` states the house rules, and three of them are drawn per task:
- the rounding of halves: away from zero, or to even;
- band ends: inclusive, or half-open;
- the page base: 0 or 1.

Contracts can defer to the house rules, so the same code is correct in one task and a defect in another.

The repository is real code [M]:
- every module imports;
- the generated suite passes under `node --test` against the planted code (167/167 on d5 seed 405), because tests
  use only inputs on which the planted and the correct function agree;
- at least 30% of the defective functions have green tests.

**Inputs.** `package`, `source_files`, `defect_classes` (the codes in scope, with definitions) and `sweep_spec` (seven
rules: scope, what a defect is, decoys, root cause, finding format, one class, scoring).

**Answer.** `{findings: [{file, function, class, line?, witness?: {args}}]}`, where a witness is a list of arguments
the contract allows on which the function misbehaves. The root-cause rule is stated: when a function misbehaves only
because a function it calls is defective, the finding goes to the callee.

## 3. Why one language, and why JavaScript

1. **The manifest must be exact.** The generator runs both the planted and the correct body of every planted function
   (`exec.mjs`, `node:vm`). That is the only way to prove every defect is real and every decoy is correct, at $0, with
   no new dependency. A second language needs a second runtime inside the bed (CONTRACT: no new npm deps).
2. **Witnesses are checked the same way.** The oracle runs a finding's witness on the planted and the correct function.
3. **The solver sandbox has Node**, so verify-by-execution is open to every arm, as it is in their benchmark.
4. **What is lost:** language variety. The classes are language-neutral, so a Python track is a render target plus a
   runtime, deferred (§16).

## 4. Classes, decoys and drift

| class | first at | defect hosts (families) | decoy hosts | share without a visible pattern [M] |
|---|---|---|---|---|
| OFF_BY_ONE | d2 | 11 | 5 | 80/165 |
| LOGIC_ERROR | d2 | 5 | 5 | 140/164 |
| MISSING_GUARD | d2 | 7 | 5 | 45/174 |
| ROUNDING | d2 | 5 (incl. the money helper) | 3 | 156/180 |
| INPUT_MUTATION | d3 | 4 | 4 | 0/136 |
| DATE_ARITH | d4 | 3 (incl. the dates helper) | 2 | 102/102 |
| ESCAPING | d4 | 3 | 2 | 83/96 |
| SWALLOWED_ERROR | d5 | 2 | 2 | 18/50 |
| UNIT_MISMATCH | d5 | 4 | 1 | 53/53 |

The last column is measured over d2–d5 × dev 401–420, 1,120 defects; 677 (60%) show no visible pattern [M]. "Without
a visible pattern" means the planted code reads as ordinary code, and only a comparison with the contract shows the
defect. Examples: `Math.round` under a half-to-even house rule; a leap year computed as `y % 4 === 0`; `< hi` where
the band includes `hi`.

**Decoys.** Every decoy carries a pattern of its class, for example:
- `< hi + 1` on an inclusive integer band;
- `!(a || b)` (a negated compound);
- `x.length && sum / x.length`;
- `(a * p / 100) | 0` on values bounded far below 2³¹;
- `items.sort(...)` under an "in place" contract;
- `Object.assign({}, …)`;
- `new Date(Date.UTC(y, m, 0))`;
- `split('"').join('""')`;
- a `try`/`catch` that returns `null` where the contract says "returns null".

Some decoys equal a defect in their text and differ only in the contract they sit under: an in-place sort under an
"in place" contract is a decoy, and the same line under a "new array" contract is a defect. As many decoys as defects
are planted, all of in-scope classes.

**Helpers.**
- Every task has one defective helper (two at d5, one or two at d4):
  - `roundMinor`, ROUNDING (`Math.round`, or the other house rule);
  - `daysInMonth`, DATE_ARITH (leap rule), from d4.
- Callers that pass inputs that trigger the defect inherit it: `line-amount` for money; `add-months` and `month-end`
  for dates.
- Callers of the money helper that sum integers before rounding (`sum-lines`) are provably unaffected.
- There are at least ⌈(D+1)/9⌉ inheriting callers, so reporting them breaks precision. D is the number of planted
  defects.

**Drift: new classes only at higher difficulty.**
- d2: four classes;
- d3: adds INPUT_MUTATION;
- d4: adds DATE_ARITH and ESCAPING, and the dates helper can be the defective one;
- d5: adds SWALLOWED_ERROR and UNIT_MISMATCH.

Streams switch from d3 to d4 at task 17 (W-BED §2.5), so two classes the stream has never seen appear at the drift
point. The test checks that every in-scope class is planted in every task, and that no defect is of a class out of
scope [M].

## 5. The hidden manifest and the oracle

**Manifest.** `{id, file, function, class, family, variant, smell, witness}` per defect. It is built by
`buildSweep(seed, split, d)` and never enters the task.

The leak test checks four things:
- no class code appears in any repository file;
- no manifest function is named in the prompt or the inputs;
- the comment pools contain no class words;
- TODO comments sit on defects as often as anywhere, within 0.08.

**Matching.** A finding is verified when `(file, function, class)` equals a manifest entry, with three
normalisations: the path is lower-cased and loses a `./`, `files/` or `repo/` prefix; the function name is trimmed; the
class must match exactly. `line` and `note` are ignored.

**Pass rule.** `precision ≥ 0.90 and recall ≥ 0.80`, micro over the classes in scope. `score` = micro F1. Tested at the
edges [M]:
- recall: 20/24 passes, 19/24 fails;
- precision: one false positive on 10 defects passes (10/11), two fail.

**Details.**
- Per class: tp, fp, fn, precision, recall and F1, plus micro and macro F1.
- **False-positive causes:**
  - duplicate;
  - unknown location;
  - out-of-scope class;
  - wrong class on a real defect;
  - a caller that only inherits;
  - a decoy;
  - a clean function.

  This is what separates "did not verify" (decoys) from "did not attribute the root cause" (callers) from
  "misclassified".
- **Witnesses**, on verified findings only:
  - the arguments must lie in the function's stated domain; nothing outside the domain is executed;
  - the planted and the correct function must then differ;
  - the counts kept are given, valid (`witnessed`), outside the domain, and no difference.

  A bad witness never cancels a verified finding.

**Cost per verified finding.** `costPerVerifiedFinding(result, costUsd)` and `aggregateSweeps(rows)`. The second gives
pooled per-class and micro P/R/F1, the pass rate, and Σ cost / Σ verified findings, with failed tasks' cost included.
Cost is an argument from the host journal and is never read from the solver's output (W-BED §7.3, N20-W2).

## 6. Stages, relations, composed oracle

| stage | owns | stage oracle |
|---|---|---|
| `inventory` | files → exported functions with spans (code; `parseFunctions` reproduces the generator's spans exactly, tested) | exact function set per file |
| `candidates` | per file: suspects with a class (the per-file judgment) | every defect is a suspect with its true class; extra suspects allowed |
| `verify` | per suspect: reproduced or not, with a witness (run) | the verdict equals the truth: a defect, or a caller inheriting one |
| `reduce` | root cause and report (code) | local only: one finding per function, classes in scope |

Relations:
- **V1** sweep coverage: every file swept once.
- **V2** verify before report.
- **V3** root cause: no reported caller whose reproduced callee explains it.
- **V4** fan-in conservation: every reproduced, non-inherited suspect is reported.

`composedOracle` is the AND of the four stage oracles and V1–V4. On every control trace it agrees with the end-to-end
oracle. Every stage control fails a stage oracle. Every relation control, and `fan-out-no-root-cause`, passes all four
stage oracles and fails a relation (tested on d2–d5) [M].

## 7. Seeds

The rung had no rows in `SEED-LEDGER.json`, because the `wbed-*` rows list `wbed-r0` to `wbed-r6` and `wbed-rh`. Three
rows were added. Each is disjoint from every other bounded range, and from R4's child seeds (≥ 1,000,000, whose test
asserts they lie outside every bounded range):

| id | split | seeds | status | use |
|---|---|---|---|---|
| `wbed-r3p-dev` | dev | 401–490 | fresh, allow jit-dev | the wbed-dev layout shifted by 100: stream A 401–424, stream B 425–448, out-of-sample 449–472, reference fixtures 473–478, attacks 479–490 |
| `wbed-r3p-heldout-a` | test | 8601–8624 | reserved, jit-heldout | held-out stream A (J4) |
| `wbed-r3p-heldout-b` | test | 8701–8724 | reserved, jit-heldout | held-out stream B (second lineage) |

What uses which seeds:
- the tests: dev 401–420 (and 489 for the runtime test);
- the attack plan: 479–490;
- the held-out spot check: 8601 and 8701 at d4, as generation only (no arm, no score claim).

`seedRefusals` returns none for `wbed-r3p` on 401 / jit-dev and 8601 / jit-heldout [M].

## 8. Controls and their results

Each control's best F1 over dev 401–420 is in the table [M]. Every control fails on every seed at every difficulty it
applies to.

| control | kind | what | best F1 d2 / d3 / d4 / d5 |
|---|---|---|---|
| `empty` | text | no findings | 0 / 0 / 0 / 0 |
| `shuffled-or-corrupted` | text | reference findings with locations rotated by one | 0.33 / 0.40 / 0.31 / 0.33 |
| **`grep-for-TODO`** | text | every function containing TODO/FIXME/XXX/HACK | 0.25 / 0.13 / 0.06 / 0.04 |
| **`linter-only`** | text | 19 regex rules (eslint-style plus a money plugin), computed from the files alone | 0.67 / 0.62 / 0.36 / 0.29 |
| **`report-everything`** | text | every function × every class in scope | 0.07 / 0.04 / 0.02 / 0.01 |
| **`single-pass-no-verify`** | stage | one reading pass: every site with a visible pattern (the patterned defects and all decoys), nothing verified | 0.50 / 0.57 / 0.44 / 0.40 |
| `class-confused` | stage (near miss) | all defects found and verified; OFF_BY_ONE ↔ LOGIC_ERROR swapped | 0.67 / 0.80 / 0.75 / 0.83 |
| `file-level-only` | stage | right file and class, pinned to the file's first function | 0.55 / 0.46 / 0.56 / 0.46 |
| `budget-half-files` | stage | the sweep stops after half the files | 0.73 / 0.75 / 0.77 / 0.51 |
| `tested-means-clean` | stage | functions with green tests skipped | 0.80 / 0.82 / 0.81 / 0.80 |
| `report-ignores-verdict` | relation (V2) | verification right, every suspect reported | 0.67 / 0.67 / 0.67 / 0.67 |
| `verified-dropped-at-fan-in` | relation (V4) | the middle third of the files lost at fan-in | 0.80 / 0.82 / 0.81 / 0.83 |
| `sequential-single-context` | necessity (d ≥ 4) | one context, skims past 24K tokens | — / — / 0.81 / 0.45 |
| `fan-out-no-verify` | necessity | per-file fan-out, no verification: every decoy reported (precision 0.50, recall 1) | 0.67 / 0.67 / 0.67 / 0.67 |
| `fan-out-no-root-cause` | necessity (V3) | verification, no root-cause fan-in: inheriting callers reported | 0.92 / 0.91 / 0.89 / 0.77 |

The four controls the brief requires are in bold. They fail as required:
- **`grep-for-TODO`** fails by construction: comments are placed independently of the roles, so its precision is the
  base rate.
- **`report-everything`** has recall 1 and precision under 0.04.
- **`linter-only`** cannot see the 60% of defects with no visible pattern, and it flags every patterned decoy and much
  clean code. For example, `Math.round` in money code is flagged even when the house rule is half away from zero and
  the function is correct.
- **`single-pass-no-verify`** reports every decoy, so its precision is at most 1/2.

The near misses (`class-confused`, `tested-means-clean`, `fan-out-no-root-cause`) reach F1 0.80–0.92. They fail only on
the threshold, which is the intended difficulty.

Two controls pick up a second failure at d4–d5. When `src/lib/` lies in the part of the repository they never read,
the inheriting callers look like root causes:
- `budget-half-files` reaches precision 0.40–0.44 at d5;
- `sequential-single-context` reaches precision 0.35–0.39 at d5.

**Decisiveness.** The generator re-draws a repository until every applicable control fails. Over the full test run
this took 15 re-draws in 390 attempts (3.8%), all because `verified-dropped-at-fan-in` would have passed: the middle
third of the files held too few defects [M]. No other control ever needed a re-draw. Class quotas, balanced
placement over thirds of the files, a 30% minimum of tested defects and the inheriting-caller minimum make the rest
decisive by construction.

## 9. Necessity and the triviality gate (W-BED §2.4)

1. **One call.** `triviality.mjs --rung r3p` plans 12 attack seeds (479–490) × 2 efforts. Inline prompt sizes [M]:
   - d3: mean 17.1K tokens (15.4K–17.9K);
   - d4: mean 40.4K;
   - d5: mean 60.9K.

   Token-priced cost of the 24 calls: $0.111 at d3, $0.176 at d4, $0.236 at d5. The R1-measured per-call overhead
   is $0.62–0.72. Not run (paid). The gate is one call ≤ 2/12. A one-call sweep at d3 is the open risk: 17K tokens is
   small. The bet is that precision fails on decoys and callers. If one call passes > 2/12 at d3, the rung is admitted
   only from d4 and the stream starts there.
2. **A 20-line deterministic script.** `linter-only` and `grep-for-TODO` are such scripts, computed from the files
   alone, and both fail on every seed.
3. **Structure necessity.** Each of the rung's three features has a control:
   - fan-out: `sequential-single-context`, size-gated d ≥ 4, fails 20/20 at d4 and d5;
   - verify before report: `fan-out-no-verify` fails 20/20 at every difficulty (precision 0.50);
   - root-cause fan-in: `fan-out-no-root-cause` fails 20/20 at every difficulty (precision 0.62–0.86).

   The attack driver's stub verdict for `fan-out-no-verify` is 0/12 ("gate holds").
4. **White-box script: reported, not gating.** A script with the generator source recognises the planted variants by
   their text. There are 36 defect-hosting families with about 60 variants, so such a script would pass. The rung tests
   contract judgment only for solvers without the source, as for synth (W-BED §2.4 item 4, O13).

## 10. Measured sizes and runtime

Means over dev 401–410 [M]:

| d | source files | functions | source lines | defects / decoys | inheriting callers | tested functions | inline tokens | files skimmed (24K budget) |
|---|---|---|---|---|---|---|---|---|
| 2 | 8 | 48 | 636 | 6 / 6 | 1 | 17 | 8,146 | 0 |
| 3 | 16 | 110 | 1,457 | 10 / 10 | 2 | 42 | 16,874 | 0 |
| 4 | 32 | 283 | 3,726 | 16 / 16 | 8 | 103 | 40,378 (38.8K–41.5K) | 11 |
| 5 | 48 | 429 | 5,681 | 24 / 24 | 15 | 166 | 60,929 (58.8K–63.6K) | 28 |

Runtime, d5 cold [M]:
- `generate`: 0.44–0.73 s, including the proof by execution and every control's decisiveness check;
- `oracle`: 7–16 ms with all 24 witnesses run.

Both are under the CONTRACT's 2 s.

## 11. How arm (c′) versus arm (g) is scored on this bed (PROOF-LEDGER J4)

**Stream.** Per lineage, 24 tasks: 16 at d3, then 8 at d4, the drift point where DATE_ARITH, ESCAPING and the dates
helper appear.
- Rehearsal: dev 401–424 (lineage A) and 425–448 (B).
- Claim: held-out 8601–8624 and 8701–8724.

**Arms.** The same tasks in the same order on identical sandboxes:
- **(c′)** Opus writes a sweep program per task: their shape, fan-out per file and verify before report;
- **(g)** Haiku plus the library, composed from the L1 patterns: map over files, judge, a run-the-witness step, a
  root-cause step and a code reduce;
- **(a)** JIT H/H;
- floors: **(d)** the Haiku agent, and the bed's controls at $0.

**Per task.**
- The oracle gives pass, micro and per-class P/R/F1, the false-positive causes and `witnessed`.
- The host journal gives construction cost (the program or the composition) and run cost.

**Per stream, per arm.**
- Verified success: the pass rate.
- **Cost per verified finding**: Σ (construction + run) / Σ verified findings (`aggregateSweeps`).
- Construction cost per task.
- Post-drift recall on the two new classes: does the arm adapt, or keep sweeping for the old classes?
- The false-positive profile: decoys measure verification quality; callers measure fan-in quality.

**Decision.** As PRIOR-ART §4:
- (g) is within 10 points of (c′) on verified success at ≤ 1/5 of (c′)'s construction cost, in both lineages.
- Success is read with the stats.mjs `DECISION_RULE` (McNemar plus the lineage-clustered bootstrap).
- Cost per verified finding is read with a paired bootstrap over tasks, clustered by lineage.

**Their number in our terms.** "66/70 in three runs" is recall 0.94, with precision and tokens unreported. On this bed
the same recall with no verification or no root-cause step scores precision 0.50–0.86 and fails. That is the gap J5
was added to measure.

**Expected per-task cost [I].**

| arm | per-task cost | basis |
|---|---|---|
| one Haiku call | $0.005–0.01 | token-priced, §9 |
| reference on Haiku | $0.02–0.06 | 16–48 per-file judges of about 1.5–2.5K tokens each, about 30–50 witness judges, and code |
| Haiku agent | $0.1–0.5 | re-reads 17–61K tokens per turn |
| (c′), Opus construction | $0.5–2 | one program per task |
| (c′), run on Haiku workers | about the reference's cost | — |

## 12. How a retroactive sweep is scored on this bed (PROOF-LEDGER F2)

The latent-defect story of LIBRARY §7.5, mapped onto R3′:
- **the latent defect** is a defective shared helper;
- **the callers** are library entries that call it;
- **the past outputs** are a production call log.

All three are exact, because everything runs:
1. **Detection.** `oracle` on the repository, as above.
2. **Impact.** `impactManifestOf(task)`, scored by `scoreImpact(task, {impacts: [{file, function, affected: […]}]})`.
   - Per defect, the callers that inherit it, proved by a differing probe.
   - The callers that call the helper but cannot trigger it: `sum-lines` passes whole numbers to a rounding helper.
   - Marking every caller of the defective module over-marks; the test checks precision < 1.
3. **Replay.** `callLogFor(task)` is a deterministic log of recorded calls (valid arguments plus the output the planted
   code returned) for every defect, every caller of a defective helper, and clean distractors.
   `scoreReplay(task, log, {wrong: [ids]})` scores the marked calls against the truth: the recorded output differs from
   the correct output.
   - Marking every recorded call of an affected function over-marks, because many recorded inputs never hit the
     defect; tested.
   - Marking nothing loses recall.
4. **Relabelling the judgments that admitted the outputs** (LIBRARY §7.5's third step) is not modelled in v1. It needs
   a library with judgment records, which this bed does not have.

T4b (BUILD-ORDER step 8) can run on this bed today with synthetic planted defects:
- the sweep under test gets the confirmed defect and the call log;
- it is scored by steps 2 and 3, with cost per affected output found.

J2's mined defects replace the planted ones once there are accepted solvers. This bed's scorers then apply unchanged
to any executable callee.

## 13. Test run

`node --max-old-space-size=1536 --test --test-concurrency=2 beds/wbed/r3p/r3p.test.mjs beds/wbed/attacks/triviality.test.mjs`:
**35/35 pass**: 29 for R3′ and 6 for the attack driver [M]. Alone, `r3p.test.mjs` passes 29/29 in 143 s at concurrency 1.

The 29 R3′ tests cover:
- interface;
- portability;
- determinism, also in a fresh process;
- the reference and every control on 20 seeds per difficulty;
- per-family domain and role coverage;
- the manifest proved by execution: over d2–d5 × 401–406, 336 defects, 336 decoys, 162 inheriting callers and 70
  unaffected callers;
- the control inventory;
- text controls read only the files;
- relation and necessity behaviour;
- sizes;
- drift;
- no leak;
- oracle edge cases and thresholds;
- witness execution;
- the composed oracle agreeing with the end-to-end oracle;
- stage contracts;
- the parser equal to the spans;
- the repository as real code: `node --test` green, witnesses reproduce identically in real Node and in the vm;
- cost aggregation;
- F2 scoring;
- seed-ledger disjointness;
- the attack plan;
- the held-out split;
- runtime.

The full W-bed suite, `node --test --test-concurrency=2 'beds/wbed/**/*.test.mjs'`, passes **186/186** in 386 s, with
R0–R6 and the attack driver all green [M].

The two suites outside `beds/` that read the ledger:
- `experiments/jit/test/stream.test.mjs` S0-5: 2/2 pass;
- `experiments/kev-data/test/seed-ledger.test.mjs`: 1/2 pass (the failure is explained next).
`experiments/kev-data/test/seed-ledger.test.mjs` test 2 already failed before this change, because the `wbed-*` rows
were added without updating its expected list. This change adds three more ids to the same list. It is not fixed here
(not my file).

## 14. Deviations, and why

1. **One language, not several** (§3). Exactness needs execution.
2. **Density.** Theirs is 70 defects in about 116K lines, 0.6 per thousand lines [S]. Ours at d5 is 24 in about 5.7K,
   about 4 per thousand. A larger repository raises cost per task without changing what is measured; a d6 "large" level
   is a knob (§16).
3. **A synthetic real-looking repository, not a real one.** A real repository has an unknown number of unplanted
   defects, and those would count as false positives. The exact manifest needs a repository whose every function is
   known correct or known defective, and here every function is generated and executed.
4. **The pass rule is a declared threshold** (precision ≥ 0.90, recall ≥ 0.80), not exact equality, and `score` is F1.
   With 6–24 defects, exact equality would turn a near-perfect sweep into the same failure as an empty one. P/R/F1 are
   the reported metrics, so the rule is a summary for McNemar.
5. **Witnesses do not gate the pass.** "Verified finding" means a manifest match, and `witnessed` is reported beside it.
   Requiring witnesses would penalise arms that verify by reasoning instead of by running. That is an owner decision
   (§16).
6. **Seeds:** own ledger rows (§7), as the brief instructs, not the shared `wbed-*` rows.
7. **Sequential budget 24K, not R3's 32K.** At d4 the inline task is 39–41K tokens. A 32K budget would skim only the
   last few files, and that control would not be decisive by construction.
8. **The fan-out unit is the file and the verification unit is the function**, so the reference has two map sites.
   W-BED's `structure.features` counts them (`mapSites: 2`).
9. **The decisiveness re-draw** (3.8% of attempts, one control) slightly under-samples repositories whose middle third
   holds few defects. Disclosed here, as for R3 and R5.
10. **Decoys only for in-scope classes, and helpers are never decoys.** That keeps the root-cause trap to defective
    helpers only.

## 15. What the reference (arm c) and the JIT arms need from the engine

1. **Sandboxed execution of task code from inside a solver.** The verify stage runs the repository's functions on
   witness arguments.

   R5-NOTES §10 item 14 says a compiled callee must never execute code from its input files. R3′ needs exactly that,
   under control:
   - a host-mediated `run(file, function, args, {timeout})` with no filesystem, no network and resource limits (the
     bed's own executor is `node:vm` with domain checks and a 200 ms timeout);
   - or an agent node that may run the repository's tests.

   The code is synthetic text, so D10 holds. Slice 2 / E2 decision.
2. **A per-file judge fits Haiku's 8K class budget.** One source file averages 791, 1,012 and 1,026 tokens at d3, d4
   and d5 (source tokens over files, §10). Add docs/CONVENTIONS.md (270–276 tokens), the class definitions (261 at
   d3, 411 at d5) and the sweep spec (279) [M].
3. **Fan-out width:**
   - 16–48 file judges plus about 20–50 witness judges per task;
   - 2 map sites under one budget reservation;
   - the 16-per-run executor cap does not apply, because these are judges, not executors (W-BED O3).
4. **Root cause needs the call graph.** It is parsed from the imports by the inventory step (code), and the trace
   must expose `verify` items per function for V3/V4 (span names `inventory`, `candidates`, `verify`, `reduce`).

## 16. Open questions for the owner

1. **The pass thresholds.** Precision 0.90 and recall 0.80, or F1 ≥ 0.85, or per-class floors? The near-miss controls
   reach F1 0.80–0.92 and fail only on the threshold.
2. **Should witnesses gate the pass?** That makes "verify before report" enforceable by the oracle.
3. **Held-out-only defect variants**, as R5's split-specific novel formats? Today held-out tasks draw from the same
   variant catalogue as dev. Held-out novelty is then new repositories, conventions and placements, not new defect
   shapes.
4. **A d6 "large" level** at their density (≥ 100K lines), for the (c′) showcase only? It would cost about 10× per task.
5. **A Python track** with a bed-side runtime, for language variety.
6. **INPUT_MUTATION defects are all pattern-visible** (0/136 without a visible pattern). Should silent mutation
   variants be added, such as aliasing through a returned reference?
7. **R8 f3 for this rung.** Reviewer-directed comments ("audited, nothing to report here") are the natural adversarial
   content. The hook is wired but is a no-op in v1, as for every rung.
