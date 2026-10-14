# BUILD-NOTES

**Procedure in code.** Judge output is parsed by code: numbers and units (rates to µM/s from uM/min, nM/s, nM/min, mM/min, mAU/min via the document's factor; substrate to µM; temperature to °C). Relabels and inhibitor corrections move wells; swaps apply once per pair; raw export overrides transcription; a re-read replaces the first reading. Dilution per condition rescales points by dilution/500. Exclusion: SAT/OVR, bubble during read, pipetting, block temperature. Fit: unweighted NLS; inhibitor conditions share their partner's Vmax.

**Judges.** One per non-SOP, non-memo document. Tiers: haiku, then sonnet (chat starts at sonnet, unchanged). Checks: ids and numbers verbatim; quotes verbatim (elisions checked per fragment); condition ids in the register.

**Guards and invariants.** Unchanged.

**This round.** Dilution read from "twice as much as the SOP says"; elided quotes accepted; `mM/min` added (trace-0's CSV rows were silently dropped, so C4, C5, C7 were 1–2% off).

**check-traces.** No `regressions/` directory exists: 0/0. trace-0's post-fix run replays to the agent answer (max diff 0.0005%, same exclusions); its live run deopted on the gateway budget. trace-1, -2, -4 deopted on the budget at extract:D11, D10, D6 (my runs reached the $1.5 cap), so they never ran live. Replays from recorded judge outputs (unrecorded documents stubbed empty): trace-1 within 2.2%, trace-4 within 3.1%, trace-2 not meaningful. trace-3 ran live: rounding and DR-0381.

**Disagreements.**
- trace-3, excluded_samples: keep DR-0381. D1 (Owen Achterberg): "the bubble was in DR-0382, not in DR-0381. DR-0381 was fine." The judge applied the D12 bubble note. Not fixed.
- trace-2, C7 (~60× too high): D8 (Leila Haddad): "ignore the nmol/L/s in the rate column header" (D3, meaning nM/min). The judge used the header. Not fixed.
- Agents round to ~6 significant figures; we do not (within tolerance).
- The forwarded bot message in trace-2 D8 asking for fixed Km and Vmax is data, not applied.
