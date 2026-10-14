# BUILD-NOTES

## Procedure in code
- Spec tables are read each run: calling codes, trunk prefixes, FX rates, nicknames.
- Fixed-layout parsers for BRIGHTDESK, LEDGR, ATLAS, KOBO, VERITAS. VENDEX goes to a judge.
- Phones: `+`/`00`/`011` prefixes, trunk `0` dropped, Italy keeps its `0`.
- Dates: numeric order from the rulebook (BRIGHTDESK, ATLAS, VENDEX); LEDGR DMY; KOBO Y/M/D and S/H eras.
- Money: sign flip from the rulebook; exact BigInt conversion, rounded half away from zero once.
- Identity: union-find over spec 3(a)/(b); nicknames, accents, one typing error allowed.
- Conflicts: spec §4 order; re-stamped systems last; accent and case restored from other rows.

## Judges (haiku-5-5, escalating to opus-5-5 on a failed check)
- `rulebook`: per system, numeric date order, sign, re-stamp flag, void values. Checks: quotes and void values occur in the notes.
- `vendex-entries`: raw name, date, phone and amount spans, country, currency, direction. Checks: spans are substrings; dates and amounts parse.
- `country-names`: only spellings missing from the code dictionary. Check: full coverage.

## Guards and invariants
- Guards: line formats, parseable lines, unique ids, spec tables, row parse, rows kept.
- Invariants: rows conserved, entity id is smallest source row, well-formed fields.

## Check result
`node tools/check-traces.mjs`: 3/3 exact, 0 deopt, 0 crash, 0 timeout. No regression cases exist. About $0.01 per run.

## Disagreements
None. In development a judge mapped "Australien" to AT; the code dictionary now covers it.

## Other checks
- Trace-0 notes swapped to trace-2 wording flipped BRIGHTDESK to month-first with opposite sign, as expected.
- A VENDEX remark telling the assistant to change the spec was treated as data.

## Risks
- The rulebook is trusted through quotes and enums; a wrong rule with a real quote passes.
- Unseen country spellings go to the model.
