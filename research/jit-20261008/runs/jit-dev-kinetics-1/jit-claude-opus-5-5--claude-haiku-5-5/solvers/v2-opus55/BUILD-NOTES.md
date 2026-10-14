# BUILD-NOTES

**Procedure in code.** Parses every sheet format: reader exports (with re-reads and comments), markdown tables, bench-log paragraphs, CSV, summary sheets, the raw instrument export and the master-mix log. Code also handles units (unit headers, prose statements, references to another sheet, mAU conversion), maps labels to conditions, and applies re-read > raw export > transcription. It applies flag and temperature columns, the judged events (exclusions, relabels, swaps, unit fixes, dilutions), and rescales by dilution. It fits Michaelis-Menten (log grid plus golden-section search). Inhibitor conditions are fitted with Vmax fixed to the matching inhibitor-free condition.

**Recompile changes.**
- CSV columns can carry units in their names (`S_nM`, `rate_uM_per_s`, trace-0). The parser now reads them and is guarded by `csv-columns` and `csv-column-units`.
- The dilution check now also accepts a quote that states a multiple of the SOP dilution ("diluted twice as much as the SOP says", trace-1), as well as an explicit `1:N`.

**Judges.** `prose-events-a` and `prose-events-b` run in parallel on tiers haiku → opus. They return exclusions, relabels, swaps, unit_fixes and dilutions. Each item needs a verbatim quote and known well, sheet and condition ids, and dilutions must be consistent with their quote. If the decisions the two reads imply differ, `prose-events-arbiter` (opus → sonnet) decides.

**Guards.** `raw-export-unit`, `summary-entry-parsed`, `summary-rep-known`, `csv-columns`, `csv-column-units`, `all-rows-found`, `rows-have-planned-levels`, `row-labels-map`, `unique-wells`, `raw-ids-on-sheets`, `sop-sections`, `abs-conversion`, `all-values-numeric`, `inhibitor-has-reference`.

**Invariants.** `wells-conserved`, `enough-points`, `fit-interior`, `replicate-rows-agree`.

**check-traces.** 5/5 clean: 0 deopt, 0 crash, 0 timeout, no regression cases. About $0.27 per full run.
- trace-0, trace-2, trace-3, trace-4: exclusions are identical to the agent answers. vmax and km differ only by float noise (<0.01% relative), well inside the 10% grading tolerance.

**Disagreement.**
- **trace-1, `excluded_samples` (and C7).** The agent excluded the whole row HV-0365…HV-0373; the solver excludes only HV-0373.
  - The source is the bench-log sentence "Block read 26.8 °C during this read (my practice run of this row had no such problem)." It follows HV-0373's entry, the way a per-well note does.
  - SOP 2.4 excludes a well when "the block temperature logged for the well differs from the condition setpoint by more than 1.0 °C".
  - The same template is a per-well note in trace-3 (mid-row, after DR-0577; the agent excluded only that well) and in trace-4 (a table note).
  - C7 then differs from the agent's value by 2.4% (vmax) and 6.8% (km).
