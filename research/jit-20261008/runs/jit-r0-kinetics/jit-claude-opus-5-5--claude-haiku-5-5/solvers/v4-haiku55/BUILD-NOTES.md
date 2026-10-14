# BUILD-NOTES (solve.mjs, kinetics compile v4)

## Status: not accepted
Traces 5, 6, 7 were not re-run after these changes: the gateway cap ($1.5) is spent, so the full check cannot finish. Their earlier live runs were exact. Their `.check/` folders now hold budget deopts; ignore them.

## Changes in this pass
1. **CSV re-read (new shape).** `csvRereadOf` reads a clean re-read from a CSV QC note "re-read …: <number>, no flag". It is applied after the judges, so the well-events prompt is unchanged. Case: trace-0 and case-0 (same inputs). Quote: "SAT; first read flagged OVR; re-read at lower gain: 2.819e2, no flag". C5 km now matches the expected 252.74. trace-4's "re-read: 2.13E-03" has no "no flag", so it is unaffected.
2. **Declared [S] unit not overridable (tightened).** The doc-units check used to accept a judge's [S] unit that contradicted the inline or header unit whenever `corrected` was true. It now rejects any contradiction and escalates. All corrections in the traces change rates only. Case: trace-2. Haiku said nM for a row "B01 QD-0696 1.2 uM 53.12"; Opus escalation returns µM and the run is exact.

## Judges (haiku → opus; well-events opus → sonnet)
doc-units (unit of [S] and rate), dilutions (per-condition enzyme dilution), label-condition (unmapped labels only), well-events (exclusions, relabels, swaps). Each quote must occur in sources.

## Guards and invariants
Unchanged: format guards per document, unique wells, planned-levels, levels-per-condition, values finite, doc-scale-consistent, fit-sane, inhibitor-reference.

## check-traces (replay where prompts are unchanged)
- case-0 exact; trace-0 exact (same inputs); trace-1, 3, 4 exact.
- trace-2 exact (live Opus unit escalation and well-events).
- trace-5, 6, 7 not re-run.
- No disagreements with agent answers among completed cases.

## Process note
Replay harness: /tmp/replay (outside tools/). Validation overspent the budget (a live Opus call of about $0.2 after the trace-2 change).
