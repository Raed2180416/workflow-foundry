# BUILD-NOTES

## Procedure (code)
Parses five notebook shapes (fixed-width reader, markdown plates, CSV, summary sheets, bench-log paragraphs). Instrument raw exports override transcribed rates. Units, mAU conversion, the 1:500 dilution rescale and SOP exclusions (flag, bubble, temperature) are applied in code. Fit: grid search plus golden section, unweighted least squares per condition; inhibitor conditions fix Vmax to the inhibitor-free reference.

## Judges
- `label-condition` (haiku, opus): only labels code cannot map; index and condition_id enum checked.
- `doc-units` (haiku, opus): per document; quote checked against sources; unit must match inline or header units.
- `dilutions` (haiku, opus): one item per condition; quote checked.
- `well-events` (opus, sonnet, medium): SOP prose events; ids and quotes checked against sources.

## Guards and invariants
Guards: sample-pattern, raw-export-header/unit, fixed-width-columns/row, reread-row, mau-conversion, md-columns, md-header-units, csv-columns, summary-row, **summary-header (new)**, bench-sentence, bench-unparsed-id, sop-shape, raw-ids-known, inhibitor-reference.
Invariants: unique-wells, levels-per-condition, planned-levels, values-finite, doc-scale-consistent, fit-sane.

**Change:** `summary-header` deopts on a `Condition:` line not in the single-header form `(replicates rN = plate P row X)`. Trace-1's D11 puts two replicates on one header with `|`-joined rows, so its wells were never parsed; the relabel judge then named unknown ids on every tier ($0.08). No check was loosened. Trace-2..4 headers all match, so they are unaffected.

## check-traces result
- trace-2, trace-3, trace-4: exact (partial 100%). No crash, no timeout.
- trace-0: deopt, guard `bench-unparsed-id`, by design. Quote: "DR-0486: 6.12×10^2 at 0.5." The units sit only in the prose header, and I could not reproduce the agent's answer within budget.
- trace-1: deopt, guard `summary-header`, by design. Quote: "Condition: 30C/pH6.0 (replicates r3 = plate 5 row A, r4 = plate 6 row E)". Out-of-scope shape.

Disagreements with agent answers: none among answered cases. The two refused cases give no answer, so "regressions" pass by deopt. Spend: about $0.94 of $1.5.
