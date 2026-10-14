# BUILD-NOTES

## Procedure in code
Line parsing for six systems; per-system date parsing; exact decimal money rounded half away from zero; E.164 phones from the spec tables; name splitting; identity linking (birth-date rule, phone rule, one-typo names); void filtering; most-recent-first conflicts with the restamp rule; USD conversion.

## Judges
- `rulebook` (haiku, then opus): balance_sign, update_dates_real, quote. One sample. Check: quotes occur in the notes.
- `date-order` (haiku, then opus; 5 samples, majority): numeric date order for BRIGHTDESK, ATLAS, VENDEX. Check: "none" is rejected where the export has numeric dates.
- `void-values` (haiku, then opus; 5 samples): void status values. Check: each value occurs in the notes.
- `vendex-entries` (haiku, then opus): free-text fields. Check: raw values are substrings of the entry; dates parse; amount and currency agree.
- `country-names` (haiku, then opus): only for spellings not in code tables.

## Changes this round
- Vendex entries with no balance give a null amount and currency (the schema forced a string; traces 0 and 1 deopted).
- An all-caps run at the end of an auto-style name is the family name ("Nora DE VRIES").
- Date order and void values moved from the single rulebook read into sampled judges (one read had dropped VERITAS `replay`).

## Guards and invariants
All existing ones kept; none added beyond the judge checks.

## Check result
`node tools/check-traces.mjs`: 4/5 exact; 0 deopt, 0 crash, 0 timeout. No `regressions/` directory exists, so regressions are 0/0 and were not run. Build spend $0.44 of $1.5.

## Disagreement with agent answers
- trace-1, `$.records[21].family_name`: "De Vries" (solver) vs "de Vries" (agent). Spec §4: "letter case is not graded".

## Risks
- trace-0's notes state no VENDEX numeric convention; its DMY vote is a default that matches the agent.
- rulebook balance_sign and update_dates_real are single-sample.
