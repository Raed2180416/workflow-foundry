# BUILD-NOTES

## Procedure in code
Parses all notebook formats (fixed-width exports, markdown plates, CSV, summary sheets, bench logs) and the raw export;
converts units, maps labels, uses clean re-reads (SOP section 3), applies flag/temperature exclusions, relabels, swaps,
dilution rescaling; unweighted Michaelis-Menten fit; inhibitor conditions share the reference Vmax.

## Judges (tiers)
- label-condition, doc-units, dilutions (haiku → opus); well-events (opus → sonnet). Quotes must occur in the sources; ids must be known.

## Guards / invariants
A format guard per parser, SOP shape, reread unit, inhibitor reference; invariants: unique wells, planned levels,
finite values, per-document scale, sane fits.

## This recompile
- trace-0 and trace-1 deopted on `bench-reread-form`. I added the two bench re-read forms they showed: the lower-gain
  re-read with an inline unit (the unit is checked against the first read), and "Fogged lid, wiped and re-read: <n>"
  (only on a bare-number well). Any other re-read wording still deopts.
- CSV qc re-reads: I added "re-read after wiping: <n>", "wiped and re-read: <n>" and "re-read → <n> (clean)"
  (trace-0, trace-7, trace-1). The agents used the re-read in each case, as SOP section 3 requires. Any other qc re-read
  wording now deopts (`csv-reread-form`) instead of quietly using the first read.

## check-traces
Baseline: 9/11 exact, trace-0/1 deopt. After the fix, live runs: trace-0 and case-1 exact. trace-1 was 97% with only the
bench fix (C1 km), then exact in a $0 replay of its recorded judge values. After that the $1.5 build budget ran out, so
the final full run deopted on budget, not on code. Offline with judges stubbed, every case parses past all guards.
Judge prompts are unchanged outside trace-0/1. The CSV change alters only trace-0 (verified) and trace-7 (replay: C5
now equals the agent's). No disagreements are known.
