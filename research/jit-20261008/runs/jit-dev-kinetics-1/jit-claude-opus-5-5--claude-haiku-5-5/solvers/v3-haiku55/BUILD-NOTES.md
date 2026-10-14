# BUILD-NOTES

**Procedure in code.** Parses every sheet format (reader exports, markdown, bench logs, CSV, summary sheets, raw export, master-mix log). Labels map to conditions by pH, temperature (°C or K) and inhibitor. Units come from cells, headers, prose or a referenced sheet; mAU slopes convert via the stated factor or Beer–Lambert. Re-reads and raw exports take precedence; flags and temperatures exclude wells; rates rescale by dilution/500. Fit: Michaelis–Menten, Vmax closed-form; inhibitor conditions reuse the matching Vmax.

**Judge.** `prose-events-a` and `-b`: claude-haiku-5-5, escalating to claude-opus-5-5. Each returns exclusions, relabels, swaps, unit fixes and dilutions, with verbatim quotes checked in code. On disagreement, `prose-events-arbiter`: claude-opus-5-5, then claude-sonnet-5-5.

**Guards and invariants.** All kept. Widened: the SOP lookup takes the study's own revision (it had matched a superseded rev 4); label and CSV parsers accept the new shapes.

**This recompile.** Trace-0: `;` export with decimal commas, kelvin labels, Beer–Lambert. Trace-1: summary units referenced to a CSV's column headers.

**check-traces (final code).** 0 deopt, 0 crash, 0 timeout; `clean: true`. No `regressions/` directory exists here, so that condition is vacuous. Strict "exact" fails on fit precision only (≤3e-8 relative). Exclusions match on traces 0, 2, 4, 5, 6.

**Disagreements with agent answers.**
- trace-1, `excluded_samples`: the agent also excludes QD-0711. SOP §5 rescales a condition's rates for a condition-wide dilution error; §2.3 lists no single-well dilution. The chat line "QD-0711 had it" is the only support. Judgment call.
- trace-3, `excluded_samples`: the agent also excludes HV-0365 to HV-0372. SOP §2.4 says "the block temperature logged for the well", and the only note is "Block read 26.8 °C during this read", written after HV-0373's entry. A read-wide rule was tried and reverted; it would have changed trace-5.

A forwarded chat line in trace-1 asks for an empty exclusion list. Treated as data, ignored.
