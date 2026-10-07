# Record-migration solver: build notes

## What `solve.mjs` does
1. **Spec (code):** reads the FX rates, phone code/trunk table and nickname appendix from `inputs.spec`.
2. **Notes config (models):** two parallel Opus calls (`low`), plus a third (`medium`) only on disagreement, with a per-field majority vote. Per system they return: date order, balance sign (SAME/FLIP/WORDS), whether update dates are real, default currency, implied country, void-marker literals.
3. **Rows:** code parsers for BRIGHTDESK, LEDGR, ATLAS, KOBO and VERITAS strip memo/note fields before void checks. Free-text lines (VENDEX or unknown systems) are void-checked in code, then extracted by Sonnet in batches of 6 as raw text plus reading. Code parses the raw dates and numerals; missing ids are retried singly.
4. **Code:** country aliases (Sonnet maps only unknown strings), E.164 phones, exact BigInt FX with half-away rounding, name matching (≤1 typo, accents, nicknames), union-find identity, conflict ordering (systems with unreal dates last), accent restoration.

## Verified
- Probes 0, 1 and 2 all **pass with score 1.0**.
- After the config-vote and void-literal hardening, re-runs gave byte-identical answers.
- Cost: about **$0.10–0.13 per task**.

## Known weaknesses
- Structured parsers assume the probe line layouts. Other layouts fall back to less reliable model extraction.
- ATLAS "Title Given Family" names with a two-word given name split wrongly.
- A local phone on a row with no country is dropped, with no fallback to the person's country.
- Free-text void check is "ends with marker", so a remark ending in the exact marker would wrongly void the row.
- Equal update dates are ordered by row id, which the spec doesn't define.
- If both config calls misread the notes the same way, the vote can't catch it.
