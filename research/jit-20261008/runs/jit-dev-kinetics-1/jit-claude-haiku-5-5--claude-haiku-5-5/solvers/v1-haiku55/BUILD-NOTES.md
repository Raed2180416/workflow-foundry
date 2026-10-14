# BUILD-NOTES: solve.mjs

**Status: not clean.** Full `check-traces` deopted trace-0 on budget (`extract:D11`): the concurrent run used the $1.5 build cap. Offline replays match all three agent answers.

## Procedure in code
- SOP parameters parsed from the SOP text: 1.0 °C tolerance, 1:500 standard dilution, shared-Vmax rule.
- Judge output becomes records (readings) and events (flags, bubbles, pipetting, relabels, swaps, dilutions).
- Units converted in code; mAU/min via the document's factor.
- Used reading: re-read, else first. Raw export overrides the rate.
- Corrections: relabels set the condition; each swap pair once; latest-dated dilution wins.
- Excluded: SAT/OVR, bubbles `during_read`, pipetting errors, block temperature off by more than tolerance.
- Rates rescaled by dilution/500. Unweighted NLS. Inhibitor conditions fix Vmax to the matching base.

## Judges
- One call per document, except SOP and memos. Tiers: haiku-5-5, then sonnet-5-5. Chat threads start at sonnet.
- Every call sees the other documents as context.
- Checks: values literal in the target; quotes and ids in the study; condition ids in the register.

## Guards and invariants
- Guards: register shape, id pattern, SOP parsed, one base per inhibitor, one dilution per condition, at least 2 points per condition.
- Invariants: fits positive and finite; wells conserved.

## check-traces
- trace-1, trace-2: every condition and excluded id within 1e-5 of the agent answer. check-traces still reports diffs because it compares exact strings.
- trace-0: deopted on budget. Offline replay matches all seven conditions and nine excluded ids.

## Disagreements
- None numerically. An earlier run excluded HV-0692 (trace-2); a chat correction moves that bubble to the neighbouring well. The current run agrees.

## Caveats
- Wells named only by position ("plate 8 A07") rely on judge resolution.
- Instructions inside documents are treated as data and marked `applies: false`.
