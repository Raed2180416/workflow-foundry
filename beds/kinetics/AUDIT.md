# kinetics adversarial audit, 2026-10-07 (2.0.0 -> 3.0.0)

Scope: `beds/kinetics/` as found at 2.0.0 (commit b9d45c4), bed contract v1. Auditor role: try to
break determinism, the contract, truth hiding and the oracle, try to pass without solving, then fix
every problem, add a regression test per fix and re-measure. Pure code: no language model was called.
All numbers are development evidence from fixed seeds (30 seeds per cell unless stated; "test" means
test-split seeds 5000-5029, "dev" means dev seeds 1-30). Severity is about the bed's use for comparing
harnesses.

The 2.0.0 README and tests cite an earlier audit (`[AUDIT F1]`-`[AUDIT F7]`), but no AUDIT.md was ever
committed. From the test names, those findings were: F1/F2 oracle bypasses and score = 1 only for a
pass; F3 `generate` returned the cached object; F4 output schema outside the portable subset; F5 too
little judgment content; F6/F7 structural give-aways (per-condition dilution series, pilot range,
replicate numbers). Their regression tests are kept. This audit continues the numbering at F8.

## Summary

| id | severity | finding | evidence (before) | fix | regression test |
|---|---|---|---|---|---|
| F8 | high | Truth leak: the register's `planned_replicates` against the number of plate rows labelled with each condition names the source and the destination of the mislabelled row; the replicate numbers on the wrong label were duplicated or out of range | count mismatch revealed 60/60 relabel traps at d3, 60/60 at d4, 96/120 at d5 (test seeds 5000-5059); replicate-number anomaly in 42/60 d3 traps | `planned_replicates` removed from the register; replicate numbers renumbered 1..n per label in plate order; a relabel moves a row from a label with n+1 rows to one with n rows, so per-label row counts stay a permutation of the true counts (1193/1200 relabels at d3-d5; the rest fall back to a load-bearing pair) | `the register and the replicate numbers do not give a mislabelled row away [AUDIT F8]` |
| F9 | high | Triviality via residuals: kept "deviant" wells were at most e^0.39 off the curve, excluded wells (including every late, row-flag and moved-note exclusion) at least e^0.45, so one residual threshold replaced the prose that reports them; with F8 a 39-line script passed half of d3 | a fixed threshold of 0.39 classified every non-silent well correctly in 30/30 d3 tasks (25/30 d4, 22/30 d5); `attacks/residual-hybrid.mjs` (39 lines, 6,973 chars) passed **16/30 d3 test**, 13/30 d3 dev | at d3+: exclusions reported only in later messages read normally (silent); 60% of the other exclusions are mildly distorted (x0.62-0.8 or x1.25-1.6); kept deviant wells span e^±0.22-0.6 (2 per task); more prose-only exclusions per task (2 late facts, 2 late keep-reports, a colleague report the author denies, colleague reports the author confirms, late reports as clock times); d3 exclusions 7-8 (were 5-6). Best fixed threshold, even granting every silent exclusion: 5/30 d3, 3/30 d4, 3/30 d5 | `residuals: at d3+ no fixed threshold separates ... [AUDIT F9]`; `triviality: within-budget attacks ...` |
| F10 | medium | Ordering leak: every plate row ran up the dilution series, so a substrate-tube swap showed as two out-of-order wells, and a retracted swap or a rejected swap suggestion showed none; the plate order alone settled every swap-related correction | all swap traps in 2.0.0 sat in ascending rows (no other layout existed) | rows are ascending, descending or randomised; swap traps and swap suggestions only use randomised rows | `a swapped pair is not visible from the plate order [AUDIT F10]` |
| F11 | low | Oracle crash: an array with holes (`new Array(3)`) in `conditions` threw a TypeError (validation used `forEach`, which skips holes) | `oracle(task, {conditions: new Array(3), excluded_samples: []})` -> TypeError | validation walks arrays by index; holes and non-plain objects are schema errors | `oracle validation equals outputSchema ... [AUDIT F11, F12]` |
| F12 | low | Oracle stricter than `outputSchema`: `vmax`/`km` = 0 satisfies the published schema (`minimum: 0`) but scored 0 as "schema-invalid", dropping partial credit; inherited (prototype) fields counted as present | `km: 0` on one condition -> score 0 instead of 0.85 | validator = schema: 0 is graded and misses the tolerance (relative error 1); fields must be own properties | same test |
| F13 | medium | False-negative risk: kept wells carried "bubble first noticed at <time after the read>"; a careful reader can argue the bubble may have been there unnoticed during the read, so the SOP outcome was arguable. "first noticed" during the read marked excluded wells | 2.0.0 `timedBubble` templates | kept wells say the bubble "formed at" a time after the read; the clock-time sentence shapes (formed at / seen ... popped / noticed ... tapped out) are used both inside and outside the read window, so the times decide | `prose: clock-time shapes occur with both outcomes ... [AUDIT F13, F14, F15]` |
| F14 | medium | Keyword classifiability: row notes and late messages came from closed phrase sets in which negation words always meant "keep" and exclusion words "exclude"; late facts were always posted by the author and named the well by id or position | the 2.0.0 white-box parser (`attacks/whitebox-parser.mjs`) passed 13/30 d3 test, 17/30 d3 dev | crossing phrasings ("no bubble at loading; one showed up halfway through the read and stayed" excludes; "possible double enzyme addition here? checked the tip box: single addition" keeps), tricky pipette notes, colleague reports that count only with the author's answer, wells named by condition label + replicate + concentration in another unit, row flags by label or concentration, a moved note named by relative column, more withdrawal phrasings | same test; `triviality: over-budget attacks are documented ...` |
| F15 | info | Text quality: "A air bubble" | chat/addenda samples | article chosen from the word | same test |
| F16 | low | Missing record: README and tests cite AUDIT.md / F1-F7, file absent | `git log -- beds/kinetics/AUDIT.md` empty | this file | README test |
| F17 | low | Test harness: `test.diagnostic?.()` on the module-level `test` is undefined, so token-size and attack-rate diagnostics were silently dropped | no `#` diagnostic lines in TAP output | tests take the context and call `ctx.diagnostic` | (visible in `--test-reporter=tap`) |
| F18 | info, accepted | d1-d2 stay scriptable | 2.0.0: `regex-budget` 30/30 d1, 26/30 d2 test | none; documented as calibration levels (README) | - |
| F19 | open | A white-box parser written with the generator source open, adapted to 3.0.0 by the auditor (62 code lines, 10.9K chars, over the attack budget) passes 14/30 d3 test and 9/30 d3 dev | `attacks/whitebox-v3.mjs` | not fixed: any template generator admits a parser of this kind; documented, with a regression guard at the measured values | `triviality: over-budget attacks are documented ...` |

## 1. Determinism and contract conformance

- Every export is present: `family {id, domain, version, description, kind: 'oneshot'}`, `outputSchema`,
  `generate`, `oracle`, `referenceSolve`, `badControls` (empty, shuffled-or-corrupted, seven
  plausible-but-wrong, one near miss). Tested.
- `outputSchema` passes `portableSchemaViolations` from `src/schema-subset.mjs` (no pattern, oneOf,
  uniqueItems, $ref, format). Tested.
- `generate` is byte-identical across calls (cache cleared and fresh `buildWorld` + `renderTask`), for
  numeric and string seeds; it differs by seed and by split; `split` is RNG salt only; bad splits and
  difficulties throw. No `Math.random`, `Date.now` or wall clock in the generator (grep; `dateOf` maps a
  day index to a fixed 2031 calendar). `generate` returns a structured clone (F3 test).
- Split hygiene: world and render seeds of test seeds 5000-5999 never equal those of dev seeds 0-4999
  at any difficulty (0 collisions of 32-bit seed hashes; 5,000 x 1,000 pairs per level). New test
  `splits: test seeds >= 5000 never collide with dev seeds`.
- Version bumped to 3.0.0: task content changed; 2.0.0 tasks are not comparable.

## 2. Truth leakage

- Values: no generating Vmax/Km (or x60/x1000 variants, or the reference fit) appears to 6 significant
  figures, nor to 4 figures next to a parameter name; Ki is never shown; no hidden keys in `inputs`; the
  exclusion set is never written as a list (existing test, re-run).
- Structure, new: **F8** (row counts, replicate numbers) and **F10** (plate order). The register is
  listed in condition-id order and ids are assigned after a shuffle; sample ids follow plate position;
  inhibitor conditions are not always last; documents are shuffled at d4+.
- Checked and not a leak: the raw-export flag column shows SAT/OVR for saturated excluded wells and LOW
  for kept LOW wells (it is evidence the SOP names); R² is lower only for LOW (kept) wells; the
  literature Km in filler is random; the pilot plate has its own lot, range and parameters.

## 3. Oracle bypass (all fail without crashing; tested)

Empty arrays; every study well excluded; 50,000 junk excluded ids; 20,000 unknown conditions;
`__proto__`/`toString`/`constructor`/`hasOwnProperty` as condition ids; duplicated conditions (one
wrong); NaN, Infinity, negative, strings, boxed numbers, arrays for numbers; extra fields; whitespace or
lower-case ids; an array-like object; holes in arrays (**F11**, crashed before); prototype-inherited
fields (**F12**). Score is 1 if and only if pass (checked over every control at every level). A tampered
`task.prompt`/`inputs` does not change grading: the oracle rebuilds the world from
`(seed, split, difficulty)`.

## 4. Oracle false negatives

- Accepted variants: any order of conditions and of excluded ids; repeated excluded ids (set
  semantics); any JSON number form; 9% relative error passes, 11% fails (tests). `vmax`/`km` of 0 is now
  graded rather than schema-invalid (**F12**).
- Ids are matched exactly (case and whitespace); the README and prompt promise nothing else.
- The README pass rule was re-read against `oracle()`: evaluator valid, every register id exactly once
  and no other id, both parameters within 10% of the generating values (inhibitor: parent Vmax and
  Km(1+[I]/Ki)), exact exclusion set. They match.
- Prose read against the SOP on samples at d3 and d5 (chat, addenda, row notes). One arguable case was
  found and removed (**F13**). New 3.0.0 texts were written so that the SOP outcome does not depend on
  reading intent: colleague reports always get an answer from the author that names the well again (by
  id or plate position), so it cannot be attached to another question (tested).

## 5. Triviality attack

Attack budget for "a <=40-line heuristic": at most 40 code lines and 7,000 characters (comment lines
excluded), reading only `task.inputs`/`task.prompt`, allowed to call the bed's NLLS fitter.

`attacks/residual-hybrid.mjs` (written against 2.0.0; 39 lines, 6,973 chars) parses the sheets and the
raw export, applies the units-trap message, finds the mislabelled row from register counts (F8),
repairs swaps numerically, and excludes by residual (e^0.38) plus row-note keywords (F9). It needs no
reading of the late messages, row flags, moved notes or withdrawals. Ablations on 2.0.0: without the
count rule 0/30, without the residual rule 0/30.

Pass rates (30 seeds per cell; "d3 dev" is dev seeds 1-30, the rest test seeds 5000-5029):

| attack | size | budget | 2.0.0 d1 / d2 / **d3** / d3 dev / d4 / d5 | 3.0.0 d1 / d2 / **d3** / d3 dev / d4 / d5 |
|---|---|---|---|---|
| `regex-v1.mjs` (from the 1.0.0 audit) | 39 lines, 6.1K | within | 0 / 4 / **0** / 0 / 0 / 0 | 0 / 2 / **0** / 0 / 0 / 0 |
| `regex-budget.mjs` (from the 2.0.0 audit) | 38 lines, 6.8K | within | 30 / 26 / **0** / 0 / 0 / 0 | 29 / 22 / **0** / 0 / 0 / 0 |
| `residual-hybrid.mjs` (this audit) | 39 lines, 7.0K | within | 0 / 25 / **16** / 13 / 0 / 0 | 0 / 24 / **0** / 0 / 0 / 0 |
| `adapted-v3.mjs` (this audit, adapted to 3.0.0) | 45 lines, 8.5K | over | 0 / 7 / **1** / 1 / 0 / 0 | 0 / 5 / **2** / 0 / 0 / 0 |
| `whitebox-parser.mjs` (2.0.0 white-box) | 48 lines, 10.1K | over | 30 / 26 / **13** / 17 / 0 / 0 | 29 / 22 / **0** / 0 / 0 / 0 |
| `whitebox-v3.mjs` (this audit, white-box for 3.0.0) | 62 lines, 10.9K | over | 0 / 26 / **15** / 10 / 0 / 0 | 0 / 28 / **14** / 9 / 0 / 0 |

Heuristic-solver pass rate at d3 (test seeds 5000-5029): **16/30 (53%) before, 0/30 after**; best
within-budget attack after the fix: 0/30 (test and dev). The strengthening went through three rounds,
each followed by re-adapting an unbounded white-box parser to the new templates: (1) the F8/F9/F10
structural fixes (residual-hybrid 16/30 -> 0/30); (2) crossing phrasings, new reference styles and more
prose-only exclusions per task (the 2.0.0 white-box 13/30 -> 0/30); (3) colleague reports that need the
author's answer and clock-time late reports. Each round dropped the auditor's unbounded parser to
1-4/30, and re-adapting it (a few hundred characters per round) brought it back to 9-16/30. The arms
race against white-box parsing was stopped there (**F19**, open).

## 6. Controls

Final sweep, 3.0.0, 150 dev + 150 test seeds per level (1,500 tasks): `referenceSolve` passes every task
with a valid evaluator; no bad control passes any task; every trap is load-bearing. The test suite runs
30 seeds at d1/d3/d5 and 20 at d2/d4 on both splits for the reference and every control. Keeping the SOP
exclusions breaks at least one fit in 49/50 (d1), 47/50 (d2), 43/50 (d3), 35/50 (d4), 33/50 (d5) dev
tasks (was 47-50/50): most d3+ exclusions are now silent, and the exact-set rule makes each one count.

## 7. Sizes and performance

`estimateTokens(prompt) + estimateTokens(inputs)`, dev seeds 1-50, min / median / max:

| d | 2.0.0 | 3.0.0 |
|---|---|---|
| 1 | 1758 / 1829 / 1908 | 1703 / 1821 / 1879 |
| 2 | 2510 / 2635 / 2718 | 2513 / 2625 / 2747 |
| 3 | 6242 / 6640 / 7069 | 6358 / 6784 / 7231 |
| 4 | 8149 / 8792 / 9254 | 8252 / 8902 / 9455 |
| 5 | 10719 / 11323 / 11989 | 10779 / 11435 / 11946 |

d5 in a fresh process: generate 55-67 ms, oracle 18-23 ms (cold cache), RSS about 65 MB (limits 2 s and
200 MB; tested).

## Left open

- **F19**: a white-box parser of about 11K characters written against `render.mjs` passes about half of
  d3. The bed measures agents that see one instance, not code written against the generator; held-out
  claims should use `beds/sealed/`.
- d1-d2 remain calibration levels that a short script solves (F18).
- The prose side of the reference is checked by construction and by reading samples; the test-only
  parser checks numbers and units only. No independent reader re-derives the exclusion set from text.
- Whether cheap single-shot models fail at d3+ is untested; no model has been run against 3.0.0.
