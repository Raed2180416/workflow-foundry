# BUILD-NOTES

## Result
- Full check-traces run: case-0, case-1 (regressions) and trace-2..trace-8 exact; no crash or timeout. trace-0 and trace-1 deopt on guard `bench-reread-form`.
- solve.mjs is byte-identical to that run's copy. No check changed, no guard widened.
- Not accepted: trace-0 and trace-1 still deopt. The build budget is spent ($1.26 of $1.5); the gateway refused a trial's opus call, so the new shapes could not be verified live.

## Procedure in code
Parse five notebook layouts (fixed-width export, markdown tables, CSV, summary sheets, bench-log paragraphs) plus the raw instrument export, which overrides transcriptions (SOP §1). Normalise units, map labels, apply re-reads (SOP §3), exclude SAT/OVR flags and off-setpoint temperatures, rescale by dilution, fit Vmax and Km by least squares (SOP §5); inhibitor Vmax is fixed to the matching no-inhibitor fit.

## Judges (narrow, batched, quotes checked against sources)
- label-condition: haiku-5-5, then opus-5-5; unmapped labels only.
- doc-units: haiku-5-5, then opus-5-5; one per notebook.
- dilutions: haiku-5-5, then opus-5-5; one item per condition.
- well-events: opus-5-5, then sonnet-5-5 (medium); exclusions, relabels, swaps.

## Guards and invariants
Guards: sample pattern, layout columns, unit headers, re-read forms and units, summary rows, bench sentences, SOP shape, inhibitor reference. Invariants: unique wells, levels per condition, planned levels, finite values, per-document scale, fit sanity.

## Not handled: trace-0 and trace-1
- trace-0: "First read flagged OVR; re-read at lower gain: 0.2615 µM s⁻¹, no flag." The agent used this re-read as a rate. SOP §3 supports that, but the full answer could not be checked live.
- trace-1: "Fogged lid, wiped and re-read: 0.834." The agent used it in place of the first read for QD-0744. Same status.
Two parse branches for these were drafted and reverted unverified.

## Disagreements with agent answers
None among the cases that ran; all nine match within tolerance.
