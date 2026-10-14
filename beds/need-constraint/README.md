# need-constraint (bed v1.0.0): constraint-checked one-off generation

**Routing anchor for the need router (experiments/need-router), not a Tier-A bed.**
The contract's "a 20-line script must not solve it" rule (beds/CONTRACT.md, Rules) does not apply here: these
tasks are meant to be solvable without a workflow, and each subtype has a short reference solver (tens of lines).

**Intended class (HYPOTHESIS, not measured, no model has been run on this bed): one direct call suffices.**
The expectation is that a single model call, with no tools and no planning scaffold, can write an answer that
passes the constraint check. That is a label to test, not a fact. At the higher difficulties the counting and
negative constraints may well need a retry loop or an agent; if so, the label is wrong for those cells and the
paired-label run (a later step) will show it. Nothing in this README or in the tests depends on the hypothesis.

Why the family exists: the need router's benchmark needs negative-class families (tasks where one call or a plain
agent is enough) and shortcut-breakers (pairs that differ in length but not in structure, or in structure but not
in length). Here the structure is constant per subtype (one answer, one checker, many valid answers) while the
input length grows about 1.4x to 2.7x from difficulty 1 to 5, and different subtypes have near-identical lengths
at different difficulties (see "Length versus structure").

## One task

`generate({seed, split, difficulty})` picks the subtype from the seed alone: `seed mod 4` = 0 names, 1 sentence,
2 order, 3 schedule (`split` is only an RNG salt). Consumers that take fewer than four consecutive seeds see only
some subtypes; dev seeds 601-640 give ten tasks per subtype. The subtype is stated in `inputs.subtype`.

| subtype | the task | answer | many answers? |
|---|---|---|---|
| names (a) | invent N fictional product names under letter, length, forbidden-sequence, reserved-name and distinctness rules | `{"names": [...]}` | astronomically many (not enumerated) |
| sentence (b) | write one sentence of k1..k2 words that contains given words in a given order and none of a forbidden set (plus optional extras) | `{"sentence": "..."}` | astronomically many (not enumerated) |
| order (c) | order a set of fictional items so that every stated before / immediately-before / not-adjacent / fixed-position / between / spacing statement holds | `{"order": [...]}` | at least 4 by construction; measured median 8, 11, 25, 420, 124 for d1..d5 (capped at 2000) |
| schedule (d) | fill a weekly rota under exact staffing counts, availability, one shift per day, weekly min/max shifts, and (at higher difficulty) never-together pairs, a rest rule, lead coverage, trainee supervision and a streak cap | `{"schedule": [{day, shift, person}, ...]}` | at least 2 verified by construction; 3 to 13 distinct rotas in 13 randomised searches (lower bound only) |

The rules are in the prompt in prose (this is the part that needs reading carefully: "whole words", "ignore case",
"in either direction", "a slot is one shift on one day"); bulk data is in `inputs` (reserved names, required and
forbidden words, items and statements, the rota tables). Each datum appears once, so single-call arms that inline
`prompt + inputs.json` do not pay twice.

The published `outputSchema` is one object with four optional properties (`names`, `sentence`, `order`, `schedule`)
and uses only the portable subset (the allowlist in `src/schema-subset.mjs`). The oracle requires exactly the one the
task asks for. "Exactly one of four" cannot be written in that subset (`oneOf`, `anyOf`, `minProperties` and
`maxProperties` are all outside the allowlist), so the static schema accepts `{}`, a two-property object and another
subtype's property. The bed does not hide that gap: `details.schemaValid` means "valid under `outputSchema`" (the same
answer as the shared validator, `validateData` in `src/validate.mjs`, tested differentially), and the one-field rule
is reported apart as `details.fieldMismatch` (verdict `pass:false`, `score:0`, `failed:['field']`).
`outputSchemaFor(task)` returns the strict per-task schema (that one property required, nothing else allowed; also
portable) for arms that want structured output enforced; `validateData(outputSchemaFor(task), o)` accepts `o` exactly
when the oracle reports `schemaValid && !fieldMismatch`. The Task object itself is unchanged (contract shape).

## Difficulty knob

Difficulty scales the number of items and constraints; the structure does not change. Exact tables are `KNOBS` in
`gen.mjs`.

| d | names (N; extra rules) | sentence (required words / forbidden words / window width; extras) | order (items / statements; kinds) | schedule (days x shifts, people; rules) |
|---|---|---|---|---|
| 1 | 3; length, 2 forbidden sequences | 2 / 3 / 6; none | 5 / 4; before, immediately before | 4 x 1, 4; availability, limits |
| 2 | 5; + start letters, 1 banned letter, 4 reserved | 3 / 5 / 5; 1 extra | 7 / 7; + not adjacent | 5 x 2, 5; need 1-2 |
| 3 | 8; + end letters, 2 banned, max 2 repeats, 8 reserved | 4 / 8 / 4; 2 extras | 9 / 11; + fixed position, between | 6 x 2, 7; + 1 never-together pair, rest rule, lead on one shift |
| 4 | 11; + must-contain letter, vowels 2-3, 12 reserved | 5 / 11 / 4; 4 extras | 12 / 16; + at-least-d between, neither end | 7 x 2, 8; need 2 (3 at weekend), 2 pairs, 1 trainee, streak cap 5 |
| 5 | 14; + distinct initials, letter quota (3 names with a given letter), 16 reserved | 6 / 14 / 3; 5 extras | 15 / 22; + exactly-d between | 7 x 3, 10; need 1-2 (+1 weekend), 3 pairs, lead on every slot, 2 trainees |

Sentence extras (drawn at random from six): no repeated word, exact comma count, a banned letter, a word of 9+
letters, fixed first and last words, at least one word between consecutive required words. The word window is
widened when the extras need more words. Schedule limits are per-person min/max shifts placed around a hidden
feasible rota, tighter as difficulty rises; availability is derived so that it never contradicts that rota.

## Expected input size (tokens)

Measured on dev seeds 601-640 with `estimateTokens` (UTF-8 bytes / 4) of `prompt` + `JSON(inputs)`: median per
cell (ten tasks per cell; min-max is within about 10%). The prompt alone is 170-340 tokens.

| d | names | sentence | order | schedule |
|---|---|---|---|---|
| 1 | 181 | 273 | 285 | 398 |
| 2 | 246 | 290 | 329 | 509 |
| 3 | 297 | 315 | 388 | 724 |
| 4 | 348 | 354 | 450 | 888 |
| 5 | 387 | 379 | 540 | 1059 |

At difficulty 3 these are roughly 8 to 50 times smaller than the contract's level-3 aim for Tier-A beds (6-15K
tokens). That is on purpose for a direct-call anchor, and it is exactly why a router that keys on input length
would be tempted to send this family down the direct path for the wrong reason. `budget` is `{actions: 3, tokens: size + 1500}`, a suggestion only.

## Oracle

The oracle is a constraint checker. It never compares the answer with the reference answer, so any valid answer
passes. It rebuilds the rule set from `(seed, split, difficulty)` and ignores everything in the task object
(tampered `prompt`/`inputs` do not change the verdict; a test forges them). Output is copied as plain data first,
so accessors, proxies, exotic prototypes and sparse arrays are schema-invalid; the oracle never throws.

- `pass` is true when every active rule group holds; `score` is the fraction of active groups that hold (so it is
  1 exactly when `pass`), 0 for schema-invalid output and for a field mismatch. `details.failed` names the failing groups.
- Schema-invalid (`details.schemaValid:false`, i.e. rejected by `outputSchema`): not an object, an unexpected
  property, wrong types, empty or oversized strings (lengths count code points, as the shared validator does),
  oversized arrays, schedule rows with missing or extra fields, and non-plain data.
- Field mismatch (`details.schemaValid:true`, `details.fieldMismatch:true`, `failed:['field']`, `pass:false`,
  `score:0`): the output is schema-valid but is not exactly the one property the task asks for: `{}`, two or more
  properties, or another subtype's property. A schema-invalid output can also be a field mismatch at the same time
  (`fieldMismatch` is reported either way; `errors` lists both kinds).
- names: surrounding spaces ignored; letters only; every rule is case-insensitive; distinctness ignores case.
- sentence: surrounding spaces ignored; form is capital first letter, letters, single spaces, optional commas
  after words, one final period; a word is a run of letters; required words must be whole words in order (if one
  occurs several times, some choice of occurrences must satisfy order and spacing); forbidden words are whole words.
  **Grammar and meaning are not checked**: a rule-abiding word salad passes. The prompt says so.
- order: entries must be exactly the item names (trimmed), each once; each statement kind is a group.
- schedule: day, shift and person strings must match the inputs exactly; one row per person per slot; each rule
  above is a group.

## Controls

`referenceSolve(task)` rebuilds the task and returns a solver answer (names and sentences by seeded construction
filtered through the checker's own rules, orders and rotas by depth-first search with pruning). `altSolve(task)` is
a second, different, verified-valid answer (the generator itself checks that two distinct answers exist);
higher `variant` values re-run the solvers on other streams.

| control | what it is | fails because |
|---|---|---|
| `empty` | the right field, empty | counts / form |
| `shuffled-or-corrupted` | reference with one deliberate corruption: a name duplicated in another case; two required words swapped; the two items of the first statement swapped (every order task starts with a `before` and an `immediately before`); an unknown person in one rota row | guaranteed by construction |
| `plausible-but-wrong` | the reference with the least damaging single edit: a name replaced by a forbidden-sequence or reserved variant; a filler word replaced by a forbidden word; an adjacent swap that breaks the fewest statement groups; one person swapped for another, preferring a swap that breaks one rule group | tests assert it is schema-valid and breaks 1 or 2 groups |
| `truncated` | the reference minus its last element (a required word is cut off for sentences) | counts |
| `wrong-field` | the reference content filed under another subtype's string-array property (`order` or `names`; cut to at most 40 strings of 40 characters so the published schema still accepts it) | field mismatch: `schemaValid:true`, `fieldMismatch:true` |

## Task text

Entities are fictional (coined names from syllable tables, invented catalogues, towns and kiosks); sentence words
are everyday English words. There are no prompt-injection or adversarial strings in any task text at any
difficulty, so there is nothing to mark. Prompt and inputs are data for the solver; the hidden material is the
planted rota/order and the solver answers, none of which is rendered.

Guards against free passes: the presented `items` list is never itself a valid ordering and never the planted one
(the leak test caught the first draft, where the shuffled list was sometimes a valid answer, so echoing the input
passed; the generator now reshuffles until it is not); no input
key or text contains an answer; reserved names that obey every per-name rule exist so that reusing one breaks
exactly one rule; the rota's availability never lists a slot the reference rota uses.

## Length versus structure

- Same structure, different length: every subtype grows from d1 to d5 by a factor of 2.1 (names), 1.4
  (sentence), 1.9 (order) and 2.7 (schedule) in median tokens, with the same answer field and the same checker.
- Different structure, similar length: 24 cell pairs of different subtypes are within 10% of each other's
  (lower-median) size, e.g. names d5 (387) and sentence d5 (379) and order d3 (388) and schedule d1 (398); order d5 (540) and
  schedule d2 (509). A test asserts at least four such pairs exist. The pairs depend on the current prompt
  wording and rule counts; recompute them if either changes.
- Not provided: an independent padding knob (long irrelevant background with the same structure). Difficulty is
  the only length lever here.

## Evidence

`node --test beds/need-constraint/*.test.mjs` runs 26 tests in about 4 seconds (dev seeds 601-640 only). They
show: interface and portable schema (also checked with the repo's `portableSchemaViolations`); determinism (byte-identical tasks, references and alternatives; the split
changes the task but not its subtype); `referenceSolve` passes for all 40 seeds at every difficulty (10 per
subtype); `altSolve` passes and differs for all of them (variants 1 and 2 too); all five controls fail for all
40 seeds at every difficulty; schema-invalid and non-plain output is rejected; the oracle ignores forged task
text; no hidden truth in prompt, inputs or keys; `generate`, `oracle` and `referenceSolve` each under 2 s and
200 MB at difficulty 5; difficulty and length monotonicity; hand-written checker cases for every rule of every
subtype with both outcomes (including whole-word matching, repeated required words, case folding, rest rule,
streaks, trainee supervision); every rule group can be made to fail by mutation.

Three tests cover the schema-versus-oracle defect found in review (the published schema accepted `{}`, two-property
objects and another subtype's property while `details.schemaValid` said false): the reviewer's cases are
schema-valid field mismatches that still fail; 2,040 outputs (references, alternatives, controls, hand-picked edge
cases including code-point lengths, and random objects) give the same accept/reject from `details.schemaValid` as the
shared validator on `outputSchema` (653 schema-valid field mismatches, 1,167 schema-invalid), and from
`schemaValid && !fieldMismatch` as the shared validator on `outputSchemaFor(task)`; both schemas stay in the portable
subset (a guard against fixing this with `minProperties`/`maxProperties`, which the repo allowlist rejects).
Mutating the code-point count or reporting field mismatches as schema errors makes them fail.

Two tests carry most of the weight for "the oracle accepts ANY valid answer":

- An independent reading of the rendered task (`indepNames`, `indepSentence`, `indepOrder`, `indepSchedule` in the
  test file) re-implements every rule from the prompt text and `inputs` only, sharing no code with the checker.
  The oracle's verdict equals the independent verdict on 6,200 answers: references, alternatives, controls and
  24 random single edits per task, 1,550 answers per subtype. About 1,000 of the edited answers are valid under
  the independent reading and differ from the reference (473 names, 342 sentences, 87 orders, 110 rotas, over
  50, 36, 30 and 35 tasks respectively); no solver produced them and the oracle accepted every one.
- The same test parses every order statement and every schedule rule back from the text and compares with the
  rule set the oracle uses (the first run found a wording mismatch in the independent reader, not in the bed).

Outside the test suite (scratch script, not committed): the same checks over seeds 0-800 x 5 difficulties
(4,005 tasks, alternating dev and test splits) on the final code gave no failures; generation plus oracle took at
most about 130 ms; about 1% of tasks needed a second or later generation attempt (the generator retries
deterministically; up to 40 attempts, the most used was 7).

## What this does not show

- Nothing about any model. The intended class is a hypothesis; no model call was made to build or test this bed.
- Not a Tier-A bed: each reference solver is a short script (tens of lines); the tasks need careful reading, not a workflow.
- Sentence grammar and meaning are unchecked, so a model that writes fluent text and a script that strings words
  together score the same. If the router study needs fluency, that needs a separate judge (not built).
- Order and schedule have a lower bound on valid answers, not a count; names and sentences are not enumerated.
- Dev seeds 601-640 are development evidence. Nothing here is sealed or held out, and `beds/sealed/` was not read.

## Files

- `index.mjs` interface (family, `outputSchema`, `generate`, `oracle`, `referenceSolve`, `altSolve`, `badControls`) plus
  `outputSchemaFor`, `schemaViolations`, `fieldViolations`, `validateOutput`, `subtypeOf`.
- `gen.mjs` task builder and difficulty tables; `check.mjs` the constraint checkers; `solve.mjs` the solvers;
  `lexicon.mjs` word material; `need-constraint.test.mjs` the tests.
