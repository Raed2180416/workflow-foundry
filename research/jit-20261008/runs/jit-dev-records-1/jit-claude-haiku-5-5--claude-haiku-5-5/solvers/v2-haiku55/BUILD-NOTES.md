# BUILD-NOTES

## Procedure in code
Line parsing for the six formats, placeholders, dates (DMY/MDY, Japanese eras), money (German format, minus/CR/parentheses, spelled-out amounts), E.164 phones, country aliases with fuzzy match, nickname and accent handling, identity (union-find over the spec's two match rules), conflict order, exact rational USD conversion rounded once.

## Judges (haiku, then sonnet, then opus)
- `source-rules`: per-system reading rules (date order, balance sign, update-date reliability, VENDEX era) with quotes, plus void markers. Quotes must occur in the notes; a `no` reliability rule needs none.
- `vendex-entries`: free-text extraction; substrings must occur in the entry.
- `country-names`: only names the alias table cannot resolve.

## Guards and invariants
Guards: inputs-shape, spec-tables, lines-known, row-ids-unique, values-parse, countries-known, rate-known. Invariants: rows-conserved, one-birth-per-person, entity-is-min-row, amounts-two-decimals, phones-e164.

## Changes this round
- Update-date reliability is one rule per system (was VERITAS only). Trace-1's notes re-stamp LEDGR's dates. This removed the trace-1 deopt.
- "pounds sterling" reads as GBP. This removed the trace-0 `values-parse` deopt.

## check-traces (full run)
Clean: no crash, deopt or timeout. There is no `regressions/` directory, so the regression gate is vacuous. Exact: trace-0, trace-4. Diffs: trace-1, trace-2, trace-3.

## Disagreements with agent answers
- **trace-3 and trace-1, amount_usd sign (LEDGR, KOBO rows).** trace-3: "Saldo changes sign in the master." trace-1: "Saldo changes sign in the master" and "KOBO balances change sign in the master." The solver flips these (trace-3 entity 1252: "231,66- CHF" → +272.96); the agent did not. All 16 trace-3 and 9 trace-1 diffs are this kind.
- **trace-1, family_name case (entity 3937).** The solver gives "De Vries"; the agent gives "de Vries". The spec says "letter case is not graded".
- **trace-2, record order only.** The agent answer is not sorted by entity_id. Every field matches. The spec sets no order; the solver emits ascending entity_id.
