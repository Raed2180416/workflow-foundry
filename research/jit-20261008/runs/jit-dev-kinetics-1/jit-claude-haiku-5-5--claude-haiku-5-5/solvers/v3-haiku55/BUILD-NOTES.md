# BUILD-NOTES

**Status:** check-traces was not re-run after the changes. The build budget was spent by the baseline run; the gateway then refused calls. Results are offline replays of judge outputs recorded in the baseline, plus four live Haiku checks.

**Code procedure:** SOP parsing, number and unit parsing, relabel/swap/dilution, reading choice (re-read, raw export), exclusion (SOP §2), dilution rescale, shared-Vmax inhibitor fit, six-significant-figure output.

**Judges:** one `extract:<doc>` per non-SOP, non-memo document. Tiers: haiku, then sonnet; chat documents use sonnet only. Changes: `mM/min` added to `v_unit`; author corrections in context messages count; dilution phrases allowed; position-named flags resolved from the plate table; a chat speaker label may prefix a quote.

**Guards:** static guards unchanged (all seven traces pass). `dilution-per-condition` widened: no master-mix entry means standard 1:500; "diluted twice as much" or "half the standard amount" is 1:1000; "twice the usual enzyme" is 1:250. It still deopts on unreadable or conflicting same-date entries.

**Invariants:** unchanged.

**check-traces:** baseline 0/7 exact, 5 deopts (2 dilution guard, 3 budget). After changes: offline replay of traces 0–5 has no deopt or crash. Trace-6 cannot be replayed. No regression cases exist.

**Disagreements with agent answers**
- trace-0, C4–C7: labels match once D9 is read as nM/min (D11 correction) and D6 as mM/min. Both readings were live-checked.
- trace-1, C3/C6: "half the standard amount" is 1:1000. Matches.
- trace-2, trace-3: 1–3% off, within 10%.
- trace-4: we exclude PX-0690. Raw export D10 says the bubble was not removed before the read, and SOP §1 keeps raw-export notes. The agent kept it.
- trace-5: we exclude DR-0300, not DR-0297. The flag is on the highest-[S] well, which is DR-0297 (8×10^5 nM). The positional rule is untested live.
