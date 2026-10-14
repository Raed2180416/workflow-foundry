# BUILD-NOTES

**Procedure in code:** line parsing for the 6 systems, spec tables (countries/calling codes/trunk, rates, nicknames), dates (numeric DMY/MDY, month names, Shōwa/Heisei), money (German/English formats, ▲/CR/parentheses), sign flips, exact BigInt USD conversion with half-away rounding, E.164, name splitting (a "Given FAMILY" family name is now the whole trailing capitalised run, e.g. "DE VRIES" becomes "de Vries"), name matching (OSA ≤ 1, nickname, ASCII renderings incl. uppercase Ō/Ū), union-find identity, recency ordering, accent restoration.

**Judges:** `rules` (opus only): date orders, **new `date_order_switches`** (cutoff day from which a system's numeric birth dates swap order; checked: quote in notes, from_date is a day named in the quote), sign flips, void markers (quoted), unreliable update systems. `countries` (haiku→opus) for unknown country text. `vendex-i` (haiku→opus, batches of 4): verbatim quotes, re-checked in code; **new check:** a null dob_text is rejected when the entry has "born/birth/DOB/b." followed by a date.

**Guards:** inputs present, spec tables parsed, known line formats, rates known, balances/names parsed, **new** `date-switch-supported` (no VENDEX switch, at most one per system). **Invariants:** unique row ids, rows conserved, every row in one record, one birth date per person, unique entity ids.

**check-traces:** 7 cases, 0 deopt, 0 crash, 0 timeout. trace-1 exact. trace-2/3/5 differ only in record order. Remaining disagreements, where our output follows the task text:
- trace-0 records[35] (Jules vs Julie Ménard, row 7149): spec 3.1 allows "at most one typing error in total"; Julie→Jules is 2 edits, so they are separate people.
- trace-4 records[8].amount_usd: spec 4: "Balance: from the most recent row with a usable balance". Row 1457 (upd 2025/08/13, ▲79,319円 → -504.00) beats row 9683 (2023/10/11).
- trace-6 records[2] and [28].birth_date: notes: "An ATLAS row 'born 10/02/1952' belongs to someone born in October", which means month first, so 09/11/1969 is 1969-09-11 and 02/10/1956 is 1956-02-10.
