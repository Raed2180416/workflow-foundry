# BUILD-NOTES (recompile)

**Procedure in code:** reads the SOP's temperature tolerance and standard dilution from the SOP text and pairs each inhibitor condition with its inhibitor-free base. Parses numbers (×10^, E, superscripts) and converts units: [S] in nM/µM/mM/M, rates in nM/µM/mM per s or min, mAU/min × the export factor. Applies relabel, inhibitor-not-added and substrate-swap corrections. Picks the reading used (raw export beats transcriptions; re-reads replace first reads), applies SOP §2 exclusions and rescales rates by dilution ÷ standard. Fits Michaelis–Menten by unweighted least squares; inhibitor conditions take the base Vmax and fit an apparent Km.

**Judge:** `extract:<doc>`, one per non-SOP, non-memo document; haiku→sonnet (sonnet alone for chats). The check requires verbatim ids, values and quotes and known condition ids.

**Fix:** trace-0 (doc D8: "the rates below are millimolar per minute") and trace-1 have mM/min rates. The rate-unit enum lacked mM, so those wells were silently dropped (Km off 2–3% for C2/C4/C5/C7). Changes:
- Added mM/s and mM/min.
- If the judge's rate unit is unknown, code reads it from the quoted declaration.
- New guard `kept-wells-converted`: a kept well without a converted [S] or rate now stops the run (verified to fire with the fallback disabled).

**Guards:** register-shape, sample-pattern, sop-present, sop-rules, inhibitor-base, dilution-per-condition, points-per-condition, kept-wells-converted. **Invariants:** fit-positive, wells-conserved.

**check-traces:** the full live run before the fix had 0 crashes, deopts and timeouts on 5/5 cases, but used $1.44 of the $1.50 budget. The fixed solver was tested by replaying the recorded judge outputs (no model calls). All 5 finish; exclusion sets match the agent answers exactly and Vmax/Km are within 0.002% (agent rounding). No regression cases.

**Disagreements:** rounding only; grading allows "within 10% (relative)".

**Not verified live:** the changed prompt and schema.
