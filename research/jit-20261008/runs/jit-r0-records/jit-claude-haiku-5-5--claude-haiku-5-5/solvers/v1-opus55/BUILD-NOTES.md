# BUILD-NOTES

**Code:** parses the six line formats; reads rates, calling codes/trunk rules and nicknames from the spec. Handles dates (ISO, era, words, numeric by order), German/parenthesised/CR/▲ amounts, words→numbers, country aliases (+fuzzy ≤1–2 edits, flagged), E.164, and exact BigInt conversion rounded half away from zero. Identity is rule 3 (accent renderings, nicknames, ≤1 OSA edit; dob or phone link) via union-find; winners follow rule 4 (re-stamped systems last, accent restoration).

**Judges** (haiku → haiku retry → opus; quotes must lie in that system's notes paragraph):
- `void-markers`: VOID/KEEP for each distinct stage/Status/flag/env/tag seen.
- `balance-signs`, `restamped-systems`: per system.
- `date-orders`: DMY/MDY for BRIGHTDESK/ATLAS/VENDEX, rejected if same-person rows contradict it.
- These four run as three independent haiku calls voted on decisions only; a split goes to opus and is flagged.
- `vendex-fields` (batches of 6): quotes for name/dob/phone/amount/revision date plus ISO country with cue. Code parses each quote and checks ids, substrings, cue-vs-country.
- `country-names`: only for strings not in the alias table.

**Guards:** input shape, row count, known line formats, unique ids, notes paragraphs, spec tables parsed, update dates parsed, rate per currency. **Invariants:** rows conserved, entity_id = min row, field shapes, E.164 shape. Flags: near-miss names (left apart per 3.1), fuzzy countries, date ties.

**check-traces:** 0 crash/deopt/timeout; trace-0 exact, mean partial 96%, ~$0.01/task.

**Disagreements:**
- trace-1, amount_usd of LEDGR-won records (1206, 1498, 1641, …): notes say "Saldo changes sign in the master." The agent kept the LEDGR sign; I flip it.
- trace-2, records 3108 and 3918 (source_rows, given_name, amount_usd, phone_e164): "Supplier contact Prof. Anja Hoffmann (born 11/3/1960)" vs "LEDGR;3986;Hoffmann, Anke;Frau Prof.;3.11.1960", and "name=Elisa GALLI | dob=11/06/2000" vs "Mrs Elena Galli :: born 06/11/2000". Each given-name pair is two letters apart, beyond spec 3.1's single tolerated typing error. I keep them apart; the agent merged them.
