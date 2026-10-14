# BUILD-NOTES (recompile)

**Procedure in code:** read the tolerance, standard dilution and rules from the SOP text. Then, in code: parse numbers and units, convert S to µM and v to µM/s (mAU/min uses the document's factor), apply relabels and inhibitor-not-added, choose the reading used for each well (re-read over first reading, raw-export rate over transcription), apply substrate swaps and the latest dilution per condition, run SOP §2 exclusions, then fit. Inhibitor-free conditions get a free Michaelis–Menten fit (profile least squares); each inhibitor condition fixes Vmax to its base condition and fits Km only.

**Judge:** `extract:<doc>`, one call per non-SOP, non-memo document. Tiers: haiku → sonnet, except chats, which use sonnet only. The check requires every record id and S/v/T value to be literal in the study, and every event quote and id to be in the study.

**Changes in this recompile:**
- trace-1 (D12) and trace-3 (D2) deopted because the model put a context document's number into a record (raw-export rates ×60; a block temperature from D12). Such values now pass the check if they appear anywhere in the study, then code sets them to null when they are not in the target document. The other source's own record supplies the value.
- New event kind `retract`, for when an author says their remark named the wrong well. For the cleared wells, code drops flag, bubble, pipetting and temperature note events; reader flags on records stay.

**Guards/invariants (unchanged):** register shape, sample pattern, SOP present, SOP rules parsed, one base per inhibitor condition, a dilution per condition, ≥2 points per condition, positive fits, kept + excluded = wells.

**Check-traces:** the baseline run used up the $1.50 build budget, and traces 4–6 stopped with budget deopts there. All later testing was offline replay of recorded judge outputs (hand-built for trace-1 D12 and trace-3 D2):
- trace-1: matches.
- trace-2: matches within 2.4%.
- trace-0: within 6%, and its exclusions match once D11 carries the retract event.

The final live run could not complete for lack of budget: 7 budget deopts, 0 crashes, 0 timeouts.

**Disagreement:** trace-0, `excluded_samples`, OB-0938. The old solver excluded it; the agent kept it. The agent is right: SOP §4 says "A correction that its author later withdraws is not applied", and Bram de Vries wrote "it describes OB-0937. Nothing was wrong with OB-0938."
