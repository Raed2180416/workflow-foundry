# BUILD-NOTES

## Procedure in code
Parse six line formats, spec tables (rates, calling codes, nicknames) and note paragraphs; normalise names, dates, countries, phones (E.164), money (exact BigInt, half away from zero). Identity: name distance ≤1 (nicknames, accent renderings) plus same DOB, or same phone when a DOB is missing; union-find. Conflicts by update-date order, re-stamped systems last; accent restoration.

**Recompile change:** an all-caps winning name part takes the letter case of another row of the person spelling it identically in mixed case. regressions/case-0 and trace-0 failed because "VAN LEEUWEN, Sanne (Ms.)" was title-cased to "Van Leeuwen"; row "Prof. Sanne van Leeuwen" now supplies "van Leeuwen". Otherwise title case, flagged `all-caps-particle-name` when the name starts with a particle. No check loosened.

## Judges (haiku → haiku → opus; 3-way haiku vote, opus on split)
void-markers, balance-signs, restamped-systems, date-orders (quotes must be in that system's paragraph; date order checked against data); vendex-fields (quotes are substrings, dates/amounts parse); country-names (index/text echoed).

## Guards / invariants
Guards: input shape, row count vs prompt, known line formats, unique ids, tables found, update dates parse, rate per currency. Invariants: rows conserved, no void row used, entity_id = min row, field shapes, E.164 shape.

## check-traces
4/6 exact, mean partial 98%, 0 deopt/crash/timeout, regressions 1/1.

## Disagreements (solver kept)
- trace-3, amount_usd of LEDGR-winning records (1206, 1498, ...): "Saldo changes sign in the master." The agent did not flip it.
- trace-4, source_rows/given_name/amount_usd/phone of 3108 and 3918: "HOFFMANN, Anke (Dr.)" vs "Supplier contact Prof. Anja Hoffmann (born 11/3/1960)", and "Mrs Elena Galli" vs Elisa, are two letters apart; spec 3.1 tolerates one typing error, so they stay separate. The agent merged them.
