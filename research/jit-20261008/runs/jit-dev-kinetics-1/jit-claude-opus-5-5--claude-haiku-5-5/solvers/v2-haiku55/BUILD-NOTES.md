# BUILD-NOTES

## Procedure in code
- Parsers for each sheet format: reader tables, markdown tables, bench logs, CSV (units in headers), summary sheets, raw export, master-mix log.
- Units, labels, flags, re-reads, dilution rescaling, swaps, unit fixes.
- Fit: unweighted least squares for Vmax·S/(Km+S), profiled over Km; inhibitor conditions reuse the matching Vmax.

## Judges
- `prose-events-a` / `-b`: two reads of notes, addenda, chat and master-mix log. Tiers: haiku, then opus.
- `prose-events-arbiter`: only when the reads disagree. Tiers: opus, then sonnet.
- Checks: quotes in the sources (case-folded); src ids exist; bubble clocks HH:MM; dilution as 1:N or "twice/half as much".

## Guards and invariants
- Guards: raw-export-unit, sop-sections, summary-entry-parsed, summary-rep-known, all-rows-found, rows-have-planned-levels, row-labels-map, unique-wells, raw-ids-on-sheets, abs-conversion, all-values-numeric, inhibitor-has-reference.
- Invariants: wells-conserved, enough-points, fit-interior, replicate-rows-agree.

## Changes this round
- CSV unit headers (trace-0), which had deopted `all-values-numeric`.
- "Twice as much" dilution wording (trace-1), which had deopted the judge.
- Block temperature for "this read" applies to all wells of that bench read (trace-1).
- Judge prompt: "as for this well:" row notes and end-of-read bubbles (trace-4).

## check-traces (final)
- 5/5 ran: no crash, deopt or timeout.
- Regressions 0/0: no `regressions/` directory exists here, so that gate is untested.
- Excluded sets match agent answers for trace-0, 1, 2, 4.
- Exact JSON: 0/5. Trace-0, 2, 4 differ by ≤1e-5 relative; trace-1 by ≤3e-5 (agent answer is rounded).

## Disagreement: trace-3 excluded_samples
- We also exclude DR-0571–0576, 0578, 0579; the agent excluded only DR-0577.
- Decisive sentence: "Block read 23.7 °C during this read." SOP 2.4 excludes wells whose logged block temperature is more than 1.0 °C from setpoint (25 °C). Read literally, it covers all nine wells of the read.
- Per-well reading instead: C1 moves about +0.9% Vmax, +2.8% Km (inside tolerance).
