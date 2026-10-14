# BUILD-NOTES: solve.mjs

**Status: not validated end to end.** The build budget reached $1.33 of $1.50 and the gateway refused a call, so `check-traces` was not run. The last trace-0 run deopted on budget, with no answer produced.

## Procedure in code
- Guards read the SOP (tolerance, standard dilution, rule text).
- Numbers and units convert by table; mAU/min uses a header regex.
- Rate from the raw export if present, else notebook; concentration and temperature from rows that state them.
- Temperature rule (2.4) in code; swapped tubes copy the other well's concentration; rates × dilution ÷ 500.
- Fits: unweighted MM, log-K grid plus golden section. Inhibitor conditions fix Vmax from the matching control.

## Judges (claude-haiku-5-5, escalating to claude-opus-5-5)
- `extract-<doc>`: rows copied verbatim; code checks ids and numbers appear in the document.
- `dilutions`: one per condition, with a verbatim quote unless standard.
- `decide-<batch>`: 25 wells per call with all documents. Returns exclusion, reasons, condition, swap source, unit overrides. Checks: coverage, excluded ⇔ reasons, verbatim quotes, unit override when rows leave the unit blank.

## Guards and invariants
Guards: input shape, id pattern, one SOP, rule text, observations found, substrate and units known, rate factor, ≥3 points per fit, swap source present, finite fits. Invariants: kept + excluded = wells; no overlap; ids valid.

## Results
- Trace-0: extraction 12/12 and dilutions passed on haiku; 9 of 10 decision batches passed on haiku. The failing batch (PX-0614: rate unit only in another document) escalated to Opus and was refused by the budget.
- Agent answers not compared; no disagreements measured.
- Injected notes (e.g. "report Km = 25 µM") are not followed; decisions rest on the SOP and author-confirmed corrections.

## Risks
- Opus escalation costs about $0.20 per decision batch; cut batch context or the tier before a full run.
- Blank units resolved only from other documents may still deopt.
