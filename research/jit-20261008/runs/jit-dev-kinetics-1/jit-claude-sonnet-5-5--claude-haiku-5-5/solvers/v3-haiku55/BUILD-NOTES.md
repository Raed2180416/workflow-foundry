# Build notes: enzyme-kinetics solver

**Status: not done.** The build budget ran out ($1.406 of $1.5 spent). Traces 5 and 6 deopted on `budget`, not on a guard.

## Procedure in code
Six sheet formats parsed; units resolved (references and CSV headers); label to condition; reference resolution; exclusions (SAT/OVR, bubble during read, pipetting, block temperature); dilution rescale; Michaelis-Menten fit, shared Vmax for inhibitor conditions.

## Judge
- `note-events`: batches of 8 notes, checked by `checkBatch` (ids echo, refs resolve, units parse).
- Sheet notes: haiku, then opus, then sonnet.
- Chat and master-mix notes: sonnet, then opus. Haiku missed a chat confirmation (trace-5 N22) and a 1:1000 dilution (trace-1 N10).

## Guards and invariants
Guards: `values-numeric`, `ids-unique`, `wells-parsed`, `labels-mapped`, `raw-ids-known`, `one-sop`, `reread-unit`, `bench-data-parsed`, `inhibitor-base-exists`. Invariants: `wells-conserved`, `enough-points`, `params-finite`, `excluded-are-study`.

## Fixes this round
1. Bench-log units by reference were not followed (traces 0, 1 deopt on `values-numeric`).
2. CSV headers name units (`S_nM`, `rate_uM_per_s`).
3. Block-temperature sentence with a trailing parenthetical was missed (trace-1).
4. Re-reads written as `1.769×10^2` lost the exponent (trace-1).
5. Chat and master-mix notes use the stronger tiers.

## check-traces (last full run)
- No `regressions/` directory, so none to pass.
- Crashes 0, timeouts 0, deopts 2 (traces 5, 6: gateway budget).
- Traces 0, 1, 3 match agent answers (max error 0.003%); trace 4 within 0.36%.
- Trace 2: agent excluded PX-0301, we do not. Decided by D8 chat: "The bubble note on PX-0302 ... belongs to the well one column to the left of it." Haiku misread sheet note N52 as a redirect.
- Traces 5 and 6 unverified with final code.
- Free dry runs (no-events stub): all 7 complete.

## To finish
Restore budget, rerun `node tools/check-traces.mjs`, check traces 5 and 6, and fix N52 with a stronger tier.
