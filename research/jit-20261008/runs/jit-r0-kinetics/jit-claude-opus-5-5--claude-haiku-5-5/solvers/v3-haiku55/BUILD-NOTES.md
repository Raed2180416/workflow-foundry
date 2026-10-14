# BUILD-NOTES

## Procedure (code)
Each notebook format is parsed in code into wells; raw instrument rates override notebook rates; labels map through the register; SOP temperature, SAT/OVR and dilution rules are applied in code; the fit is Michaelis-Menten (grid + golden section), with inhibitor Vmax fixed to the matching inhibitor-free condition.

## Judges (unchanged)
- label-condition: haiku, opus (unmapped labels only).
- doc-units: haiku, opus (quote checked in sources).
- dilutions: haiku, opus (quote checked).
- well-events: opus, sonnet (medium); ids and quotes checked.

## Changed checks (refused traces)
- `summary-header` / `summary-row` (trace-1, trace-3): headers may list several replicates; rows may be "|"-joined. Each part's replicate must be in its header, else deopt. Other headers still deopt. Single-replicate rows parse identically (checked offline on traces 4–6). Quotes: "Condition: 25C/pH9.0 (no inh.)   (replicates r1 = plate 2 row B, r2 = plate 5 row C)"; "[S] = 1.5: r3 12.2 (QD-0539) | r4 7.58 (QD-0625)".
- `bench-unparsed-id` (trace-0, trace-2): five bare-number forms ("ID: R at S", "ID at S gave R", "ID (S): R", "S → R (ID)", "Well X / ID, [S] S, v0 R"); units come from the document's judged units. Any unit text or second id still deopts. Quotes: "OB-0285: 8.58e-4 at 15."; "DR-0487 at 4 gave 2.35×10^3."
- Re-read rule (trace-2): "First read SAT, gain reduced and re-read → 2956 (clean)." sets the preceding well's rate to the re-read; flagged `bench-reread`. Only this shape matches.

## check-traces
- Traces 0–3: exact against the agent answers, no deopt.
- Traces 4–6: exact before these edits. Not re-run: the $1.5 build budget had $0.21 left. Their paths are unchanged (checked offline).
- A full run is still needed before acceptance.

## Disagreements
None on traces 0–3.
