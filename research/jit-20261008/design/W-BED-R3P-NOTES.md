# W-bed R3′: the planted-defect sweep bed

*2026-10-14, cloud session. Cost $0: no model calls. `beds/sealed/` was not read. Design references: PROOF-LEDGER J5 (the
bed) and J4 (arm c′); [PRIOR-ART-MANAGED-AGENTS-DW.md](PRIOR-ART-MANAGED-AGENTS-DW.md) §1 (the benchmark row), §3.H and
§4; [W-BED.md](W-BED.md) §2, §2.4, §3.3, §3.8, §5, §6 and §8. Conventions follow
[W-BED-R5-NOTES.md](W-BED-R5-NOTES.md) and [W-BED-R2R3-NOTES.md](W-BED-R2R3-NOTES.md). Tags: **[M]** means measured
here or read in the repo, **[I]** means inference, **[S]** is PRIOR-ART's secondary-source tag (their benchmark has no
primary source). Every number marked [M] comes from the test diagnostics in §13 or from the scratch runs described where
it is quoted.*

*Revised 2026-10-14 (v1.1.0) after the adversarial review of the same day: its P0 (a $0 script passed 79% of d3 tasks
given earlier tasks) and three P1s are fixed, its five P2s fixed or recorded. §17 has every finding, the verdict and the
measurements; the sections below describe v1.1. Seeds for all tuning and tests: the dev block 449–472.*

## 0. Summary

- **What it is.** A seeded generator of fictional JavaScript repositories. Defects of stated classes are planted in
  them, together with decoys (correct code that looks wrong) and one or two defective shared helpers whose callers
  inherit the misbehaviour. A hidden manifest lists every defect as (file, function, class).
- **How it is scored.** Exactly: precision, recall and F1 per class and pooled, every false positive attributed to a
  cause, and cost per verified finding from the host's cost. Pass needs recall ≥ 0.80 and precision ≥ 0.90, with one
  false positive always tolerated.
- **Why it is honest.** Every manifest entry is proved by running code:
  - each defect differs from the correct function on a valid input (the bed's witness);
  - each decoy equals the correct function on every probe;
  - each caller of a defective helper is classified, by execution, as inheriting the defect or not;
  - every correct body and every decoy meets an independent specification of its contract (`spec.mjs`, exact integer
    arithmetic) on random in-domain inputs, so the truth "differs from the correct body" is the truth "breaks the
    contract" (v1.1; the review found two families where it was not).
- **Why a $0 script fails (v1.1).** Every defect-hosting family draws semantic knobs that the contract states (band
  ends, page base, grace days, tie rule, empty-input result, rounding rule, units, separators); most defect variants
  behave exactly like a correct instance with another knob setting. Contract wording varies in independent slots, and no
  two functions of a repository share a contract template, so the review's script finds almost nobody to vote with,
  even across 24 earlier tasks. At most 40% of a task's defects are "loud" (a crash, NaN, a changed argument, a wrong
  error type, a shared helper). That a model needs contract judgment for the rest is the bet, not yet a measurement.
- **The shape.** Their benchmark's structure (PRIOR-ART §1 row "Benchmark"): planted defects in a repository, fan-out
  per file, verify before report. It is not their setting: the repository is synthetic, denser, and the necessity of
  fan-out and of a verify step is established here only by construction (§9, §17), not measured.
- **Controls.** 17. All fail at d2–d5 on 20 seeds each, except the two contract-fuzz controls (seconds per task), which
  are measured on the tuning block and fail every task (§17). The reference passes with precision and recall 1, and all
  of its witnesses reproduce [M].

## 1. Files

| path | what |
|---|---|
| `beds/wbed/r3p/index.mjs` | family `wbed-r3p` v1.1.0. The bed interface plus `stages`, `relations`, `composedOracle`, `referenceTrace`, `structure`, `invariants`, `necessityControls`, and the sweep exports `manifestOf`, `trapsOf`, `checkWitness`, `costPerVerifiedFinding`, `aggregateSweeps`, `impactManifestOf`, `callLogFor`, `scoreImpact`, `scoreReplay`, `sizeOf`, `skimmedBy`, `taskTokens`, `contractFuzz` |
| `beds/wbed/r3p/vocab.mjs` | the 9 classes and their definitions (stated in the task), `LEVELS`, classes in scope per difficulty, house conventions, repository areas, comment pools |
| `beds/wbed/r3p/families.mjs` | 49 function families: 36 can host a defect, 29 a decoy, 13 are fillers. Each has a contract built from wording slots, semantic knobs, a parameter domain, correct bodies in one or two styles, defect and decoy variants, accepted second classes, loud variants, and probes |
| `beds/wbed/r3p/exec.mjs` | `node:vm` execution of generated functions on JSON arguments, the observation (return value or error name, plus arguments after the call), the domain validator, timeouts |
| `beds/wbed/r3p/world.mjs` | `buildSweep`: files and slots, role planning (helper defects, class quotas, balanced placement, decoys, in-pool conversion), instances (template uniqueness, the loud cap), proof by execution, tests and comments, the decisiveness re-draw |
| `beds/wbed/r3p/render.mjs` | repository text: `src/**.js` with JSDoc, `test/**.test.js`, `docs/CONVENTIONS.md`, `README.md`, `package.json`; function spans; prompt; inputs |
| `beds/wbed/r3p/score.mjs` | `outputSchema`, `scoreSweep` (exact, accepted classes), `PASS` and `passes`, `witnessHolds`, `costPerVerifiedFinding`, `aggregateSweeps` |
| `beds/wbed/r3p/pipeline.mjs` | the exact solver as stages: inventory → candidates (per file) → verify (per suspect) → reduce (root cause, report); options reproduce mistakes |
| `beds/wbed/r3p/stages.mjs` | stage contracts and oracles, relations V1–V4, `composeOracle` |
| `beds/wbed/r3p/controls.mjs` | 14 bad controls (two of them the contract-fuzz script) and 3 necessity controls; `byConstruction` marks the pipeline controls |
| `beds/wbed/r3p/attack.mjs` | **new**: the review's $0 contract-fuzz script, ported (`contractFuzz`), plus a measurement CLI |
| `beds/wbed/r3p/spec.mjs` | **new, test-only**: independent specifications of all 49 families and a random in-domain input generator |
| `beds/wbed/r3p/lint.mjs` | text-only tools: `parseFunctions`, 19 linter rules, the TODO grep, report-everything |
| `beds/wbed/r3p/impact.mjs` | the retroactive sweep (F2): impact sets, a per-defect production call log, exact scorers |
| `beds/wbed/r3p/r3p.test.mjs` | 40 oracle-health and review-regression tests |
| `beds/wbed-r3p/index.mjs` | one-line registration shim; `loadFamily('wbed-r3p')` works (tested) |
| `beds/wbed/attacks/triviality.mjs` | **modified**: rung table gains `r3p`, with its own attack seeds (479–490); `plan()` uses a rung's own seeds when none are passed and refuses seeds the ledger refuses or that lie outside a rung's own rows (v1.1) |
| `research/jit-20261008/SEED-LEDGER.json` | **modified** in v1.0: three new rows (§7) |

No lib file and no other bed changed.

## 2. The task

A task is one repository of a fictional back-office library, `@<org>/<package>`, delivered as `task.files`:
- `src/<area>/<file>.js` for the areas billing, payments, calendar, export, platform, reporting and customers;
- `src/lib/money.js` and `src/lib/dates.js`;
- `test/**/*.test.js`, `docs/CONVENTIONS.md`, `README.md` and `package.json`.

Every exported function has a JSDoc contract. Each `@param` states its domain (for example "integer from 1 to 10", or
"date YYYY-MM-DD, years 1600-2400"). `docs/CONVENTIONS.md` states the house rules (v1.1 adds §9: a character is one UTF-16
code unit, whitespace is what `String.prototype.trim` removes), and three of them are drawn per task:
- the rounding of halves: away from zero, or to even;
- band ends: inclusive, or half-open;
- the page base: 0 or 1.

Contracts can defer to the house rules, so the same code is correct in one task and a defect in another. A function's own
contract can also override a house rule (a semicolon CSV separator, `!` as the LIKE escape character, KRW without a minor
unit), which is one of the semantic knobs (§4).

The repository is real code [M]:
- every module imports;
- the generated suite passes under `node --test` against the planted code (32 of 32 repositories, d2–d5, seeds
  449–472 step 3), because tests use only inputs on which the planted and the correct function agree, drawn from a
  shuffled probe list for every role (v1.1; never an input whose result holds -0);
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

| class | first at | defect hosts (families) | decoy hosts | share without a visible pattern [M] | loud share [M] |
|---|---|---|---|---|---|
| OFF_BY_ONE | d2 | 11 | 5 | 96/164 | 16/164 |
| LOGIC_ERROR | d2 | 5 | 5 | 158/180 | 0 |
| MISSING_GUARD | d2 | 7 | 5 | 101/191 | 71/191 |
| ROUNDING | d2 | 5 (incl. the money helper) | 3 | 147/179 | 72/179 |
| INPUT_MUTATION | d3 | 4 | 4 | 13/100 | 100/100 |
| DATE_ARITH | d4 | 3 (incl. the dates helper) | 2 | 91/91 | 34/91 |
| ESCAPING | d4 | 3 | 2 | 83/103 | 0 |
| SWALLOWED_ERROR | d5 | 2 | 2 | 34/55 | 29/55 |
| UNIT_MISMATCH | d5 | 4 | 1 | 57/57 | 0 |

Measured over d2–d5 × dev 449–468, 1,120 defects: 780 (70%) show no visible pattern and 322 (29%) are loud [M]. "Without
a visible pattern" is the bed's own `smell()` label (the class a pattern-reading reviewer would report), not a measurement
of what a model needs (review finding 9). "Loud" is `families.mjs` `loud`: a crash, NaN, a changed argument, a wrong error
type, or a shared helper that a hand-written spec of the house rule catches.

**Semantic knobs (v1.1).** Each defect-hosting family draws knobs that change what the correct function does, and the
contract states them: band ends per end, page base and the past-the-end result, the day-count rule, lag and sign of
differences, ordering and the short-list result of `last-n`, chunk tails, the approver's multiple, three retryable-status
sets, include/exclude status filters, grace days, largest/smallest and the tie rule, the empty-input result, percentages
or fractions, the display-name fallback and field names, the safe-get separator and missing value, discount units,
absolute totals, which parts take the extra unit, three rounding rules and two units for percentages, three fee rounding
rules, three currency rule sets, minutes or seconds, sort direction, null-skipping defaults, status field names, total in
front or at the end, clamp or roll-over months, previous/same/next month end, two date formats and three year ranges, CSV
separator and always-quote, three apostrophe and two quote entities, three LIKE shapes and two escape characters, US or
European amounts, merge-all or known-keys settings. Most defect variants are exactly another knob setting's correct
behaviour (a swapped band end, the other rounding rule, the other unit), so they cannot be told apart from correct code
without reading the contract.

**Wording (v1.1).** Contracts are built from independent slots (2–4 main sentences, nouns, clause phrasings, 2–3
parameter descriptions, numeric domain bounds); the last main sentence of every family is held-out wording, drawn only on
the test split. No two functions of a repository share a contract template (family, knobs and wording, with parameter
names and quoted literals abstracted); across the 24 tasks of a d3 stream, 3/216 non-helper defects share their template
with two or more other functions (§17) [M]. A d3 stream has 1,794 distinct templates.

**Loud cap (v1.1).** At most 40% of a task's defects are loud; a loud draw beyond the budget is re-drawn among the
family's silent variants (new: `average`/`ratio` wrong fallback, `max-by` undefined for empty, `pairwise-deltas` one
difference too few, `safe-get` the wrong missing value, `parse-amount` blank text as 0, `read-settings` empty text as
`{}`, `sort-by` mutation only on long arrays). INPUT_MUTATION, whose defects are all loud, keeps its quota minimum (one at
d3, two at d4–d5) and is not drawn beyond it.

**Decoys.** Every decoy carries a pattern of its class, for example:
- `< hi + 1` on an inclusive integer band, `> lo - 1` on an inclusive lower end;
- `!(a || b)` (a negated compound);
- `x.length && sum / x.length`;
- `(a * p / 100) | 0` on values bounded far below 2³¹, `-Math.ceil(-x)` for a floor;
- `items.sort(...)` under an "in place" contract;
- `Object.assign({}, …)`;
- `new Date(Date.UTC(y, m, 0))`;
- `split('"').join('""')`;
- a `try`/`catch` that returns `null` where the contract says "returns null", or rethrows a SyntaxError.

Some decoys equal a defect in their text and differ only in the contract they sit under: an in-place sort under an
"in place" contract is a decoy, and the same line under a "new array" contract is a defect. As many decoys as defects
are planted, all of in-scope classes. Every decoy meets its contract's specification on random inputs (§13).

**Helpers.**
- Every task has one defective helper (two at d5, one or two at d4):
  - `roundMinor`, ROUNDING (`Math.round`, or the other house rule);
  - `daysInMonth`, DATE_ARITH (leap rule), from d4.
- Callers that pass inputs that trigger the defect inherit it: `line-amount` for money; `add-months` and `month-end`
  for dates.
- Callers of the money helper that sum integers before rounding (`sum-lines`) are provably unaffected.
- There are at least max(2, ⌈(D+1)/9⌉) inheriting callers, more than the false positives the pass rule tolerates, so
  reporting them fails the task. D is the number of planted defects.

**Drift: new classes only at higher difficulty.**
- d2: four classes;
- d3: adds INPUT_MUTATION;
- d4: adds DATE_ARITH and ESCAPING, and the dates helper can be the defective one;
- d5: adds SWALLOWED_ERROR and UNIT_MISMATCH.

The test checks that every in-scope class is planted in every task, and that no defect is of a class out of scope [M].

## 5. The hidden manifest and the oracle

**Manifest.** `{id, file, function, class, accepted, family, variant, smell, loud, witness}` per defect. It is built
by `buildSweep(seed, split, d)` and never enters the task.

The leak test checks four things:
- no class code appears in any repository file;
- no manifest function is named in the prompt or the inputs;
- the comment pools contain no class words;
- TODO comments sit on defects as often as anywhere, within 0.08.

**Matching.** A finding is verified when `(file, function)` equals a manifest entry and its class is one the entry
accepts, with three normalisations: the path is lower-cased and loses a `./`, `files/` or `repo/` prefix; the function
name is trimmed; the class must match exactly. `accepted` is the defect's class plus, for four variants whose class two
definitions fit, a second class (v1.1): `split-evenly/le-extra` OFF_BY_ONE or ROUNDING, `to-major/always-100`
UNIT_MISMATCH or LOGIC_ERROR, `chunk/le-length` OFF_BY_ONE or MISSING_GUARD, `parse-amount/blank-zero` SWALLOWED_ERROR or
MISSING_GUARD (48 of 1,120 defects on the tuning block) [M]. A second finding for the same defect under its other
accepted class is a duplicate. True positives count under the defect's primary class. `line` and `note` are ignored.

**Pass rule.** `recall ≥ 0.80` and `precision ≥ 0.90`, with one false positive always tolerated (equivalently, false
positives ≤ max(1, verified/9)), micro over the classes in scope. `score` = micro F1. Tested at the edges [M]:
- recall: 20/24 passes, 19/24 fails;
- precision: one false positive on 10 defects passes (10/11), two fail;
- d2 (6 defects): one false positive passes, two fail (v1.1; it allowed none before).

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
  - the counts kept are given, valid (`witnessed`), outside the domain, no difference, and timeout (a call that times out
    at 200 ms is re-run at 2 s; a timeout is never a difference).

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

What uses which seeds (v1.1):
- the tests, every tuning run and the review fixes: dev 449–472 (the block the ledger row calls out-of-sample is now
  the tuning block; the rehearsal streams 401–424 and 425–448 stay untouched by tuning; the reviewer's measurement used
  425–448 as an unlabelled corpus, and so does the confirmation run in §17);
- the attack plan: 479–490; `plan()` refuses seeds outside the rung's own rows;
- no held-out seed is generated by any test (v1.0 generated 8601 and 8701; removed). The test split is exercised on dev
  seed numbers 471–472 only.

`seedRefusals` returns none for `wbed-r3p` on 449 / jit-dev and 8601 / jit-heldout [M].

## 8. Controls and their results

Each control's best F1 over dev 449–468 is in the table [M]. Every control fails on every seed at every difficulty it
applies to. **By construction** marks a control built from the bed's own pipeline, which reads the manifest's roles: it
shows that the oracle penalises one mistake, not that a real solver makes it or needs the missing feature (review
finding 4). The text controls read the files and nothing else.

| control | kind | by construction | what | best F1 d2 / d3 / d4 / d5 |
|---|---|---|---|---|
| `empty` | text | | no findings | 0 / 0 / 0 / 0 |
| `shuffled-or-corrupted` | text | yes | reference findings with locations rotated by one | 0.50 / 0.30 / 0.38 / 0.29 |
| **`grep-for-TODO`** | text | | every function containing TODO/FIXME/XXX/HACK | 0.22 / 0.12 / 0.06 / 0.06 |
| **`linter-only`** | text | | 19 regex rules (eslint-style plus a money plugin), computed from the files alone | 0.44 / 0.41 / 0.31 / 0.23 |
| **`report-everything`** | text | | every function × every class in scope | 0.07 / 0.04 / 0.02 / 0.01 |
| `contract-fuzz-script` | text (slow) | | the review's $0 script on one task (attack.mjs) | §17: best F1 0.50 / 0.57 / 0.55 / 0.50, never passes |
| `contract-fuzz-stream` | text (slow) | | the same script with 24 earlier tasks as an unlabelled corpus | §17: best F1 — / 0.67 / 0.72 / —, never passes |
| **`single-pass-no-verify`** | stage | yes | one reading pass: every site with a visible pattern (the patterned defects and all decoys), nothing verified | 0.50 / 0.46 / 0.40 / 0.32 |
| `class-confused` | stage (near miss) | yes | all defects found and verified; OFF_BY_ONE ↔ LOGIC_ERROR swapped | 0.67 / 0.80 / 0.75 / 0.83 |
| `file-level-only` | stage | yes | right file and class, pinned to the file's first function | 0.67 / 0.47 / 0.50 / 0.41 |
| `budget-half-files` | stage | yes | the sweep stops after half the files | 0.73 / 0.75 / 0.72 / 0.51 |
| `tested-means-clean` | stage | yes | functions with green tests skipped | 0.80 / 0.82 / 0.81 / 0.80 |
| `report-ignores-verdict` | relation (V2) | yes | verification right, every suspect reported | 0.67 / 0.67 / 0.67 / 0.67 |
| `verified-dropped-at-fan-in` | relation (V4) | yes | the middle third of the files lost at fan-in | 0.80 / 0.82 / 0.81 / 0.80 |
| `sequential-single-context` | necessity (d ≥ 4) | yes | one context, skims past 24K tokens | — / — / 0.81 / 0.42 |
| `fan-out-no-verify` | necessity | yes | per-file fan-out, no verification: every decoy reported (precision 0.50, recall 1) | 0.67 / 0.67 / 0.67 / 0.67 |
| `fan-out-no-root-cause` | necessity (V3) | yes | verification, no root-cause fan-in: inheriting callers reported | 0.86 / 0.91 / 0.94 / 0.76 |

The four controls the brief requires are in bold. They fail as required:
- **`grep-for-TODO`** fails by construction: comments are placed independently of the roles, so its precision is the
  base rate.
- **`report-everything`** has recall 1 and precision under 0.04.
- **`linter-only`** cannot see the 70% of defects with no visible pattern, and it flags every patterned decoy and much
  clean code.
- **`single-pass-no-verify`** reports every decoy, so its precision is at most 1/2.

The near misses (`class-confused`, `tested-means-clean`, `fan-out-no-root-cause`) reach F1 0.75–0.94. They fail only on
the threshold, which is the intended difficulty.

Two controls pick up a second failure at d4–d5. When `src/lib/` lies in the part of the repository they never read,
the inheriting callers look like root causes (`budget-half-files`, `sequential-single-context`).

**Decisiveness.** The generator re-draws a repository until every applicable fast control fails. Rejected attempts in
the final test run: 39 of 416 attempts (9.4%): 18 for want of a free slot for a needed caller, 12 because `verified-dropped-at-fan-in` would have passed (the middle third held too few defects), 9 for want of an ESCAPING decoy host [M]. Class quotas, balanced placement over thirds of the files, a 30% minimum of tested
defects and the inheriting-caller minimum make the rest decisive by construction. The contract-fuzz controls are not in
the re-draw (seconds per task, against a 2 s generation budget; and re-drawing until one script fails would bias the
tasks towards what that script misses): they are gated by tests and by the measurements in §17.

## 9. Necessity and the triviality gate (W-BED §2.4)

1. **One call.** `triviality.mjs --rung r3p` plans 12 attack seeds (479–490) × 2 efforts. Inline prompt sizes [M]:
   - d3: mean 18.0K tokens (17.0K–19.0K);
   - d4: mean 42.4K (40.7K–43.7K);
   - d5: mean 63.7K (62.1K–65.5K).

   Not run (paid). The gate is one call ≤ 2/12. A one-call sweep at d3 is the open risk: 18K tokens is small, which is
   why the J4 stream on this bed starts at d4 (§11).
2. **A deterministic script.** `linter-only` and `grep-for-TODO` are 20-line scripts and fail on every seed. The review's
   contract-fuzz script (59 dense lines: domain-driven fuzzing, generic contract properties, a same-contract vote, one
   root-cause regex) is the strongest $0 script known; it fails every task on the tuning block, alone and with 24 earlier
   tasks as a corpus (§17).
3. **Structure necessity: CONDITIONAL.** Each of the rung's three features has a control, and each fails by
   construction, because each is the reference pipeline (which reads the manifest) with the feature removed:
   - fan-out: `sequential-single-context`, size-gated d ≥ 4;
   - verify before report: `fan-out-no-verify` (precision 0.50);
   - root-cause fan-in: `fan-out-no-root-cause` (inheriting callers reported).

   They show that the oracle punishes the missing feature, not that a solver needs it: a $0 script that runs the code
   reached precision 0.94–0.97 on v1.0 without any model verify step (review finding 1). Admission of the rung needs two
   measured, paid results besides the one-call gate: a Haiku per-file sweep without verification must fail ≥ 50% of the
   attack seeds, and the one-call attack must pass ≤ 2/12 at the stream's starting difficulty. Until then "verify is
   necessary" and "fan-out is necessary" are claims, not measurements.
4. **White-box script: reported, not gating.** A script with the generator source recognises the planted variants and
   reads the templated contracts, so it would pass. v1.1's knobs make this a contract parser for each family's
   templates rather than a pattern list, but it remains possible; the rung tests contract judgment only for solvers
   without the generator's templates, as for synth (W-BED §2.4 item 4, O13).

## 10. Measured sizes and runtime

Means over dev 449–458 [M]:

| d | source files | functions | source lines | defects / decoys | inheriting callers | tested functions | inline tokens | files skimmed (24K budget) |
|---|---|---|---|---|---|---|---|---|
| 2 | 8 | 48 | 639 | 6 / 6 | 2 | 21 | 8,670 | 0 |
| 3 | 16 | 112 | 1,509 | 10 / 10 | 2 | 41 | 17,842 | 0 |
| 4 | 32 | 282 | 3,808 | 16 / 16 | 7 | 107 | 42,705 (41.9K–43.8K) | 12 |
| 5 | 48 | 423 | 5,707 | 24 / 24 | 15 | 163 | 63,229 (62.2K–64.4K) | 29 |

Runtime, d5 cold [M]: `generate` 189 (336 in a fresh process) ms including the proof by execution, the template and loud checks and every
fast control's decisiveness check; `oracle` 11 ms with all 24 witnesses run. Both are under the CONTRACT's 2 s.

## 11. How arm (c′) versus arm (g) is scored on this bed (PROOF-LEDGER J4)

**Stream (v1.1).** Per lineage, 24 tasks: 16 at d4, then 8 at d5, the drift point where SWALLOWED_ERROR and
UNIT_MISMATCH appear. v1.0 proposed 16 at d3 then 8 at d4; at d3 the inline task is about 18K tokens and no size control
bites, so the fan-out claim would rest on nothing there (review finding 4). The d3 → d4 stream remains a cheaper
rehearsal, reported as such. Owner sign-off pending (it raises the per-task cost about 2.4×).
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
- A stream or library arm sees the earlier tasks of its stream. The `contract-fuzz-stream` control measures what a $0
  script makes of them (it fails every task, §17); an arm that beats it by learning the generator's templates across the
  stream is reported apart from contract judgment.

**Decision.** As PRIOR-ART §4:
- (g) is within 10 points of (c′) on verified success at ≤ 1/5 of (c′)'s construction cost, in both lineages.
- Success is read with the stats.mjs `DECISION_RULE` (McNemar plus the lineage-clustered bootstrap).
- Cost per verified finding is read with a paired bootstrap over tasks, clustered by lineage.

**Their number in our terms.** "66/70 in three runs" is recall 0.94, with precision and tokens unreported. On this bed
the same recall with every decoy or every inheriting caller reported scores precision 0.50–0.86 and fails (by
construction, §8). Whether a real arm makes those mistakes is what the paid run measures.

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
3. **Replay.** `callLogFor(task, defectId?)` is a deterministic log of recorded calls (valid arguments plus the output the
   planted code returned) for ONE confirmed defect (default: the first defective helper), every caller of it, and as
   many clean distractors (never a defect, never a caller of a defective helper) as hit functions, at least four (v1.1:
   the v1.0 log listed every planted defect, so a sweep given it learned about the others; review finding 6).
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
**46/46 pass**: 40 for R3′ and 6 for the attack driver [M].

The R3′ tests cover:
- interface; portability; determinism, also in a fresh process;
- the reference and every fast control on 20 seeds per difficulty (dev 449–468);
- per-family domain and role coverage;
- the manifest proved by execution (over d2–d5 × 449–454: 336 defects, 336 decoys, 149 inheriting and 57 unaffected
  callers) and the loud cap;
- the control inventory, with the by-construction labels;
- text controls read only the files; relation and necessity behaviour; sizes; drift; no leak;
- oracle edge cases and thresholds; witness execution; the composed oracle agreeing with the end-to-end oracle; stage
  contracts; the parser equal to the spans;
- the repository as real code (`node --test` green, witnesses identical in real Node and in the vm);
- cost aggregation; F2 scoring; seed-ledger disjointness and the tuning block; the attack plan and its seed refusals;
- the test split (on dev seed numbers), held-out wording only there; runtime;
- the review regressions (§17): every correct body and decoy against its independent specification (75,052 executions,
  0 deviations), the two reported contract violations, accepted classes, the one-false-positive tolerance, the
  contract-fuzz script and stream controls failing, template uniqueness within a task and rarity across a stream, the
  loud cap and silent variants, in-pool conversion, the per-defect call log, timeouts.

The full W-bed suite, `node --test --test-concurrency=2 'beds/wbed/**/*.test.mjs'`: **210/210 pass** in 469 s, R0–R6, R3′ and the attack driver (with other agents' uncommitted work in R1–R5 in the tree) [M].

The two suites outside `beds/` that read the ledger:
- `experiments/jit/test/stream.test.mjs` S0-5: 2/2 pass;
- `experiments/kev-data/test/seed-ledger.test.mjs`: 1/2 pass, as before this change (its test 2 lists the expected range ids and has not been
  updated for the `wbed-*` rows; not my file).

## 14. Deviations, and why

1. **One language, not several** (§3). Exactness needs execution.
2. **Density.** Theirs is 70 defects in about 116K lines, 0.6 per thousand lines [S]. Ours at d5 is 24 in about 5.7K,
   about 4 per thousand. A larger repository raises cost per task without changing what is measured; a d6 "large" level
   is a knob (§16).
3. **A synthetic real-looking repository, not a real one.** A real repository has an unknown number of unplanted
   defects, and those would count as false positives. The exact manifest needs a repository whose every function is
   known correct or known defective, and here every function is generated, executed and checked against a spec.
4. **The pass rule is a declared threshold** (recall ≥ 0.80, precision ≥ 0.90 with one false positive tolerated), not
   exact equality, and `score` is F1.
5. **Witnesses do not gate the pass.** "Verified finding" means a manifest match, and `witnessed` is reported beside it.
   That is an owner decision (§16).
6. **Seeds:** own ledger rows (§7), as the brief instructs, not the shared `wbed-*` rows.
7. **Sequential budget 24K, not R3's 32K.** At d4 the inline task is 41–44K tokens. A 32K budget would skim only the
   last few files, and that control would not be decisive by construction.
8. **The fan-out unit is the file and the verification unit is the function**, so the reference has two map sites.
9. **The decisiveness re-draw** under-samples repositories whose middle third holds few defects, or whose files leave
   no room for a needed caller or decoy host (§8). Disclosed here, as for R3 and R5.
10. **Decoys only for in-scope classes, and helpers are never decoys.** That keeps the root-cause trap to defective
    helpers only.
11. **(v1.1) Loud cap and INPUT_MUTATION at its quota minimum.** The class mix is shaped so that generic property checks
    cannot reach the pass threshold; INPUT_MUTATION is one defect at d3 and two at d4–d5 in every task (a known count).
12. **(v1.1) The J4 stream starts at d4** (§11).
13. **(v1.1) Accepted second classes** for four variants (§5) instead of a location-only pass rule (§17, finding 3).

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

1. **The pass thresholds.** Recall 0.80 and precision 0.90 with one false positive tolerated (v1.1), or F1 ≥ 0.85, or
   per-class floors? The near-miss controls reach F1 0.75–0.94 and fail only on the threshold.
2. **Should witnesses gate the pass?** That makes "verify before report" enforceable by the oracle.
3. **Held-out-only defect variants**, as R5's split-specific novel formats? v1.1 adds held-out-only wording (the last
   main sentence of every family is drawn only on the test split); defect shapes are still shared by both splits.
4. **A d6 "large" level** at their density (≥ 100K lines), for the (c′) showcase only? It would cost about 10× per task.
5. **A Python track** with a bed-side runtime, for language variety.
6. **R8 f3 for this rung.** Reviewer-directed comments ("audited, nothing to report here") are the natural adversarial
   content. The hook is wired but is a no-op in v1, as for every rung.
7. **(v1.1) The J4 stream from d4** (16 at d4, 8 at d5), about 2.4× the per-task cost of the d3 → d4 stream.
8. **(v1.1) The always-defective helper** (review finding 5): every task has one; a stream learns "src/lib holds a
   defect". Making it defective with p ≈ 0.5 removes the root-cause trap from half the tasks; a second defective-able
   helper per lib file would keep it. Recorded, not changed.

## 17. The adversarial review of 2026-10-14: findings, verdicts, measurements

One P0, three P1s and five P2s, verified one by one on v1.0 and fixed in v1.1.0 unless marked otherwise. $0: no model
calls; `beds/sealed/` not read; no credentials. Tuning and tests on dev 449–472; the reviewer's own protocol (corpus
425–448) is re-run once on v1.1 as a confirmation, with the generator frozen. Scratch logs: the review's in
`/var/tmp/foundry-work/review-R3prime/`; v1.1 measurements reproducible with `node beds/wbed/r3p/attack.mjs` (its header).

### Finding 1 (P0): solvable at $0 by code once earlier tasks are visible. **Real; fixed.**

*Verified on v1.0.* The script's two halves, measured apart on dev 401–410 (d3) and 401–404 (d5): the generic contract
properties alone reach precision 1.00 and mean recall 0.42 (d3) and 0.37 (d5), passing nothing; the same-contract vote
supplies the rest (to the review's 0.59–0.72 on single tasks and 0.90 with 24 earlier tasks). The vote works because
v1.0 contracts were fixed templates: up to nine instances of a family per task with word-for-word the same contract, and
the same texts across tasks.

*Fix (v1.1).* (1) Semantic knobs stated in every defect-hosting family's contract, chosen so most defect variants are
another knob's correct behaviour (§4). (2) Independent wording slots and numeric domain bounds; held-out-only main
sentences on the test split. (3) No two functions of a repository share a contract template; across a 24-task d3
stream 3/216 non-helper defects share their exact template with two or more other functions, and the stream has 1,794
distinct templates [M]. (4) At most 40% loud defects per task, with new silent variants for MISSING_GUARD,
SWALLOWED_ERROR, OFF_BY_ONE and INPUT_MUTATION; INPUT_MUTATION at its quota minimum. (5) The script is ported into the
bed (`attack.mjs`, the reviewer's logic line for line, deterministic per task) and registered as two text controls,
`contract-fuzz-script` and `contract-fuzz-stream` (24 earlier seeds as an unlabelled corpus), with a test that both fail.
A `keyMode: 'numbers'` option abstracts numbers as well, a stronger grouping than the reviewer's.

*Measured on v1.1* (the reviewer's script, unchanged logic) [M]:

| mode (v1.1, dev seeds) | d | tasks | pass | mean precision | mean recall | mean F1 | max recall | max F1 | v1.0 (review) |
|---|---|---|---|---|---|---|---|---|---|
| one task alone (449–468) | 2 | 20 | **0/20** | 0.94 | 0.15 | 0.25 | 0.33 | 0.50 | 0/20, recall 0.33 |
| | 3 | 20 | **0/20** | 0.94 | 0.26 | 0.40 | 0.40 | 0.57 | 2/20, recall 0.59 |
| | 4 | 20 | **0/20** | 0.99 | 0.25 | 0.40 | 0.38 | 0.55 | 2/20, recall 0.66 |
| | 5 | 20 | **0/20** | 1.00 | 0.25 | 0.39 | 0.33 | 0.50 | 3/20, recall 0.72 |
| 24 earlier tasks, unlabelled (corpus 425–448, targets 449–472) | 3 | 24 | **0/24** | 0.99 | 0.28 | 0.42 | 0.50 | 0.67 | **19/24**, recall 0.90 |
| same, targets 449–460 | 4 | 12 | **0/12** | 0.97 | 0.35 | 0.51 | 0.56 | 0.72 | **8/12**, recall 0.89 |
| same as d3, contract key with numbers abstracted (stronger than the review's) | 3 | 24 | **0/24** | 0.74 | 0.33 | 0.45 | 0.50 | 0.67 | — |

Mean precision is over tasks with at least one finding. On one task the vote cannot fire (no contract template
repeats within a repository), so the single-task rows are the generic properties alone: mean recall 0.15–0.26, the loud
defects (capped at 40% of a task) minus the helpers whose contract does not use the script's regex wording. The vote now adds about 0.02 (d3) to 0.10 (d4) of mean recall with a
24-task corpus, because almost no defect has a same-text peer; abstracting numbers buys more groups but mixes knob
settings, so its precision falls to 0.74. The v1.0 rows are the reviewer's numbers on dev 401–420 and the same corpus
protocol; the v1.1 single-task rows use the tuning block 449–468.

*Not adopted:* the per-task re-draw until the script fails ("decisiveness"): it costs seconds per task against the 2 s
generation budget, and re-drawing until one script fails would bias the task distribution towards what that script
misses. The controls are gated by tests on the tuning block and by the measurement above. *Deferred:* held-out-only
defect variants (owner question 3; v1.1 adds held-out-only wording only).

### Finding 2 (P1): "correct" bodies broke their own contracts. **Real; fixed.**

*Verified on v1.0* with the reviewer's `rightwrong.mjs` (seed 405, d5): the percent `fee-rate` returned 38 on
[5500, 0.7] (38.5, "halves up", should be 39) and `safe-get` returned a function for [{}, "constructor"] and null for
[{n: null}, "n"]; both contract-faithful reports scored as false positives (decoy 1, clean 1).

*Fix.* A percent rate is a whole number (the fee is an exact rational, and `Math.round` is exact on it); `safe-get`'s
contract states own-property lookup (`Object.hasOwn`) and that a final null is returned as null, and its bodies follow
it. Wording that said "spaces" where the code trims whitespace now says whitespace, and CONVENTIONS §9 defines both; the
settings parser's domain admits only object JSON or invalid text. The regression is general: `spec.mjs` specifies all 49
families from their contract text in exact integer arithmetic, and a test runs every correct body and every decoy against
it on random in-domain inputs, at family level (every role and knob, both house rules, both splits) and in real tasks
(75,052 executions, 0 deviations [M]). The test found one more unsound decoy, in v1.1's own new code
(`pairwise-deltas` lag k with fewer than k values), fixed before this commit; its probes now cover those lengths.

### Finding 3 (P1): the pass rule was brittle and class labels ambiguous. **Real; fixed.**

*Verified on v1.0:* at d2 (6 defects) one false positive failed a task (6/7 = 0.857 < 0.90); `split-evenly/le-extra`
(OFF_BY_ONE) fit ROUNDING's "parts that no longer add up", and `to-major/always-100` (UNIT_MISMATCH) fit LOGIC_ERROR's
"one case of the rule left out".

*Fix.* Accepted second classes for the four variants two definitions fit (§5), and tighter definitions: LOGIC_ERROR now
excludes the cases a specific class names, ROUNDING ties "parts that no longer add up" to rounding at the wrong step.
The pass rule tolerates one false positive; the root-cause trap keeps at least two inheriting callers at every
difficulty so the no-root-cause control still fails. *Not adopted:* deciding pass at the (file, function) level: it
would let `class-confused` pass and drop the per-class instrument J5 is for; class F1 stays in the details either way.
The thresholds remain owner question 1.

### Finding 4 (P1): the necessity controls read the oracle. **Real; fixed as labels and gates.**

*Verified:* `pipeline.mjs` `verify()` reads `deviates()`, which reads the manifest roles; `fan-out-no-verify` reports
every decoy by construction; `sequential-single-context` finds nothing past its budget by construction; at d3 no fan-out
necessity control applies.

*Fix.* Every pipeline control carries `byConstruction: true` and says so in its text (tested); §8 and §9 call the
necessity claims conditional; the triviality driver's r3p row names the two paid measurements admission needs (a Haiku
per-file no-verify arm failing ≥ 50% of attack seeds, and the one-call gate); the J4 stream on this bed starts at d4
(§11). The ledger status says "conditional". *Cannot be done at $0:* the measured arms themselves.

### P2s

- **5. Structural priors.** *Fixed:* slots are converted only to families of their file's area pool, and the date
  callers and hosts gained room in three pools (billing, payments, customers), which also cut the decoy-host re-draws;
  the repository's tests take inputs from a shuffled probe list for every role; the clean-only styles named in the
  review (approval `switch`, `chunk` while-loop, CSV `needsQuotes`, `split-evenly` `%`, `safe-get` reduce, HTML map) now
  render for defects too. *Recorded, not changed:* the always-defective helper (owner question 8); the defect count fixed
  by difficulty; about one defect per file (the spread is what makes the fan-in control decisive); a defect's tests still
  avoid its separating inputs (they must pass), which a fixed probe list makes weakly visible.
- **6. The F2 call log leaked defects.** *Fixed:* one log per confirmed defect, distractors never a defect or a caller of
  a defective helper, matched in number (tested).
- **7. Wall-clock timeouts.** *Fixed:* generation runs every call with a 2 s timeout and treats a timeout as a generator
  error; the witness check re-runs a 200 ms timeout at 2 s and reports a remaining timeout apart, never as a difference
  (tested). No timeout was observed.
- **8. Seed hygiene.** *Fixed:* tests and tuning use 449–472 only; no held-out seed is generated by any test; `plan()`
  refuses seeds the ledger refuses or that lie outside the rung's own rows (tested); the ledger row's description says so.
- **9. Which claim it tests.** *Accepted as documentation:* R3′ tests J5, not B6; §0 now says the structure is theirs and
  the setting is not; the "no visible pattern" share is labelled as the bed's own `smell()` label.

### Verdict

Fixed: the P0, all three P1s, and P2s 6, 7, 8 and the fixable parts of 5 and 9. Rejected: the per-task re-draw for the
script controls (cost and bias, above) and a location-level pass rule (finding 3). Deferred: held-out-only defect
variants, the always-defective helper, the fixed defect count, the paid necessity arms.
