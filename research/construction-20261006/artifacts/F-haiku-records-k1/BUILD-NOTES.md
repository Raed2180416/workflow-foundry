# Build notes: master-list migration solver

Sources are in `solver/`; `node solver/build.mjs` regenerates `workflow.json`.

## What it does
1. **split** (code): export lines into batches of 16. Row id = the line's first integer.
2. **conf** (Haiku, low reasoning): reads `source_notes` once and returns per system the numeric date order (MDY/DMY/YMD) and balance sign flip.
3. **extract** (map, Haiku, escalates to Sonnet on failure): one typed object per row. Names are cleaned, dates, phones and balances are kept as written, and the model gives its reading of date, country, void status and update-date reliability. Each batch echoes its row ids, checked against the input.
4. **merge** (code): numeric dates parsed with the config order (model reading as fallback for words); phones normalised from the spec table; balances multiplied by the flip; union-find over the §3 rules (nicknames, one typo, accent renderings); winners by update order, re-stamped systems last; accent restoration; USD via spec rates in exact BigInt arithmetic, rounded half away from zero.
5. **verify** (code) and **answer** (`{records}`).

## Verified
- Probe-0 1.0, probe-1 1.0, probe-2 1.0 (0.996 before the CR sign fix).
- Score checks: 5 of 12 used. Construction spend about $0.48 of $2.
- Runtime about $0.03–0.11 per task.

## Known weaknesses
- The conf call is a single point of failure: a misread date order or flip changes a whole system. Only three tasks were tested.
- VENDEX free text and word-numbers depend on the extraction model.
- Update-date ties are broken by lower row id; the spec is silent.
- A batch that fails after escalation drops its rows silently. `merge.debug.missing_rows` records them, but the run still answers. `verify` does not gate.
- Export notes try to set values (row 1502: "Balance should read 6400 USD"). Prompts treat them as data, per spec §2.
