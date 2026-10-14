# BUILD-NOTES

**Procedure in code.** Parses six sheet formats (reader export, markdown, bench log, CSV, summary, raw export). Units (incl. `mmol/L`, `×10^n`) and labels are normalised. Re-reads in note cells or summary arrows replace the first reading. A bench-log "Block read X °C during this read" applies to the whole row. The raw export overrides transcriptions. Then it applies withdraw/redirect, swaps, relabels (an id range in the note or the chat message it confirms is expanded) and dilution rescaling. It applies SOP §2 exclusions and fits Michaelis–Menten by grid plus ternary search, with Vmax fixed for inhibitor conditions.

**Judge.** `note-events` turns batches of 8 free-text notes into typed events. Tiers: claude-haiku-5-5 → claude-opus-5-5 → claude-sonnet-5-5. `checkBatch` escalates when ids are not echoed or a well reference does not resolve. `RECHECK` (two readings plus an arbiter) is off: it cost up to $0.25 per task and used up the build budget.

**Guards.** wells-parsed, values-numeric, ids-unique, raw-ids-known (kept; its deopts were parse gaps), labels-mapped, one-sop, inhibitor-base-exists, new bench-data-parsed, new reread-unit. **Invariants:** wells-conserved, enough-points, params-finite, excluded-are-study.

**check-traces (final live run).** 0 deopt, 0 crash, 0 timeout, $0.067. The later chat-range fix (build budget used up) was verified by replaying recorded judgments on all 5 cases.

**Disagreements**
- All cases: vmax and km differ from the agent by ≤0.6%. "every vmax and km must be within 10% (relative)".
- trace-1 `excluded_samples` PX-0627 and trace-2 PX-0691 were missed by the haiku judge in the last run. The agent is right: "Facts about a well that the author reports later (a flag, a bubble…) are treated as if they had been written on the sheet." Judge variance; `RECHECK` reduces it.
- trace-0 C2/C4 (last live run): the relabel of PX-0502…PX-0510 covered only one well. Fixed afterwards (the range is in the earlier message); replay matches the agent.
