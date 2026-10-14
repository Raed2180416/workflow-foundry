# BUILD-NOTES: master-list migration solver

**Procedure in code:** line parsing per system; birth dates in each system's order (ATLAS swaps day and month from the notes' date); money parsing and exact BigInt FX conversion; E.164 from the spec table; identity by union-find (one OSA edit after folding, then DOB or phone); conflict order (unreliable systems last, then recency); output sorted by entity_id.

**Judges:**
- `rules` (opus): date order, sign flips, void markers, unreliable systems, ATLAS swap date. Code checks quotes against the notes.
- `countries` (haiku, then opus): name to ISO.
- `vendex-N` (haiku, then opus; batches of 4): verbatim fields, checked by code.

**Guards:** inputs-present, known-line-formats, spec-tables-parsed, balances-parsed, names-parsed, rates-known. **Invariants:** row-ids-unique, rows-conserved, rows-in-one-record, one-dob-per-person, entity-ids-unique.

**Changes this round:** ATLAS swap for rows changed on or after a notes date (fixed trace-0 and trace-1 deopts); family particles ("DE VRIES" to "de Vries"); uppercase Ō and Ū folding.

**check-traces (full run):** 0 crash, 0 deopt, 0 timeout; no regression cases exist. trace-1 exact; the rest as below.

**Disagreements with agent answers**
- **trace-0, 4193 / 7149 (source_rows, given_name, country, amount_usd):** spec §3.1 "at most one typing error in total". "Julie" and "Jules" differ by two letters, so 7149 stays separate. The agent merged it.
- **trace-4, 1457 (amount_usd):** spec §4 "Balance: from the most recent row with a usable balance". KOBO/1457 (2025/08/13) is newer than KOBO/9683; its balance is negative, so −504.00. The agent used 9683.
- **trace-6, 6483 and 6748 (birth_date):** the notes say "An ATLAS row 'born 10/02/1952' belongs to someone born in October", so ATLAS is month-first. The agent read day-first.
- **trace-2, 3, 5:** same content once sorted by entity_id; only record order differs (trace-2 also source_rows). The spec fixes no order.
