# Records-master solver — build notes

`workflow.json` is generated from `src/` by running `python3 src/build.py`.

## How it works
1. **parse** (code): splits the export into rows for the 6 systems and parses the fixed formats. Memo, note and remark text is removed. It also batches Vendex entries in groups of 5 and lists country strings the alias table doesn't know.
2. **config** (Opus, one call): reads the source notes and returns settings per system: date order, balance sign flip, unreliable update dates, implicit country, default currency. It also returns void rules.
3. **vendex** (Haiku→Sonnet, ids checked): extracts the free-text entries, with verbatim text plus the model's reading.
4. **countries** (Haiku): maps unknown or misspelt country names to ISO codes.
5. **resolve** (code): applies void rules and parses dates, money and amounts in words. It normalises phones with the spec's table and merges rows by the spec's matching rules (nicknames, accents, one typo, chains). It then picks the winning value per field and converts to USD with exact rounding.
6. **verify** checks the answer's structure, then **answer**.

## Verified
- All 3 probes score `pass: true, score: 1` (3 of 12 score checks used).
- Cost is about $0.03–0.07 per task, mostly the Opus call. Build spend so far is about $0.21 of $2.
- After the last edits, the code reproduced all 3 scored answers from saved model outputs. A fresh probe 2 run gave the same answer.

## Known weaknesses
- Parsers assume these 6 systems and their line layouts.
- If the config call misreads a note, every row of that system is affected.
- Equal update dates are ordered arbitrarily.
- The `011` prefix is only handled for BRIGHTDESK.
- A multi-word given name in "Given Family" form is split at the first word.
