# Audit of bed `synth`: 2026-10-08

Adversarial audit, then fixes, of the `synth` bed as found (generator `VERSION` 2.0.0, README v1-era). Scope: only
`beds/synth/`. No model or LLM API was called; every number below comes from deterministic scripts over the
generator and oracle in this directory. Result: bed version **3.0.0** (task content changed for every seed; any
number measured on 2.0.0 is not comparable).

Method, in the order of the brief: (1) determinism and contract conformance; (2) truth leakage, with white-box
scripts that look for statistical pointers to the winner; (3) oracle bypass with degenerate and hostile outputs;
(4) oracle false negatives; (5) triviality attack with short deterministic solvers, iterated against each generator
change; (6) controls; (7) sizes and performance.

Pass rates are on the test split, seeds 5000 and up, unless noted ("100 seeds" = 5000–5099, "30 seeds" = 5000–5029).
These are **development / diagnostic** numbers, not sealed evaluation: the attackers and the generator changes were
tuned against dev seeds and repeatedly checked on seeds 5000–5099. Unseen seeds 7000–7099 were measured once at the
end with the final fixtures (see Triviality). The v2.0.0 columns use the as-found `world.mjs`, `render.mjs` and
`catalog.mjs` (same sizes as the files found) with the hardened `index.mjs`, which does not change the truth.

## Summary

- The bed was an easy target for a short script: a 36-line regex solver written against the 2.0.0 templates passed
  **88/100** level-3, 41/100 level-4 and 29/100 level-5 tasks (cell accuracy 0.99). After the v3 hardening the same
  solver passes **0/100** at levels 3 to 5 (cell accuracy 0.25).
- The hardening did **not** make the bed immune to code. A catalog-aware script of about 400 lines (33 KB), adapted
  over three rounds to the v3 generator, passes **99/100** level-3, 96/100 level-4 and 91/100 level-5 tasks on the seeds
  it was adapted on, and **96 / 92 / 89** of 100 on unseen seeds 7000–7099. The
  version written for v2 (92/100 at level 3 there) scores 0/100 on v3, so the hardening costs an attacker effort, not
  capability. Reported as S-8, open.
- The oracle had defects an adversarial output could use (prototype-named keys, sparse arrays, accessors, proxies,
  huge outputs) and its `details` printed the answer; all fixed.
- Generator leaks (the winner carried the most claims, notices and code-only names) were removed by a symmetry pass.

## Findings

Severity: critical = a script reads the answer without judgment; high = a large shortcut or a broken claim;
medium = a partial shortcut or an oracle defect with no known pass bypass; low = robustness or documentation.

| id | sev | finding | evidence | fix | regression test |
|---|---|---|---|---|---|
| S-1 | critical | The winner of a cell was the document with the most claims about it (non-standard-condition, quoted and notice decoration was added only to winners and trap documents). "Most claims for the cell, smallest id on ties" found the winner in 69% of level-3 cells (chance 0.41) and 60% at level 5 (chance 0.43). | white-box statistics over the hidden world, 120 test seeds, cells with at least two surviving candidates | Symmetry pass: every non-winning candidate gets the same kinds of extra same-cell claims (non-standard, quoted) and notices at matching rates (`KNOBS[d].symmetry`); extras are centred on the true value (`cell.truth`), never on the winner's possibly mis-united printed value. After: 0.44 (chance 0.38) at level 3, 0.38 (0.41) at level 5. | `structural priors do not identify the winner of a cell`, `the same priors hold at difficulties 4 and 5 ...` |
| S-2 | high | Winners were far more often the target of an erratum, concern, retraction or supersession notice than the documents they beat: 0.49 vs 0.27 at level 3, 0.32 vs 0.18 at level 5. | same | Notices about non-winners at the symmetry rates, calibrated per level (0.27 / 0.15 / 0.10 at levels 3 / 4 / 5; a first setting of 0.4 overshot: 0.48 vs 0.57 at level 3 and 0.33 vs 0.51 at level 5). After: 0.49 vs 0.49 (3), 0.39 vs 0.40 (4), 0.34 vs 0.37 (5). | same |
| S-3 | high | Winners were code-only named (entity named only by its development code in that document) 0.52 vs 0.30 for other candidates at level 3 and 0.55 vs 0.28 at level 5, because the traps that force the alias mapping sat on winners. | same | Entity-level naming rule: the code-only choice is drawn per entity and applied to winners and losers alike. After: 0.61 vs 0.64 (3), 0.69 vs 0.67 (5). | same |
| S-4 | low, **open** | The median-valued claim wins more often than chance: 0.36 vs 0.23 at level 3, 0.38 vs 0.26 at level 5 (v2: 0.60 vs 0.29 / 0.60 vs 0.31). Perturbed decoy values around the truth make it the median more often than 1/n. | same, cells with an odd number of at least three candidate values | Per-cell perturbation tilt (all up, all down or mixed; `cell.tilt`). Not fully removed. Needs the surviving candidate set, which a script does not have before applying the status rules. | median bound < 0.5 at levels 1, 2, 3, 4, 5 (same tests) |
| S-5 | medium | The longest candidate document won 0.54 of level-3 cells (chance 0.38). | same | Same symmetry pass. After: 0.38 (3), 0.27 (5). | same |
| S-6 | low, **open** | At levels 1 and 2 (smoke levels) a notice is attached to the winner more often than to losers (0.23 vs 0.11, 0.29 vs 0.25). | same | Left: those levels are not meant to be hard. Documented. | bound excluded for d < 4 with a comment |
| S-7 | critical | Triviality: a 36-line regex solver written against the 2.0.0 templates (now `heuristic.mjs`) passed 88/100 level-3, 41/100 level-4 and 29/100 level-5 tasks. The bed's own fixture as found (59 lines, 12.7 KB, now `heuristic-a1.mjs`) passed 0/30 at levels 3 to 5 and so did not test the property. Bar: < 20%. | `fm.mjs` matrices (below) | v3 content (S-12 constructs, symmetry, form variety). After: both 0/100 at levels 3 to 5 (cell accuracy 0.18 to 0.26). Both kept as fixtures. | `the 40-line-class solvers pass < 20% ...` |
| S-8 | high, **open** | A catalog-aware attacker (`heuristic-ceiling.mjs`: about 400 lines, 33 KB, imports the catalog) still passes 99/100 level-3, 96/100 level-4 and 91/100 level-5 tasks (96 / 92 / 89 on unseen seeds 7000–7099). It reads only `prompt` and `inputs`. Its v2-era ancestor (92/100 on v2 level 3) fails 100/100 on v3, so each hardening round costs the attacker one adaptation round (3 rounds, 22.9 KB to 32.5 KB, +42%), no more. | `fm.mjs` ceiling trajectory (below) | Not fixable inside a finite template generator. Kept as fixture and witness; README "Limits" tells experiments to report the script ceiling next to code-authoring arms and to use sealed families for headline claims. | `witness: an independent catalog-aware reading ...` (a floor of 0.9 / 0.75 on pass and 0.93 on cells, so the fixture stays honest) |
| S-9 | medium | Levels 1 and 2 are solvable by short scripts: 66/100 (A1) and 76/100 (H40) at level 1, 19/100 and 16/100 at level 2. | matrix | None (smoke levels). README says so. | – |
| S-10 | info (positive) | Text and truth agree. The independent catalog-aware parser reproduces the oracle's truth on 100% of the cells at level 3 (1.000), 99.7% at level 4 and 99.4% at level 5. Twelve disagreements found while building it were all attacker gaps (nested parentheses, "unbuffered" matching "buffer", multi-token units in ranges, label alternation I/II, digit-initial sentences, nested-bracket banners, case in condition lookup, decimals in condition erratum captures, …), none a generator inconsistency. | ceiling per-feature accuracy (below) | – | `witness ...` |
| S-11 | medium | v3 development defects caught by the new tests and the control-rejection loop, listed so they stay fixed: symmetry extras centred on a wrong-unit printed value ("1420 eV"); condition errata without `value` / `unit` would throw in `fmtValue`; a module-level table counter made output depend on call order; tying the condition erratum to the "conditions" feature caused 69 control-rejection retries at level 3 (now a standalone feature, 0 retries in 200 seeds per level); grammar ("a optimum", "Changing from for …"). | tests; generator retry log | Per-cell `truth`; erratum records carry `value` and `unit`; per-document `rr.int` instead of a counter; standalone `condErratum` feature; `an()` and quoted conditions. | `identical calls give byte-identical tasks ...` (call order and fresh instance); `values printed as a list of replicates ...` |
| S-12 | info | v3 task content added (all gated by `KNOBS`, off at level 1): decoy qualifiers (storage / calibration numbers that are not conditions), named protocols, results tables in 4 layouts, replicate lists, factor errata, pronoun units, condition errata, bound-only documents, citation-style and bare references, symmetric notices, `formVariety` templates in every multi-value, erratum, status and n family. Bound and condition erratum are mandatory at levels 3 to 5, each with a new near-miss control (`bounds-counted`, `cond-erratum-ignored`). New prompt rules state each (README, "Semantics"). | prompt diff | – | `the v3 constructs appear at the levels that enable them ...`, `adversarial and judgment content appears at the documented levels` |
| O-1 | medium | `validate` looked up `schema.properties[key]`, so keys such as `constructor` and `toString` (top level and inside rows) were taken as schema members and not reported as unexpected fields: the reference answer plus `"constructor":{"x":1}` still scored `pass = true`, score 1. No bypass without the answer, but `additionalProperties: false` did not hold. | probe of the as-found `index.mjs` | `Object.hasOwn` lookups. | `prototype-named keys are unexpected fields ...` |
| O-2 | medium | Sparse arrays broke the checks: a hole in `table` threw (`Cannot read properties of undefined (reading 'entity')`); a sparse `excluded_doc_ids` scored 1 with holes counted as ids. | probe | Index loop in `validate`; holes rejected by `plainCopy`. | `hostile containers never crash the oracle ...` |
| O-3 | medium | The oracle threw on throwing getters and proxies (contract: return a verdict), and read accessors several times: a getter answering `[]` once and the true list afterwards passed (`pass = true`). | probe | One `plainCopy` snapshot before validation; accessors, proxies, symbols, class instances and cycles invalid; `oracle()` wraps everything and never throws. | same |
| O-4 | low | Huge outputs made the oracle slow: a 10^6-row table took 1.9 s (contract limit 2 s); 5 MB strings and 10^4-deep nesting were not bounded. | probe (now 0.27 s) | `maxItems` / `maxLength` in `outputSchema` and size caps in `plainCopy`. | same |
| O-5 | high | `oracle().details` contained the answer: per cell the true `value` and `source_doc_id` (plus the submitted `got`), and the ids of the missing and extra excluded documents. Any harness that stored or fed back details to an arm would leak the whole table. | probe of the as-found `index.mjs` | Public details are answer-free: per-cell `{ entity, property, ok, valueOk, srcOk, why? }`, counts for the excluded set. `explain(task, output)` returns the full breakdown for analysts. | `verdict details carry no truth ...` |
| O-6 | low | `hidden()` and `generate()` accepted any seed (`undefined`, `NaN`, `-1`, objects) and produced a task silently (`synth-dev-d3-sundefined`). | probe | Seed must be a non-negative safe integer or a string of 1–64 characters, else `TypeError`; split and difficulty validated. | `generate rejects malformed seed, split and difficulty ...` |
| O-7 | low, **open** | The public per-cell `ok` / `valueOk` / `srcOk` flags are still one bit of feedback per cell. A solver allowed to re-submit with them could search the answer. | code | Documented in README: arms receive at most `pass` / `score`. | – |
| T-1 | low | The suite failed on arrival: its gated-control test ignored `applies(task)` and required controls to fail on tasks where the trap was not drawn (`gross-n passed at d3 s8`), where they coincide with the reference answer. | `node --test beds/synth/` before any change | Test now requires failure wherever `applies` holds and requires that each gated control applied somewhere. | `gated controls fail wherever their trap applies ...` |
| T-2 | low | Second failure on arrival: a stale regex for predictions (`prediction expected at d>=4`). No tests for leakage priors, hostile outputs, determinism across module instances, or the triviality tripwires; the as-found fixture could not detect a regression (S-7). | same | 39 tests (below). | all |
| D-1 | low | Docs drift: README v1-era (25 tests, old sizes and knob tables), no AUDIT.md. | files | README rewritten for 3.0.0; this file; `VERSION` 3.0.0. | `family metadata and exports` (version) |
| D-2 | info | Determinism holds: byte-identical tasks across calls, a fresh module instance and reversed call order; test seeds 5000–5399 share no RNG stream with dev seeds 0–4999 (all levels, attempts 0 to 2) and no test task 5000–5029 equals a dev task 0–119. | hashes | – | `identical calls ...`, `test-split seeds (>= 5000) never reuse ...` |
| X-1 | low, **open** | Outside the scope of this audit: `experiments/kev-data/spec/ports.json` pins `beds/synth/world.mjs` at `2.0.0`, and `experiments/kev-probe/datasets.mjs` labels a document "valid" from `claim.cond === 'std'`, which a condition erratum can overturn since v3 (`world.errata[].kind === 'cond'`). `catalog.mjs` exports used by `experiments/kev-data/lib/bedsync.mjs` are unchanged. | grep | Not edited (other agents own those paths). | – |

## Contract conformance (step 1)

Exports: `family`, `outputSchema`, `generate`, `oracle`, `referenceSolve`, `badControls`, plus `gatedControls`,
`hidden`, `aliasMappingProblems`, `explain`, `validate`, `KNOBS`, `relDiff`. `outputSchema` uses only the portable
subset (checked by the test and by `src/schema-subset.mjs`). `generate` is a pure function of
`(seed, split, difficulty)`; `split` is only an RNG salt; the returned task is a deep copy (mutating it affects
neither later generations nor the oracle). The task has exactly `id, family, seed, split, difficulty, prompt, inputs,
budget`.

## Leakage (step 2)

Winner-versus-others statistics over the hidden world, 120 test seeds per level, all cells with at least two surviving
candidates (796 cells at level 3, 1337 at level 5). `chance` = mean of 1/(number of candidates).

| statistic | L3 v2 | L3 v3 | L5 v2 | L5 v3 |
|---|---|---|---|---|
| chance | 0.41 | 0.38 | 0.43 | 0.41 |
| smallest document id wins | 0.41 | 0.37 | 0.43 | 0.40 |
| most claims for the cell wins (S-1) | 0.69 | 0.44 | 0.60 | 0.38 |
| longest document wins (S-5) | 0.54 | 0.38 | 0.44 | 0.27 |
| winner is a notice target / others are (S-2) | 0.49 / 0.27 | 0.49 / 0.49 | 0.32 / 0.18 | 0.34 / 0.37 |
| winner is code-only named / others are (S-3) | 0.52 / 0.30 | 0.61 / 0.64 | 0.55 / 0.28 | 0.69 / 0.67 |
| median-valued claim wins (S-4; base 0.29 / 0.23 / 0.31 / 0.26) | 0.60 | 0.36 | 0.60 | 0.38 |
| a document sharing a value (within 1%) with another wins (base 0.72 / 0.74 / 0.78 / 0.77) | 0.76 | 0.71 | 0.80 | 0.72 |

Documents expose only `id, type, venue, date, authors, title, text` (and `n` at levels 1 and 2). Generator
internals (`feats`, `pressOnly`, `aliasOnly`, `role`, `winner`, `condErratum`, `symmetry`, …), the answer table, the
answer rows, the excluded list and source ids as fields never appear in the prompt or inputs, and status words never
appear in the type or venue metadata (tests).

## Oracle probes (steps 3 and 4)

Rejected without crashing (after the fixes): `{}`, `null`, strings, numbers, arrays, `undefined`, `NaN`; extra
fields including prototype-named keys; wrong types (numeric strings, `true`, `Infinity`, `NaN`, `BigInt`, `Date`
values, non-string ids); sparse arrays in `table`, `conflicts` and `excluded_doc_ids`; throwing and flipping
getters; throwing proxies; symbol keys; class instances; cyclic objects; 10^4-deep nesting; 10^6-row tables;
5 x 10^5 excluded ids; a 5 MB string; malformed tasks (`null`, missing seed, unknown split or difficulty).
Degenerate answers fail at every level (empty, every document excluded, no document excluded, every cell sourced
from every document, 25 blind random guesses per task). An independent re-implementation of the README pass rule
agrees with the oracle on pass and score for 400 random mutations (value jitter, wrong source, extra or removed
excluded id, duplicate row, removed row).

Accepted (no false negatives found): any key order; any case and surrounding whitespace in entity, property and
document ids; entity code instead of name; property synonyms; duplicates in `excluded_doc_ids` and any order; extra
rows for unrequested cells; empty or missing `conflicts`; 1% relative tolerance (1.009x passes, 1.02x does not);
every value rounded to 3 significant figures (200 tasks across all levels, 0 failures); a JSON round trip of the
reference answer. The near-name distractor entity is a different entity (a row for it does not satisfy the cell).

## Triviality attack (step 5)

Attackers, all reading only `prompt` and `inputs` (fixtures in this directory):

- **A1** `heuristic-a1.mjs`: 59 lines, 12.7 KB. Condition and unit tables plus status regexes. Written by an
  earlier, interrupted pass; 0% at level 3 on both versions, so a weak attacker.
- **H40** `heuristic.mjs`: 36 dense lines, 18.7 KB. The required "at most 40 lines" attacker, written against the
  2.0.0 templates (condition tables, method and decoy stripping, notice parsing, policy ranking).
- **CEIL** `heuristic-ceiling.mjs`: about 400 lines, 32.7 KB, imports `catalog.mjs`. Over budget on purpose: the
  white-box tier. Round 1 (22.9 KB) was written on 2.0.0; rounds 2 and 3 (28.0 KB, 31.3 KB) and the final 32.5 KB
  were adapted to the v3 generator while it changed.

Pass counts out of 100, test seeds 5000–5099 (cell accuracy over all requested cells in parentheses). The v2 columns
use a snapshot of the 2.0.0 bed; the v3 columns use this directory.

| attacker | level | v2.0.0 | v3.0.0 |
|---|---|---|---|
| A1 | 1 / 2 / 3 / 4 / 5 | 100 (1.00) / 55 (0.92) / 0 (0.62) / 0 (0.61) / 0 (0.65) | 66 (0.94) / 19 (0.77) / 0 (0.18) / 0 (0.25) / 0 (0.25) |
| H40 | 1 / 2 / 3 / 4 / 5 | 97 (0.99) / 97 (1.00) / **88 (0.99)** / 41 (0.94) / 29 (0.93) | 76 (0.98) / 16 (0.79) / **0 (0.25)** / 0 (0.26) / 0 (0.26) |
| CEIL (v2-era round 1 on v2; final round on v3) | 1 / 2 / 3 / 4 / 5 | 100 / 100 / **92 (0.99)** / 81 (0.98) / 74 (0.98) | 100 / 100 / **99 (1.00)** / 96 (1.00) / 91 (0.99) |

Unseen seeds 7000–7099 on v3, final fixtures, measured once: passes out of 100 at levels 1 to 5: A1 75 / 11 / 0 / 0 / 0,
H40 82 / 16 / 0 / 0 / 0, CEIL 98 / 99 / 96 / 92 / 89. The ceiling loses 3 to 5 points against the seeds it was adapted on.

Ceiling adaptation trajectory on v3 (100 seeds): round 1 (22.9 KB) 0/100 at levels 3 and 5 (cells 0.25, 0.26);
round 2 (28.0 KB) 0/100, 0/100 (cells 0.45, 0.50); round 3 (31.3 KB) 0/100 and 2/100 (cells 0.73, 0.78); final
(32.5 KB) 99/100 and 91/100.

Ablation of the v3 additions against the frozen H40 at level 3 (100 seeds; one addition switched off at a time, then
all of them; the pass rate is 0 whenever any one construct breaks a cascade of regexes, so cell accuracy carries the
signal):

| generator | H40 pass | H40 cells |
|---|---|---|
| v3 (all on) | 0 | 0.251 |
| without `formVariety` | 0 | 0.404 |
| without bound-only documents and condition errata | 0 | 0.324 |
| without citation-style / bare references | 0 | 0.279 |
| without replicate lists | 0 | 0.277 |
| without decoy qualifiers | 0 | 0.271 |
| without named protocols | 0 | 0.270 |
| without results tables | 0 | 0.251 |
| without the symmetry pass | 0 | 0.256 |
| without pronoun units | 0 | 0.249 |
| without factor errata | 0 | 0.247 |
| all of the above off (plus old reference styles) | **59** | 0.944 |

Reading: the 0% is a property of a brittle frozen attacker. No single v3 construct is responsible; the template
breadth (`formVariety`) and the new claim types (bounds, condition errata) matter most; with all of them off the
frozen solver is back at 59/100 (the remaining distance to 88 is the leak fixes S-1 to S-3 and `cellTilt`, which stay
on in that run). The adapted ceiling at level 5 still fails 9/100 tasks. Its remaining errors, by trap feature (level
5, cell counts right / total): `superseded` 96/100, `predicted` 145/149, `comparison` 238/244, `erratum` 224/228,
`aliasOnly` 673/678, all others at least 99%; at level 3 every feature is 100%.

Conclusion on step 5: the required bar (a 40-line attacker below 20% at level 3) is met with large margin, and the
fixtures guard it. The bed is not robust to an attacker who adapts to the template catalog (S-8). That is a
limitation of finite-template generation, not a defect to patch further; mitigation is procedural (sealed
families, reporting the script ceiling, never giving an arm the generator source).

## Controls (step 6)

`referenceSolve` passes 24/24 dev seeds at every level and 30/30 test seeds at every level (score 1). Every one of the
12 `badControls` fails on 30 seeds at every level (15 dev + 15 test seeds per level in the suite, 30 + 30 in the
mean-score table). The 11 gated controls fail on every task where `applies(task)` holds (45 to 60 of the 60 tasks per level and control).
Two controls are new in v3 (`bounds-counted`, `cond-erratum-ignored`). Mean scores are in the README. The generator
re-draws a world if any applicable control passes: in 200 test seeds per level the first attempt was always valid.

## Sizes and performance (step 7)

`estimateTokens(prompt) + estimateTokens(inputs)`, test seeds 5000–5029:

| level | v2 mean tokens | v3 min / mean / max tokens | v3 documents mean | prompt alone | generate mean (max) |
|---|---|---|---|---|---|
| 1 | 3,496 | 3,527 / 3,829 / 4,187 | 14 | 1,759 | 4 ms (23) |
| 2 | 5,109 | 4,778 / 5,494 / 6,410 | 24 | 1,816 | 6 ms (15) |
| 3 | 8,699 | 9,137 / 10,312 / 12,258 | 53 | 1,995 | 12 ms (44) |
| 4 | 10,823 | 10,446 / 12,328 / 14,221 | 64 | 2,097 | 13 ms (24) |
| 5 | 11,735 | 11,917 / 13,731 / 15,033 | 72 | 2,137 | 17 ms (28) |

Level 3 is inside the contract's 6–15K aim (maximum 12.3K); level 5 tops out at 15.0K. Generation and scoring of a
level-5 task in a fresh module instance stay far below 2 s and 200 MB (tested).

## Test suite

Before: the 25-test suite failed 2 tests on arrival (T-1, T-2) and did not exercise the properties above. After: **39 tests in 7 suites, all passing**
(`node --test beds/synth/`, about 35 s). The README lists them.

## Left open

- **S-8 (high):** the white-box ceiling passes 96–99% / 92–96% / 89–91% of levels 3 / 4 / 5. Arms that author and run code,
  or distil a procedure from dev tasks of this bed (F arms), may exploit template regularity. Report the script
  ceiling next to those arms; use sealed families for headline claims.
- S-4 (low): median-valued claim prior 0.36–0.38 vs 0.23–0.26 chance.
- S-6, S-9 (low, medium): levels 1 and 2 are smoke levels, solvable by short scripts, with a notice-target lift.
- O-7 (low): per-cell flags in the public details are a feedback bit; give arms only `pass` / `score`.
- X-1: `experiments/kev-data/spec/ports.json` pins `beds/synth/world.mjs` at 2.0.0; the Kev probe's "valid claim"
  label ignores condition errata. Both outside this scope.
- Not validated with any model; difficulty for models is a design target. Token counts are bytes/4.
