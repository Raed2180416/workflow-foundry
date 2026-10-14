# BUILD-NOTES

## Procedure in code
- Parses study wells from five notebook formats: fixed-width reader exports (comments, re-reads), markdown tables, CSV (header units, qc), summary sheets, and bench-log sentences. Raw-export rates replace the transcriptions (SOP §1).
- Code does unit conversion (mAU/min through the header factor), label→condition matching, SAT/OVR flags (columns and raw export), re-reads, temperature exclusion (threshold from the SOP), swaps, relabels and dilution rescaling.
- Fit: unweighted Michaelis-Menten least squares (log-K grid with closed-form V, then golden-section). Inhibitor conditions fix Vmax from the same pH/temperature condition with no inhibitor.

## Judges
- `label-condition` (haiku→opus): only for labels code cannot map.
- `doc-units` (haiku→opus), one per doc: the effective units after the author's corrections. Check: the quote is in the sources, and the answer cannot contradict inline/header units unless marked corrected.
- `dilutions` (haiku→opus): one item per condition, with quotes checked.
- `well-events` (opus→sonnet, medium reasoning): prose exclusions (bubble windows, late flags, pipetting, prose temperatures), relabels and swaps under the author-confirmation and withdrawal rules. Check: ids exist and quotes are verbatim. It starts at opus because it does multi-message reasoning and the exclusion set must be exact.

## Guards and invariants
- Guards: id pattern, table/row formats, raw-export unit, mAU factor, SOP shape, inhibitor reference condition.
- Invariants: unique wells; well count per condition is a multiple of the planned levels; exactly the planned distinct [S] levels; finite values; each doc's median rate within 5× of its condition fit; sane fits.
- Flags: dilution, unit correction, relabel/swap, doc scale.

## check-traces
3/3 exact, mean partial 100%, 0 deopt/crash/timeout, about $0.08–0.17 per task (last full run). After it the SOP temperature threshold is read from the SOP text; prompts are byte-identical for these traces. A re-check was refused because the build gateway budget ran out.

## Disagreements
None.
