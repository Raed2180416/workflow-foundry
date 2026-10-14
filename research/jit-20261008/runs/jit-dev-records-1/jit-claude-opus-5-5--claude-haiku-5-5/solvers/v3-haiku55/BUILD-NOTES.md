# BUILD-NOTES

## Procedure in code
Line parsing per system, void filtering, dates, money (exact decimal, rounded once), phones (E.164), names, identity (union-find on name match plus same birth day, or same phone when one row is undated), records in the spec's most-recent-row order.

## Judges (quotes checked against the notes)
- `rulebook`: balance sign, restamped dates. haiku, then opus. 1 sample.
- `date-order`: BRIGHTDESK and VENDEX numeric date order. haiku, then opus. 5 samples.
- `atlas-dates` (new): ATLAS order before a change-over day, the day, the order after. haiku, then opus. 3 samples. Checked: quote shows the change-over year; orders differ.
- `void-values`: void status values. haiku, then opus. 5 samples.
- `vendex-entries`: free-text fields; each value must occur in its entry. haiku, then opus.
- `country-names`: spellings missing from the static table. haiku, then opus.

## Guards and invariants
Guards: line formats, spec tables, parseable lines, unique ids, rows parse, some rows kept. Invariants: rows conserved, entity id is the smallest source row, well-formed fields.

## This recompile
ATLAS had one global date order. The notes say it switched to month-first for rows last changed on or after 6 June 2023. Birth dates are now read per row. This fixes regression case-0 and trace-0 (same task, same expected answer).

## check-traces (full run)
8 of 9 exact; regression case-0 passes. No deopts, crashes or timeouts. Cost $0.078.

## Disagreement with an agent answer
- **trace-4, `$.records[21].family_name`**: we give "De Vries", the agent "de Vries". The most recent row is BRIGHTDESK 5456 "Nora DE VRIES" (all caps); no row is mixed case. The spec says "letter case is not graded" (section 4). A lowercase-particle rule would break trace-5, which expects "Van Dijk" from all caps, so none was added.
