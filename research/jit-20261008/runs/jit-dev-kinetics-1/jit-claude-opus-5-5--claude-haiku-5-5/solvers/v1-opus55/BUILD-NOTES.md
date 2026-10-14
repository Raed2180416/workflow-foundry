# BUILD-NOTES

**Code:** solve.mjs parses every sheet format seen in the traces:
- reader-export tables (comments, re-reads, the mAU/min conversion)
- markdown tables
- bench-log prose
- CSV blocks
- summary sheets
- raw instrument exports

It also parses labels and units. The rate used for a well is the re-read, else the raw export, else the transcription. Code applies SAT/OVR flags and a >1.0 °C temperature check (K converted). It then applies the judge's swaps, relabels, unit fixes, exclusions and dilutions. Bubble clock times are compared against the read window, and dilution rescaling multiplies by dilution/500. The fit is unweighted least squares. Inhibitor conditions keep the Vmax of the matching uninhibited condition and fit only Km.

**Judges:** `prose-events-a` and `-b` are two independent reads on tiers haiku→opus. Each returns exclusions, relabels, swaps, unit fixes and dilutions, with src ids and verbatim quotes. Checks: quotes must appear verbatim, ids must exist, clocks must be HH:MM, units must parse, every condition needs a dilution, and a non-standard dilution must appear in its quote. If the two reads imply different decisions, `prose-events-arbiter` (opus→sonnet) decides.

**Guards:**
- row count matches the memo's "N plate rows"
- every row has the planned number of levels
- every label maps to one condition
- well ids are unique
- raw-export ids appear on a sheet
- units are known
- the SOP is present
- each inhibitor condition has a reference

**Invariants:** kept + excluded = all wells; at least 5 points per fit; Km is not at the edge of the grid; replicate rows agree in scale (0.6–1.6).

**check-traces:** 3/3 with no crash, deopt or timeout, at about $0.01 per task. `excluded_samples` equals the agent's set on every trace. vmax/km differ only by fitting round-off (≤1e-5 relative). There are no substantive disagreements.
