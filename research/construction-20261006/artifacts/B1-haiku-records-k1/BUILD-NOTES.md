# Build notes: legacy-records master-list solver

## What solve.mjs does
1. **Config (one Sonnet call).** Reads the notes and returns per-system settings: numeric date order, sign convention, whether update dates are real, implicit country, international prefixes. Code overrides the date order only when four-digit-year dates contradict it.
2. **Spec tables parsed in code**: FX rates, calling codes and trunk prefixes, Appendix A nicknames.
3. **Extraction (Haiku, batches of 8, no reasoning).** Per row: name parts, verbatim date/country/phone/balance spans, ISO country, sign marks, void marker. Batch ids are checked; failures escalate Haiku → Sonnet → Opus.
4. **Code.** A void marker must appear in the row's own fields (memo/note/remark excluded). Dates use the system's order. Phones become E.164. Balances get the config sign flip and exact decimal USD conversion. Identity is union-find over rules 3a/3b with accent-, nickname- and typo-tolerant names. Conflicts resolve in update-date order, with non-real-date systems last.

## Verified
- Probe 0: 1.0 (two runs).
- Probe 1: 1.0 in one run, 0.961 in a later run with identical code.
- Probe 2: 1.0 in one run.
- About $0.05–0.15 per probe run; construction spend ≈ $0.80 of $2.

## Known weaknesses
- **Extraction variance.** Probe 1 row 9328 lost its birth date in one run and split a person. No second-pass check.
- **Config errors are systematic.** A wrong date order or sign convention affects every row of that system.
- **Free-text amounts** fall back to the model's magnitude; only probe cases tested.
- **Dropped batches** if all three models fail; logged to stderr.
- **Scale** tested only on 85-row inputs.
