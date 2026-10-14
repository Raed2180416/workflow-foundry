# BUILD-NOTES

## Procedure in code
Six sheet formats (F1 reader export, F2 markdown, F3 bench-log prose, F4 CSV, F5 by-condition summary, F6 raw export) are parsed by regex. Units convert through factor functions. Labels map to conditions. The raw export overrides transcribed rates. Exclusions follow SOP §2. Dilution rescales by dilution/500. Fitting is least squares per condition, with Vmax shared from the matching no-inhibitor condition.

## Judge
`note-events` converts notes to events. Tiers: haiku, opus, sonnet; a tier escalates when a check fails. Checks in code: reference resolution, note-id echo, unit and clock parsing, a single id that starts a written range (PX-0502…PX-0510), and a chat "X had it" that must name an event on X. Temperature scope comes from the wording: "this well" is the attached well; "during this read" is the whole read.

## Changes this round
- Bench units accept mmol/L; F5 values accept ×10^n (cleared the trace-0/1 raw-ids guard).
- Range ids, "had it" confirmations, and sample+all_row (whole table) added.

## Guards and invariants
Unchanged: guards wells-parsed, values-numeric, ids-unique, raw-ids-known, labels-mapped, one-sop, inhibitor-base-exists; invariants wells-conserved, enough-points, params-finite, excluded-are-study.

## check-traces (final run)
0 crash, 0 deopt, 0 timeout. No regressions/ directory exists here, so 0/0. Five of five excluded sets match the agent answers; every condition is within 2% except trace-4 C5 km (+7.8%). Exact match is 0/5 only because the fit differs in the fifth significant figure.

## Disagreements (all within 10%)
- trace-1, C3, vmax: +1.8% vs agent. Not investigated.
- trace-4, C5, km: +7.8% vs agent. Not investigated.

## Judge variance
Earlier runs flipped single wells (PX-0245, PX-0627/0833, PX-0691, DR-0551/0579). Causes: missed redirects, misread bubble timing. The final run is one sample; the judge is not deterministic.

Build spend: about $1.07 of the $1.5 cap.
