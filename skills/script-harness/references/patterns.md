# Standard patterns (proven shapes)

Each pattern is a few functions. Compose them; do not invent a general agent loop.
Helpers worth writing once: `mapLimit(items, n, fn)` (parallel with a cap, results in order,
errors collected per item) and `judge(models, args, check)` (try the cheapest model, move up
on a thrown error or a failed `check`, at most two steps).

## 1. Split → batched extract → assemble (map–reduce over items)
`split(items into batches with ids)` → `mapLimit(batches, 4, b => judge(… typed rows, check: ids echo))` →
`assemble(validate, normalise, merge)`. Use for any input with many records, lines, documents
or files. Batch size 4–8.

## 2. Raw-and-reading extraction
The call returns, per field, `x` (its interpretation) and `x_as_written` (verbatim span). Code
parses `x_as_written` by the documented convention and uses `x` only if parsing fails. Use
for dates, numbers, units, currencies, codes, identifiers.

## 3. Classify with an enum (cascade)
`judge([cheapest, next], {schema: {label: enum, ...}})` with checks that reject impossible
combinations, so they move up a model.

## 4. Pairwise judgment with blocking
`candidate pairs by cheap keys (code)` → `mapLimit(pairs, judge(same? boolean + reason enum))` →
`union-find / ranking (code)`. Use when matching or deduplicating needs judgment but most pairs
are obviously different.

## 5. Rule application in code
Rules stated in the task text (precedence, thresholds, conflict policy, rounding, conversions)
are implemented in code after the judgments, never left to a model over many items.

## 6. Generate → verify → retry (bounded)
`for k attempts: candidate = judge(generate) → run checks/tests in code` until pass. For code
edits: write the candidate to a scratch file and run its tests with a child process.

## 7. Best-of-N with a verifier
`mapLimit(N seeds, generate → verify)` → `select first passing / highest score`. Use only when
a reliable executable check exists; otherwise prefer pattern 6.

## 8. Evidence → hypothesis → check (diagnosis)
`mapLimit(sources, summarise into typed facts)` → `timeline / join (code)` →
`judge(choose hypothesis from enum given compact facts)` → `check consistency with facts (code)`.
Use for root-cause analysis, research synthesis with conflicting sources, triage.

## 9. Structural check before answering
Check invariants of the final answer (counts, uniqueness, required fields, totals) in code;
log failures to stderr, repair what code can repair, then print the answer.
