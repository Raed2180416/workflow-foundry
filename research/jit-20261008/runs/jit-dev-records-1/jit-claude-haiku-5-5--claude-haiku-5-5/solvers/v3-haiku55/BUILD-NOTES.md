# BUILD-NOTES

## Procedure in code
Per-system parsing, names and nicknames, accents, E.164 phones, dates (incl. Japanese eras), amounts (German format, CR, trailing minus, spelled-out words), identity links (union-find), conflict order, exact USD conversion (BigInt rationals, rounded once).

## Judges
- `source-rules`: haiku, then sonnet, then opus; 3 samples, majority. Reads the per-system rules, the ATLAS/VENDEX cutoff day, and void markers. Each value needs a quote from the notes.
- `vendex-entries`: haiku, sonnet, opus. Extracts substrings that must occur in the entry.
- `country-names`: same tiers. Only names code cannot resolve.

## Guards and invariants
Guards: input shape, spec tables, every line parses, unique ids, values parse, known countries and rates. Invariants: rows conserved, one birth date per person, entity = min row, two-decimal amounts, E.164 phones.

## Changes this compile
1. ATLAS and VENDEX: `MDY_from_cutoff` with a judged day, replacing the hard-coded 2015.
2. Linking: birth-to-birth links first; a link through a row with no birth date is refused if it would join two birth dates.
3. Rules prompt: master sign stated; negations read literally.

## Check result
0 deopts, 0 crashes, 0 timeouts. Exact: trace-2, trace-6. No `regressions/` directory, so no regression cases. Run cost $0.19.

## Disagreements (decided by the task text)
- **trace-0**, records[10] `amount_usd`: "'CR' after an amount marks a negative 'owed' figure", flipped, so positive. The agent's own other CR rows are positive.
- **trace-1**, records[3] and ATLAS dates: "an ATLAS birth date written 11/05/1996 is 5 November 1996" means day-first. Row 1751 (no birth date) links to two birth dates; the first link in row order wins (my choice). With ATLAS forced month-first, my output matches the agent's 39 records.
- **trace-3**, 9 amounts (LEDGR, KOBO): "Saldo changes sign in the master"; "KOBO balances change sign". The agent did not flip.
- **trace-4**: content identical; only record order differs. I sort by entity_id.
- **trace-5**, 17 amounts (LEDGR): "Saldo changes sign in the master". The agent did not flip.
