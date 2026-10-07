# kinetics adversarial audit, 2026-10-07 (2.0.0 -> 3.0.0; second pass 3.0.0 -> 4.0.0)

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


## Second pass, 2026-10-07 (3.0.0 -> 4.0.0)

Scope: `beds/kinetics/` at 3.0.0 as found in the working tree, bed contract v1. Independent second auditor;
same role and rules as the first pass (break determinism, the contract, truth hiding and the oracle, try to
pass without solving, fix, add a regression per fix, re-measure). Pure code: no language model was called.
All numbers are development evidence from fixed seeds ("test" = test seeds 5000-5029, "dev" = dev seeds 1-30,
unless stated).

State found: an earlier second-pass attempt had been interrupted. Its partial edits (pools/render/world bumped
to 4.0.0, findings "F20-F27 started", no AUDIT, README, test or index changes) are in commit 7315d6f; in the
working tree those three files had been restored to 3.0.0 (staged), so `git diff HEAD~3 -- beds/kinetics` was
empty and the partial edits were reviewed from `git diff HEAD~3 HEAD`. Kept, with fixes: order-of-events bubble
notes, side remarks, content-polar answers, the redirected late report (world only), ordinal well references,
the d3 decimal-comma export and the fixed 5 µL in row headers. Not kept as they were: an enzyme-dose scaling of
one condition's rates with no text anywhere that reveals it (every d3+ task would have been unsolvable while
the reference passed), redirected wells with no redirect message, and phrasings that were ambiguous (F33).
Git state was not touched.

### Summary

| id | severity | finding | evidence (before) | fix | regression test |
|---|---|---|---|---|---|
| F20 | critical | Triviality: a ≤40-line heuristic solves d3. The first pass's "0/30 for the best within-budget attack" came from attacks that had not been adapted to 3.0.0 within the budget | `attacks/budget-v3.mjs` (39 code lines, 6,958 chars, written by this auditor from the prompt and inputs only) passed **27/30 d3 test** and 23/30 d3 dev tasks on 3.0.0 (d1 4/30, d2 26/30, d4 0/30, d5 0/30). It needs no reading of corrections: the units trap shows as a ×60 offset against other sheets, relabels and swaps as residuals, typos against the raw export | 4.0.0 hardening, F21-F26: every d3 task now needs an order-of-events parser, the master-mix log and its later corrections, ordinal references, side-remark handling and content-polar answers. budget-v3 now passes 0/30 (test and dev). Adapted to every 4.0.0 feature and golfed (`attacks/golfed-v4.mjs`) it needs 43 lines and 9.3K chars for 21/30; every subset of its handlers that fits 7,000 chars passes 0/30 | `triviality: within-budget attacks ... [AUDIT step 5, F9, F20]`; `triviality: over-budget attacks are documented ...` |
| F21 | high | Keyword-classifiable exclusion notes: every bubble note came from closed phrase sets whose words decided the outcome; three regexes (about 60 alternatives) classified them | budget-v3's keyword rules classified every 3.0.0 row note and late message used in the 30 test tasks | order-of-events notes: the bubble from loading removed, or a bubble formed, before or after the read started or ended, in frames shared by both outcomes ("X before Y", "Y after X", "first X, then Y", "by the time Y, ...", "only once/after", "N min before/after", "formed N min after the read started" against the row's read length); at least 2 excluded wells per d3+ task carry one. On these sentences budget-v3's keyword rules are wrong for 79-86% of excluded and 5-24% of kept wells | `order-of-events bubble notes ... [AUDIT F21]`; `judgment content ...` |
| F22 | medium | Each note used only the vocabulary of its own outcome | strip-free keyword rules worked on every note | side remarks about non-study items (the blank, standards, practice, pilot or spare plate, last week, the neighbouring study) in the opposite vocabulary, on about half the d3+ notes, joined after, before, in parentheses or as "Unrelated: ..."; never on a moved (misattributed) note. Ablation (round 1): without stripping them the golfed attack dropped from 26 to 4/30 | `side remarks about non-study items ... [AUDIT F22]` |
| F23 | medium | Colleague answers carried their polarity in the first word (Yes/Confirmed/You're right vs No/I checked/Not in) | a 40-character regex decided every answer | at d3+ answers come from pools whose opening words cross ("Yes, I looked at X again: nothing like that happened there" denies; "No point denying it: X had exactly that" confirms; 15 confirming and 13 denying forms). Ablation (round 1): the opening-word rule dropped the golfed attack from 26 to 10/30 | `prose: ... colleague reports are answered by the author ...` (answers checked against the generating pool) |
| F24 | high | Every correction was recoverable from the numbers, so no correction text had to be read (units: ×60 against other sheets; relabel and swap: residuals; typo: raw export) | budget-v3 applied all of them numerically (29/30 d3 tasks with every condition in tolerance) | enzyme-dose correction (d3+): the master-mix log records each condition's enzyme dilution; one condition's mix was 1:250 or 1:1000 (numbers or words), in half the tasks only a later chat correction by the log's keeper says so; SOP section 5 rescales that condition by (dilution ÷ 500). All its wells scale alike, so the numbers cannot show it; ignoring it misses Vmax by 50-100%. Herrings: discarded mixes, pilot and old-tube dilutions, a colleague asking about another mix. The dose condition is chosen so that relabel traps and rejected relabels stay load-bearing with the dose applied (600/600 d3-d5 tasks); new control `plausible-but-wrong:ignore-dose` | `enzyme dose ... [AUDIT F24]`; controls test |
| F25 | medium | Late reports and their withdrawals had fixed markers; a report always concerned the well it named | withdrawal = one of five fixed openings | a late report posted for the wrong well X and moved by its author the next day to Y (Y excluded and reads normally, X kept; 7 phrasings, some naming Y first); 8 withdrawal phrasings, three without the usual opening words | `a late report moved to another well ... [AUDIT F25]` |
| F26 | medium | Wells were named only by id, plate position or label + replicate + concentration | | wells named by ordinal position among the study wells of a plate row, from the left or the right (blanks not counted); two late reports per d3+ task use it when their sheet prints positions | `ordinal well references resolve to the intended well [AUDIT F26]` |
| F27 | medium | False-negative risk: correction suggestions came from technicians who have their own sheet in the task ("was the template on per-minute for your run too? Mine was", "like on mine", "My export came out that way", "I had a tube swap"); read literally, they are statements about the asker's own sheet | 32 such units suggestions in 200 d3 tasks (100 dev + 100 test), 30 at d4, 175 at d5 | suggestions and the questions behind confirmed corrections are asked by people without a sheet in the study | `correction suggestions come from people without a sheet in the study [AUDIT F27]` |
| F28 | low | Oracle robustness: validation walked arrays to their full length; a sparse array of length 2^32-1 (a non-JSON caller) keeps it busy for minutes | code reading; `validateOutput` loops to `length` | validation stops after 20 errors | `validation stops early ... [AUDIT F28]` |
| F29 | low | Test bug: the F8 regression asserted the global row-count permutation for every kept relabel, also when the task's other relabel had fallen back (latent false failure, first seen at d5 test 5017) | 10/600 d3-d5 tasks have a fallback relabel | assert the permutation only when every relabel of the task kept it; the overall rate is asserted separately (1188/1200 in the sweep) | `the register and the replicate numbers ... [AUDIT F8]` |
| F30 | high | False negative: the red-herring message "Reader log for plate P row R: no SAT or OVR flags at all" was posted by the author for rows whose own sheet has a SAT/OVR exclusion; read carefully, it withdraws that flag, but the truth kept the well excluded | 13/200 d3, 11/200 d4, 19/200 d5 tasks (100 dev + 100 test each) | the herring row has no SAT/OVR anywhere (no saturated exclusion, no flagged first read, no exclusion among its top three wells) | `herrings never contradict a sheet ... [AUDIT F30, F31]` |
| F31 | medium | False-negative risk: herring "X went on the reader straight after Y; no problems with either" on rows with SOP exclusions | 15/200 d3, 22/200 d4, 22/200 d5 tasks | "no mix-up between the two" | same test |
| F32 | medium | False-negative risk: notebook filler contradicted the study: random enzyme lots ("lot 7343-B" while all study plates used another lot), enzyme dilutions 1:200-1:800 and enzyme volumes 2/5/10 µL across sheets with identical kinetics, read lengths of 5/8/10 min against the row's stated window, master-mix ids and "same master mix as the previous plate" across conditions. With the dose rule they would be direct contradictions | every 3.0.0 task (filler lines) | filler uses the study lot, refers to the master-mix log for dilutions, fixed 5 µL, no read length, no mix ids; a herring that "shared a master mix" with another condition is rephrased | `filler and row headers agree with the master-mix log ... [AUDIT F32]` |
| F33 | info | Process: the interrupted attempt's partial edits (commit 7315d6f) were incomplete and partly ambiguous: dose scaling with no text; redirect wells without messages; "I popped the bubble N min after the read started" with N possibly beyond the read's end (presence during the read unknowable); an answer "You're right that I was at that bench" to photo-based questions; "the same bubble" on the practice plate | `git diff HEAD~3 HEAD -- beds/kinetics` | completed or rewritten as described in F21-F26 (the removed bubble is always "the bubble from loading", so its presence at the start is stated) | covered by the tests above |
| F19 | open (re-measured) | A white-box parser written with the generator source open still solves most d3 tasks | `attacks/whitebox-v4.mjs` (89 lines, 13.7K chars): 26/30 d3 test, 25/30 d3 dev on 4.0.0 | not fixable for a template generator; documented, guarded at the measured values | over-budget attack test |

### 1. Determinism and contract conformance

All exports present (one control added, `plausible-but-wrong:ignore-dose`); `outputSchema` unchanged and in the
portable subset; byte-identical generation (cache cleared and fresh world + render); test seeds 5000-5999 never
collide with dev seeds 0-4999 (world and render seed hashes, all levels; the world seed includes the version, so
the check was re-run for 4.0.0). Version bumped to 4.0.0: task content changed at every level (d1-d2 only in
filler and row-header wording).

### 2. Truth leakage

Re-ran the value, hidden-key and exclusion-list checks; the hidden-key list now also covers the new world fields
(`dose`, `doseFactor`, `dilution`, `ordered`, `ordinalRef`, `redirectTo`). New content checked: the dose factor
is invisible in the numbers by construction (all wells of the condition scale alike); a redirected report's
wells carry no row notes; the master-mix log names one condition per line in mixed alias styles. Structural:
relabels keep the per-label row-count profile in 1188/1200 relabels (12 fallbacks, all d5); the first pass's
F8/F10 fixes hold.

### 3. Oracle bypass

All first-pass attempts re-run (empty, all wells, 50,000 junk ids, 20,000 unknown conditions, prototype keys,
duplicates, NaN/Infinity/negative/strings/boxed numbers/arrays, extra fields, whitespace or lower-case ids,
array-likes, holes, inherited fields): all fail without crashing, score is 1 iff pass. New: sparse arrays of
length 2^32-1 in either field (F28, fixed). Tampered task text does not change grading.

### 4. Oracle false negatives

The README pass rule was re-read against `oracle()`: unchanged (the README now also states the 20-error cap).
Prose read on samples at d3 and d5 for every new template and for the old herrings: F27, F30, F31 and F32 were
arguable or contradictory and are fixed; the partial attempt's ambiguous phrasings are fixed (F33). The dose rule
is stated in the SOP of every d3+ task with a worked example in both directions; the log's word forms ("twice the
standard amount of enzyme went in (the stock was diluted half as much as it should have been)") match the SOP's
1:250 case. Variant forms that pass: any order of conditions and excluded ids, repeated excluded ids, any JSON
number form, 9% error.

### 5. Triviality attack

Budget as in the first pass: at most 40 code lines and 7,000 characters (comment lines excluded), reading only
the prompt and inputs, calling the bed's fitter allowed. The second-pass auditor wrote `budget-v3.mjs` from
scratch against 3.0.0 (units from headers or referenced sheets, raw export, ×60 sheet-consistency check for the
units trap, numeric relabel and swap repair, keyword rules for notes, clock times against the read window,
row-rank flags, moved notes, withdrawals, colleague answers by opening word), unbounded first (9.5K chars, 28/30)
and then golfed into the budget.

Pass rates, d3 (30 seeds per cell):

| attack | size | budget | 3.0.0 test / dev | 4.0.0 test / dev |
|---|---|---|---|---|
| `budget-v3.mjs` (this pass, against 3.0.0) | 39 lines, 6,958 chars | within | **27 / 23** | **0 / 0** |
| `golfed-v4.mjs` (budget-v3 + every 4.0.0 handler, golfed) | 43 lines, 9,314 chars | over | - | 21 / 19 |
| golfed-v4 without the order parser, ordinal references, dose chat, clock times, word numbers and moved-note columns | 41 lines, 7,658 chars | over | - | 0 / 0 |
| `whitebox-v4.mjs` (this pass, generator source open) | 89 lines, 13,734 chars | over | - | 26 / 25 |
| `whitebox-v3.mjs` (first pass) | 62 lines, 10,856 chars | over | 14 / 9 | 0 / 0 |
| `adapted-v3.mjs` (first pass) | 45 lines, 8,529 chars | over | 2 / 0 | 0 / 0 |
| `regex-v1`, `regex-budget`, `residual-hybrid`, `whitebox-parser` | 6.1-10.1K | - | 0 / 0 | 0 / 0 |

Heuristic-solver pass rate at d3 (test seeds 5000-5029): **27/30 (90%) before, 0/30 after**; dev seeds 1-30:
23/30 before, 0/30 after. Other levels for budget-v3 on 4.0.0: d1 12/30, d2 28/30 (calibration levels, F18),
d4 0/30, d5 0/30.

Hardening went through three rounds, each followed by re-adapting the attack:
1. F21-F26 as first implemented (order notes in 60% of bubble notes, side remarks, polar answers, redirect, dose
   in the log, ordinal references in 30% of position references). The adapted golfed attack reached 26/30 at
   9.0K chars; ablations showed polar answers (45 chars to handle) and side remarks (38 chars) were cheap, and
   that the keyword fallback still read most order notes right, because few of them concerned excluded wells.
2. More answer, withdrawal, redirect, dose and side-remark forms whose markers cross; order notes on at least
   two excluded wells per task; dose corrections in the chat in half the tasks. Ablation on the re-adapted
   attack (9.3K chars, 19/30): without the order parser 1/30 (-971 chars), without the dose-chat handler 4/30,
   without clock times 9/30, but without ordinal references still 18/30.
3. Two late reports per task named only by ordinal position (when the sheet prints positions); an excluded
   well reported only in a later message can carry the order-of-events note when the row notes cannot. Final
   golfed-v4: 21/30 test, 19/30 dev; without the order parser 0/30, without the dose-chat handler 6/30,
   without clock times 11/30, without ordinal references 12/30, without the moved-note column rule 18/30.

Search for a within-budget 4.0.0 attack: starting from golfed-v4 after behaviour-preserving golf (9,197 chars),
every combination of dropping ten handlers (order parser, ordinal references, moved-note columns, word numbers,
dose chat, dose words, clock times, polar answers, withdrawal words, side remarks; word numbers always go with
the order parser) was sized; none fits 7,000 characters (smallest: 7,414 chars with all ten dropped, which reads none of the 4.0.0 features). The subset
without the order parser, ordinal references, dose chat, clock times, word numbers and moved-note columns
(7,658 chars) passes 0/30 test and 0/30 dev. The arms race against white-box parsing was stopped there (F19
stays open).

### 6. Controls

Final sweep, 4.0.0, 150 dev + 150 test seeds per level (1,500 tasks): `referenceSolve` passes every task with a
valid evaluator; no bad control (eleven, including `ignore-dose`) passes any task; `score === 1` exactly when
`pass`; every trap is load-bearing; the dose keeps every relabel load-bearing. Keeping the SOP exclusions breaks
at least one fit in 48/50 (d1), 48/50 (d2), 47/50 (d3), 33/50 (d4), 42/50 (d5) dev tasks. Best fixed residual
threshold granting every silent exclusion: 1/30 d3, 6/30 d4, 1/30 d5 (was 5, 3, 3). The test suite runs 30 seeds
at d1/d3/d5 and 20 at d2/d4 on both splits for the reference and every control.

### 7. Sizes and performance

`estimateTokens(prompt) + estimateTokens(inputs)`, dev seeds 1-50, min / median / max:

| d | 3.0.0 | 4.0.0 |
|---|---|---|
| 1 | 1703 / 1821 / 1879 | 1744 / 1824 / 1895 |
| 2 | 2513 / 2625 / 2747 | 2541 / 2656 / 2751 |
| 3 | 6358 / 6784 / 7231 | 6828 / 7280 / 7633 |
| 4 | 8252 / 8902 / 9455 | 9112 / 9451 / 10085 |
| 5 | 10779 / 11435 / 11946 | 11511 / 12014 / 12592 |

d5 in a fresh process: generate 53-60 ms, oracle 20-32 ms (cold cache), RSS about 65 MB (limits 2 s and 200 MB;
tested). Test suite: 38 tests, all passing.

### Left open (second pass)

- **F19**: white-box parsers written against `render.mjs` still solve most d3 tasks (whitebox-v4 26/30 test,
  25/30 dev; golfed-v4 21/30 and 19/30 at 9.3K chars). The bed measures agents that see one instance; held-out
  claims should use `beds/sealed/`.
- The 7,000-character budget is this audit's operational reading of "a ≤40-line heuristic"; a more skilled golfer
  than the auditor might fit more handlers into it. The measured gap is 2.3K characters (25% of golfed-v4).
- 12/1200 relabels (all d5) still fall back to a profile that hints at a moved row.
- The prose side of the reference is still checked by construction and by reading samples (now including every
  4.0.0 template), not by an independent reader. No model has been run against 4.0.0.
