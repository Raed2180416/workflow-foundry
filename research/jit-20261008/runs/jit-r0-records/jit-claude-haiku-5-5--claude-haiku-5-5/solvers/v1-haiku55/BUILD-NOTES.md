# BUILD-NOTES

## Procedure in code
- Rates, calling codes, trunk prefixes and nicknames parsed from the spec.
- Six line formats parsed; dates by config order; exact BigInt money, rounded once.
- E.164 phones; names cleaned, nicknames replaced, one-typo matching; union-find identity; §4 ordering and §7 USD.

## Judges (haiku-5-5, escalating to opus-5-5 on a failed check)
- `source-config`: one call reads the notes into 14 settings. Check: each non-default value quoted from the notes.
- `vendex-fields`: free-text entries, batches of 8. Check: fields verbatim in the entry, country in the ISO table.
- `near-miss-same-person`: similar names sharing an attribute, with no differing birth dates. Check: shared attribute quoted. Flagged.

## Guards and invariants
- Guards on line formats and on the enumerated values (env, stage, status, flag), plus unknown dates, amounts, currencies and countries.
- Invariants: rows conserved, each row used once, entity_id is the minimum row, cents exact.

## check-traces
- No crash, deopt or timeout. Partials: trace-0 72%, trace-1 96%, trace-2 92%; mean 87%; 0/3 exact.
- Below the 0.9 bar. The differences follow the task text, so I did not force agreement.

## Disagreements with agent answers
- **trace-0**, birth dates and merges: the agent read numeric dates month-first. "For example, dob=11/02/1996 is 2 November 1996."
- **trace-1**, LEDGR `amount_usd` signs: "Saldo changes sign in the master."
- **trace-2**, Anke/Anja and Elena/Elisa not merged (names two letters apart): "Supplier contact Prof. Anja Hoffmann (born 11/3/1960)" and "ATLAS #3918 :: Mrs Elena Galli :: born 06/11/2000".

## Risks
- The config judge samples once; a confident wrong convention passes the quote check unflagged.
