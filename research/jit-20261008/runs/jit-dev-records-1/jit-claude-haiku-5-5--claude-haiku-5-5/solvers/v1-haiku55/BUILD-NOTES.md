# BUILD-NOTES

**Procedure in code.** Each line format is parsed by position or key (BRIGHTDESK, LEDGR, ATLAS, KOBO, VERITAS JSON). Spec tables (calling codes, trunk prefixes, rates, nicknames) are read at run time. Dates follow each system's convention. Phones become E.164. Amounts are exact BigInt rationals, rounded once. Identity is union-find over rule 3. Rows are ordered by update date, VERITAS last. Output is sorted by entity_id.

**Judges**
- `source-rules` (haiku, sonnet, opus): reads the notes into per-task rule values and void markers. Every quote must occur verbatim in the notes.
- `vendex-entries` (same tiers): verbatim substrings for name, dates, phone, amount and country text. Checked for substring presence and spec-table codes.
- `country-names`: only for country strings that aliases and fuzzy matching cannot resolve.

**Guards.** Input shape, known line formats, LEDGR field count, spec tables, unique row ids, unparseable dates/phones/amounts, currency without a rate.

**Invariants.** Each live row in exactly one person; one birth date per person; entity_id is the smallest source row; amounts have two decimals; phones are E.164.

**check-traces (full run).** No crash, deopt or timeout; no regression cases.
- trace-2: exact.
- trace-0: all 43 records match the agent answer field by field. The checker reports `diff` only because record order differs; the spec defines no order, so the solver sorts by entity_id.
- trace-1: 16 records differ on amount_usd, all by sign. The notes say "Saldo changes sign in the master" (LEDGR flip), which the agent did not apply; the solver follows the text. Affected entity_ids: 1252, 1285, 1360, 1906, 2292, 2440, 2721, 3467, 4417, 4799, 5499, 7109, 7239, 7257, 7649, 8083.

**Untested.** The "unstated" fallbacks are not exercised by any trace.
