# Standard operators (proven shapes)

Each operator is a small subgraph. Compose them; do not invent a general agent loop.

## 1. Split → batched extract → assemble (map–reduce over items)
`code(split items into batches with ids)` → `map(concurrency 4, failure collect){ agent(extract batch → typed rows, checks: ids echo) }` → `code(validate, normalise, merge)`.
Use for any input with many records, lines, documents or files. Batch size 4–8.

## 2. Raw-and-reading extraction
Agent returns, per field, `x` (its interpretation) and `x_as_written` (verbatim span). A code node
parses `x_as_written` by the documented convention and uses `x` only if parsing fails. Use for
dates, numbers, units, currencies, codes, identifiers.

## 3. Classify with an enum (cascade)
`agent(class S/M, returns {label: enum, ...}, quarantined if input is untrusted)` with
`maxClass` one or two above; checks reject impossible combinations so they escalate.

## 4. Pairwise judgment with blocking
`code(candidate pairs by cheap keys)` → `map{ agent(same? boolean + reason enum) }` → `code(union-find / ranking)`.
Use when matching or deduplicating needs judgment but most pairs are obviously different.

## 5. Rule application in code
Rules stated in the task text (precedence, thresholds, conflict policy, rounding, conversions)
are implemented in a `code` node after the judgments, never left to a model over many items.

## 6. Generate → verify → retry (bounded)
`loop(maxIterations k){ agent(generate candidate) → verify(method code: run checks/tests) }` until pass.
For code edits: the verify node executes tests inside the sandbox (Python/JS `code` node can
`exec` the candidate source and run assertions).

## 7. Best-of-N with a verifier
`map(N seeds){ agent(generate) → verify }` → `code(select first passing / highest score)`.
Use only when a reliable executable check exists; otherwise prefer operator 6.

## 8. Evidence → hypothesis → check (diagnosis)
`map{ agent(summarise evidence per source into typed facts) }` → `code(timeline / join)` →
`agent(choose hypothesis from enum given compact facts)` → `verify(code: hypothesis consistent with facts)`.
Use for root-cause analysis, research synthesis with conflicting sources, triage.

## 9. Structural verify before answering
`verify(method code)` checking invariants of the final answer (counts, uniqueness, required
fields, totals) with `gate: false` (record) or `gate: true` (fail visibly), then `answer`.
