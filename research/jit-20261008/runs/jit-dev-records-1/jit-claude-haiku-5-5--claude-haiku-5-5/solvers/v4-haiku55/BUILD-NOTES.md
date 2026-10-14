# BUILD-NOTES

## Procedure in code
- Per-system line parsers (BRIGHTDESK pipes, LEDGR semicolons, ATLAS `::`, KOBO `|`, VERITAS JSON). VENDEX free text goes through a judge.
- Dates: per-system order; ATLAS and VENDEX use `X_then_Y` (order before/after the cutoff day, by last change); KOBO era dates; each ISO date round-trips through `Date`.
- Money: exact BigInt rationals; sign from the rule; spelled-out amounts; FX from the spec; one round-half-away at the end.
- Phones: E.164 with trunk prefix dropped; 00 / 011 prefixes.
- Identity: name distance <= 1 with umlaut variants; link on equal birth date, or on phone when birth is missing; union-find; a group keeps one birth date.
- Winner: latest real update first; systems whose timestamps are not real go last.

## Judges (cheapest first)
- `source-rules`: haiku -> sonnet -> opus, 3 samples; every quote must occur in the notes.
- `vendex-entries`: same tiers; every extracted substring must occur in its entry.
- `country-names`: same tiers; ISO code must be in the spec table.

## Guards and invariants
Guards: inputs-shape, spec-tables, lines-known, row-ids-unique, values-parse, countries-known, rate-known.
Invariants: rows-conserved, one-birth-per-person, entity-is-min-row, amounts-two-decimals, phones-e164.

## Change in this pass
The code had ATLAS's cutoff backwards. The notes say ATLAS is month-first by default, and rows last changed on or after 3 Nov 2022 swap. The rule is now `X_then_Y` and the code reads it as before/after the cutoff. This fixes regression case-0, which is identical to trace-0.

## check-traces (last full run; budget then exhausted)
- Exact: case-0, trace-0, trace-3.
- trace-5: same 43 records as a set; only the order differs.
- Disagreements, where the solver follows the task text:
  - trace-1 record 10 amount: ATLAS "owed ... CR" and "flip its sign" give +16387.31; agent gave -16387.31.
  - trace-4 records 4, 10, 13, 18, 19: LEDGR "4.700,00-" and "Saldo changes sign in the master" give positive; agent gave negative.
  - trace-6 records 2, 3, 4, 8, 11: same "Saldo changes sign in the master" sentence; agent signs are opposite.
  - trace-2 record 3 (BENEDETTI): ATLAS 1751 has no birth date and does not link to its group; family spelled "Bemedetti". Not fixed.
- trace-7: deopt, budget. The source-rules judge gave three different haiku answers, then the gateway refused the sonnet escalation (build spend $1.41 of $1.5). Not a logic deopt; it was exact before this change and is unverified now.

## Limits
The rules judge is unstable on haiku. The ATLAS cutoff date depends on the judge picking the right date when the notes name two.
