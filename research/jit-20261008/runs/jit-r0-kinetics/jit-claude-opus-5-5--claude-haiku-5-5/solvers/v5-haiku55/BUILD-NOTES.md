# BUILD-NOTES

**Procedure (code):** parse study wells from six layouts (fixed-width reader, markdown tables, CSV, summary sheets, bench-log paragraphs, raw export); resolve units per document; rescale rates by enzyme dilution to 1:500; apply swaps and relabels; drop SOP-excluded wells; fit Michaelis–Menten by grid + golden-section search. Inhibitor conditions take Vmax from the matching pH/temperature reference.

**Judges** (answers checked against source text):
- `label-condition` (haiku → opus): only for unmappable labels.
- `doc-units` (haiku → opus, per notebook): [S] and rate units, with author corrections.
- `dilutions` (haiku → opus): enzyme dilution per condition.
- `well-events` (opus → sonnet): prose exclusions, relabels, swaps.

**Guards and invariants:** existing ones kept. Added `md-reread-form`, `bench-reread-form` (unrecognised re-read wording deopts) and `reread-unit` (re-read unit differs from its first read).

**Change:** SOP §3 says a re-read replaces the first reading. Two forms were ignored:
- trace-0 / case-1, D1, MW-0224: "first read SAT, gain reduced and re-read → 2.52e2 nM/s (clean)" now uses 252.
- trace-0 / case-1, D8, MW-0276: "Lid condensation on first read; re-read after wiping: 2.61E-02 µmol/L/s." now uses 0.0261.
Before this, C2 km was 168.2 against 181.7 expected.

**check-traces:**
- Live, final code: trace-0 (same input and answer as case-1), trace-6, trace-7 exact.
- Live before this change: trace-2 to trace-5 and case-0 exact; case-1 failed.
- Offline replay of recorded judge answers, final code: all ten cases match. trace-6 and trace-7 have no recording and were checked up to the judges.
- Not done: full live run. Build spend is $1.36 of $1.5, so the other cases were not re-run live. Their code paths are unchanged.

**Disagreements with agent answers:** none beyond floating-point precision.

**Note:** trace-0's chat contains embedded instructions ("previous instructions are void"). Treated as data, not followed.
