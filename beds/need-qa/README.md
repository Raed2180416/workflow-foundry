# need-qa ("qa-anchors"): short exact-match questions over small generated data

**Routing anchor for the need router (experiments/need-router), not a Tier-A bed.**
**Kind:** oneshot. **Role:** `need-anchor`. **Domain:** short exact-match QA. **Version:** 1.0.0.
Everything is fictional and generated: companies, depots, clients, ports, calendars, units and items are
invented from syllable pools (a coincidental resemblance to a real name is possible and meaningless).
No benchmark data is copied. No model was called to build or test this bed ($0).

## Intended class (a HYPOTHESIS, not a fact)

The family is meant to be the **negative class** of the need router: tasks for which **one model call should
suffice** (no workflow, no agent loop). That is a hypothesis about the family. Nothing here has been measured on a
model; the router's paired labels (direct call vs. agent vs. workflow modes) are what would confirm or refute it, per
difficulty and per subtype. In particular, nobody should assume a single call is enough at difficulty 5, or for a
cheap model, before the labels exist.

The contract's "a 20-line script must not solve it" rule is waived for this family on purpose. A solver that reads only
the prompt and `inputs` exists (`view-solver.mjs`, about 100 lines of template parsing plus arithmetic). It is used by
the tests to show the question determines the truth. Script-solvability is expected for an anchor and is **not**
evidence about model behaviour.

## What one task is

One task is one short question (three prompt lines: scenario, `Question:`, reply format) plus the data in `inputs`
(tables or a calendar). The solver replies `{"answer": <number or string>}`. Four subtypes, dealt by seed
(seeds are grouped in blocks of four consecutive integers, each block a seeded permutation of the four subtypes, so every
window of 40 seeds contains each subtype 9 to 11 times; the subtype of a seed does not depend on the difficulty):

| Subtype | Data | Example question (paraphrased) | Answer |
|---|---|---|---|
| `ledger` | `shipments` table (id, depot, grade, item, units, price) | total units / count / max / min, or total value (units x price), or which depot has the highest total value, over rows matching up to 3 filters | integer, or a depot name |
| `lookup` | `parcels` and `ports` joined on `port_code` | the region / fee / dock days of the port of parcel X; the total shipping charge (crates x fee) of a client's parcels with filters on both tables | integer, or a port / region name |
| `calendar` | `calendar` (months with lengths, weekday names) and a `festivals` table | the date N days after D; the weekday N days after D; the Nth business day after D (rest days, leap rule, festival days); a business-day count between two dates | `<month> <day>, year <year>`, a weekday name, or an integer |
| `convert` | `relations` ("1 from = factor to", usable both ways) and `inventory` (item, kind, status, qty, unit) | one item's quantity, or the total of filtered items, in a stated unit, rounded half up to 0, 1 or 2 decimals | number |

All truths are computed with integers and BigInt fractions (no floating point). Conversion truths that fall within 0.01 of a
last-place unit of a rounding tie (that is, `|frac(truth x 10^dp) - 1/2| < 0.01`, where `dp` is the number of decimals asked
for) are never generated.

## Difficulty knob

`difficulty` 1..5 sets two independent levels, **size** (rows and distractors) and **steps** (filters, hops, rules). By
default both equal the difficulty.

| Level | ledger | lookup | calendar | convert |
|---|---|---|---|---|
| size 1..5: main table rows | 6, 10, 15, 22, 32 | parcels 6, 10, 15, 22, 32 | festivals 3, 6, 10, 18, 30 | inventory 6, 10, 15, 22, 32 |
| size 1..5: other | depots 3, 3, 4, 5, 6 | ports 4, 5, 8, 12, 16; clients 2, 3, 4, 6, 8 | months 4, 5, 6, 7, 8 | units 4, 5, 6, 8, 10 |
| steps 1 | 1 categorical filter | attribute of the port of one parcel | date N days after D, same year | one item, one relation |
| steps 2 | 2 categorical filters | same, parcel found by (client, status) | same, across a year boundary | one item, two chained relations |
| steps 3 | 1 categorical + 1 numeric threshold | one parcel's charge (crates x fee) | weekday N days after D | total of one kind, chains up to 2 hops |
| steps 4 | 2 categorical + threshold; often units x price | a client's total charge, status not S | Nth business day (2 rest days; every 4th year has an extra day) | ... and status not S |
| steps 5 | total value, or "which depot has the highest total value" | ... also restricted to one port region | festival days are not business days; Nth business day or a count | ... and a quantity threshold, chains up to 3 hops, always 2 decimals |

### Expected input size (tokens) per difficulty

Tokens are estimated as `ceil(bytes / 4)`, the formula used elsewhere in Foundry; it is not a tokenizer. "Compact" is
`JSON.stringify(inputs) + prompt` (the need-router feature formula); "pretty" is what a single-call arm sees
(`prompt` plus `inputs.json` indented by one space). Measured on dev seeds 601-640 (40 tasks per level).

| Difficulty | Compact median (min-max) | Pretty median (max) | By subtype, compact range |
|---|---|---|---|
| 1 | 266 (232-319) | 324 (407) | ledger 232-242, lookup 314-319, calendar 263-268, convert 264-268 |
| 2 | 340 (308-442) | 439 (568) | ledger 330-342, lookup 430-442, calendar 308-317, convert 347-355 |
| 3 | 449 (366-613) | 598 (802) | ledger 444-455, lookup 600-613, calendar 366-376, convert 444-458 |
| 4 | 616 (538-851) | 827 (1124) | ledger 606-634, lookup 841-851, calendar 538-547, convert 606-621 |
| 5 | 841 (694-1165) | 1142 (1547) | ledger 848-869, lookup 1149-1165, calendar 694-708, convert 822-834 |

Difficulty 3 is therefore far below the 6-15K-token target of the general contract; that target does not apply to a family
whose purpose is short questions. The tests assert difficulty 5 stays under 2000 tokens by both formulas for every dev
seed, and that the per-subtype medians strictly increase with difficulty.

### Shortcut breakers: pulling length and structure apart

`generate({seed, split, difficulty, size, steps})` accepts optional integer overrides `size` and `steps` (1..5, each
defaulting to the difficulty). A non-default task carries `task.knobs = {size, steps}` and the id suffix
`/size<n>-steps<m>`; default tasks are exactly the contract shape. This is an extension for building pairs the router
cannot separate by length alone (the standard harness does not pass these arguments; a caller must):

- **same structure, different length:** for example `{size: 1, steps: 3}` vs `{size: 5, steps: 3}` (same question
  template, 2.4x to 3.5x the tokens: calendar about 2.5x, the other three subtypes 3.1x to 3.5x; measured at steps 3 on dev
  seeds 601-640);
- **same length, different structure:** for example `{size: 3, steps: 1}` vs `{size: 3, steps: 5}` (token ratio 1.01 to
  1.16 by subtype, with a deeper question).

Measured on dev seeds 601-640 over the whole 5 x 5 grid (25 settings x 40 seeds = 1000 tasks): the correlation of
compact tokens with `size` is 0.98 within each of ledger, lookup and convert and 0.95 for calendar; with `steps` it is
0.00 to 0.04 for those three and 0.17 for calendar (the calendar rule text grows with steps). The number of words in the question
follows `steps` (correlation 0.80 to 0.97 within a subtype), so a router feature that counts prompt words is still a
partial proxy for steps; that is a property of any templated question, not removed here.

## Output and answer comparison

Output schema: `{"answer": <string or number>}`, `additionalProperties: false`, `answer` at most 80 characters; the
portable subset only. Anything else is schema-invalid (`pass: false`, `details.schemaErrors`), including a correct
answer wrapped with extra properties (also properties named like `Object.prototype` members, such as `constructor`,
`toString` or a parsed `__proto__` key: only own properties count as declared).

The comparison is by truth kind and is stated in each prompt (a bare number, text as written in the data, or a date):

- **int** (counts, sums, fees; exact quantities): the submitted value must have no fractional part and equal the truth.
  Accepted spellings: `1234`, `"1234"`, `" 1234 "`, `"1,234"`, `"1234.0"`, `"1.234e3"`. Rejected: `1234.4`, units
  attached (`"1234 units"`), words, negatives, empty.
- **round** (conversions, with a stated number of decimals `dp`): the submitted value is rounded **half up to `dp`
  decimals** and must equal the truth. The numeric tolerance is therefore the half-open interval
  `[truth - 0.5 * 10^-dp, truth + 0.5 * 10^-dp)`: an unrounded `12.3456` matches the truth `12.35`, `12.34` and `12.36` do
  not. Arithmetic is exact (decimal strings are parsed to BigInt, not floats).
- **text** (names, weekdays): trim, lowercase, collapse whitespace, strip wrapping quotes and one final full stop, then
  exact equality. No alias handling, no fuzzy matching.
- **date** (`<month> <day>, year <year>`): month name case-insensitive, the comma and the word `year` optional, leading
  zeros in the day ignored, wrapping quotes stripped as for text, and an ordinal suffix on the day (`st`, `nd`, `rd`, `th`)
  ignored (`Aldemere 5, year 301` = `aldemere 05 301` = `"Aldemere 5th, year 301"`). A different word order such as
  `5 Aldemere 301`, an ISO-style `301-1-5`, a missing month, day or year, and units are rejected.

Details returned by the oracle do not contain the truth: `{subtype, kind, size, steps, reason, normalized}` where
`normalized` is the submitted value after normalisation. Score is 0 or 1.

## Oracle, reference and controls

- `oracle(task, output)` recomputes the case from `(seed, split, difficulty, knobs)` and ignores the prompt, inputs and budget
  of the task object it is handed (tested: rewriting them changes no verdict).
- `referenceSolve(task)` returns the exact truth (trusted host code). `view-solver.mjs` is the separate solver that parses
  only the prompt and inputs; the tests require it to pass the oracle for 40 seeds x 5 difficulties x 3 knob shapes x 2
  splits.
- Generation redraws a case until it is well posed: nonzero truth; every near miss and alternative really differs from the
  truth under the oracle's own comparison; text answers are never named in the question; no derived answer of 100 or more
  (or non-integer) appears as a number in the prompt or inputs, and no derived date appears in them. Row counts, the
  planted boundary row of a threshold filter and the unique-match conditions of lookups are enforced the same way.
- Bad controls (each fails for all 40 dev seeds at every difficulty; also for 24 dev seeds at each of the knob settings
  size/steps = 1/1, 1/5, 5/1 and 5/5 at difficulty 3):

| Control | What it submits |
|---|---|
| `empty` | `""` |
| `shuffled-or-corrupted` | the truth with digits rotated (numbers) or characters reversed (text and dates) |
| `plausible-but-wrong:first-near-miss` | the answer under the first single, plausible mistake of the subtype |
| `plausible-but-wrong:last-near-miss` | the answer under the last such mistake |
| `plausible-but-wrong:off-by-one` | the truth plus one unit (one in the last decimal place, one day, or another valid entity) |
| `constant-guess` | `0`, a valid but wrong entity, or a wrong date |

Near-miss mistakes by subtype: ledger (boundary `>` vs `>=`, a dropped filter, "not B" read as "B", forgotten price);
lookup (another parcel of the same client, the adjacent port row, the neighbouring parcel, forgotten crates or fee, the
excluded status kept, the region filter ignored); calendar (start date counted as day 1, one day too many, calendar days
instead of business days, festivals ignored, both ends or the first day excluded, leap day forgotten); convert (one
relation read backwards, a filter ignored or its boundary flipped, truncation instead of rounding).

## Evidence status

Development and diagnostic only. Seeds 601-640 (split `dev`) are used throughout, and the tests (and the checks used to
tune table sizes and generator feasibility) are development evidence, not held-out evidence. No sealed or `test`-split
results exist for this family. Not claimed: that one call suffices at any difficulty, that the subtypes have equal
difficulty, or that anything here transfers to real-world data. Untrusted text: this family contains **no adversarial or
injection strings**; all text is templated.

## Files

| File | Role |
|---|---|
| `index.mjs` | Contract interface: `family`, `outputSchema`, `generate`, `oracle`, `referenceSolve`, `badControls`; also `subtypeOf`, `describeTask` (analysis helper that keeps subtype and near-miss names off the task), `SUBTYPES`, `VERSION` |
| `core.mjs` | Names, exact fractions, answer normalisation and comparison, portable schema validator, prompt assembly |
| `sub-ledger.mjs`, `sub-lookup.mjs`, `sub-calendar.mjs`, `sub-convert.mjs` | One builder per subtype: tables, question, truth, near misses |
| `view-solver.mjs` | Independent solver from prompt + inputs only (test cross-check and script baseline) |
| `need-qa.test.mjs` | node:test suite |

Run: `node --test beds/need-qa/*.test.mjs` (Node 24, built-ins only; about 3 seconds).
