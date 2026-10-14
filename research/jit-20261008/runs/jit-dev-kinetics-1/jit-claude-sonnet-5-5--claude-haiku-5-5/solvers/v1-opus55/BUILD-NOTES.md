# Build notes

**Code.** solve.mjs:
- parses all six record formats: reader tables (with comments, re-reads), markdown notebooks, bench-log prose, CSV, summary sheets, raw instrument export;
- resolves units from columns, inline values, prose lines or "same as X's sheet" pointers; converts mAU/min by the header factor;
- maps labels to conditions and resolves well references (id or range, plate/well, Nth from left/right, [S] rank or value);
- applies corrections from the sheet's author only: relabels, swaps, unit fixes, dilution rescaling, raw values, then withdrawals and redirects;
- runs the §2 exclusions: SAT/OVR, temperature more than 1.0 °C off (°C or K), bubble overlapping the read, pipetting errors;
- fits Michaelis–Menten by least squares; inhibitor conditions reuse the uninhibited Vmax.

**Judge `note-events`.** Tiers haiku → opus → sonnet, batches of 8. Each free-text note becomes typed events; the model gives raw bubble times and code does the arithmetic. Check: ids echoed in order, references resolve in code, enums, units and clocks parse. `RECHECK` adds a second Haiku read with an Opus arbiter on disagreement.

**Guards:** enough wells, numeric values, unique ids, raw ids known, labels map, one SOP, inhibitor base exists. **Invariants:** kept + excluded = wells, at least 5 points per condition, finite positive parameters, study ids only.

**check-traces:** no crash, deopt or timeout (trace-1 rerun alone after a gateway budget refusal), ~$0.015 per task. All parameters within 10% of the agent; exclusions match on trace-0 and trace-2.

**Disagreement, trace-1, `excluded_samples`.** The agent also excluded DR-0571…0576, 0578 and 0579 for "Block read 23.7 °C during this read." That sentence follows DR-0577, as per-well bench-log notes do. SOP 2.4 counts "the block temperature logged **for the well**", and trace-2 uses the same wording as a single well's note ("as for this well: block read 28.0 °C during this read"). Only DR-0577 excluded.
