# BUILD-NOTES

**Status: not finished.** The build budget ($1.5) ran out during iteration (`budget.mjs`: $1.504). The final full `check-traces` therefore refused every model call: 0/3 exact, 3 deopts (`budget`), 0 crash, 0 timeout. That run says nothing about accuracy.

**Last complete run** (an earlier version, trace-0; exit 0). Current code differs from it (see below) and is not re-tested.
- C2, C4, C5, C6, C7: vmax and km within about 1% of the agent's answer.
- C1, C3: km far off (460 vs 179; 327 vs 117). Cause: the D10 CSV rates were read as mAU/min. Current code guards and resolves that unit reference, but this is untested.
- Excluded set: 6 of the agent's 9 matched. Extra PX-0490: the flagged reading was kept, but its re-read is clean (SOP §3). Missed PX-0672 and PX-0856, which are named by position. PX-0817 is excluded by the agent, but its bubble was removed before the read (SOP §2.2), so the SOP reading excludes nothing for it.

**Procedure in code.** Study register and id prefix; number and unit parsing (unit read from the quote after [S] when present); rate conversion (mAU/min by the document's stated factor ÷ 60; nmol/L/s, nM/min, µmol/L/s); merge of rows per well (live reading over superseded, instrument export first, then notebook, then others); substrate swaps; dilution rescale by denominator ÷ standard; exclusion rules (SAT/OVR, bubble during read, pipetting error, |T − setpoint| > 1.0 °C); Michaelis–Menten fit (Vmax closed form, Km by grid and golden section); inhibitor conditions take Vmax from the no-inhibitor condition with the same pH and temperature.

**Judge.** `extract:<doc>`, one per document, tiers haiku-5-5 then opus-5-5, concurrency 4, maxTokens 16000. The prompt has the SOP, the register, a digest of unit lines, and any unit reference resolved in code. Checks: every quote verbatim in the corpus; each well's id, rate and [S] appear in its quote; fact and correction ids appear in the corpus; mAU factor text verbatim. Opus was escalated often, at about $0.10–0.15 per call.

**Guards.** Register shape; units µM/s and µM; id prefix; standard dilution stated once; one mAU factor; mAU rows only from documents that state the factor; no unknown rate units; numbers parse; one dilution per condition; a baseline exists for each inhibitor condition.

**Invariants.** Every well maps to a condition; at least 2 distinct [S] per fitted condition; wells conserved.

**Known gaps.** Position-only references need the judge to see the table. Judge output varies between runs on the same document (for example D7 quote checks, D10 units).
