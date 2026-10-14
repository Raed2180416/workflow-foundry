# BUILD-NOTES

## Procedure in code
- Spec tables (calling codes, trunk prefixes, rates, nickname appendix) are parsed from each task's spec.
- Lines are parsed per system layout. Voids come from markers the rules judge found in the notes.
- Dates, E.164 phones (spec §6) and balances are computed in code. Balances get the per-system sign flip, then exact rational USD conversion, rounded once.
- Names: titles and initials dropped, nicknames replaced, accents restored from other rows.
- Identity: union-find under spec §3 (accent renderings, at most one typing error, equal dates or a shared phone).
- Records: newest row first, unreliable-date systems last. Country, phone and balance come from the first row that has them.

## Judges
- `rules`: claude-opus-5-5 only, one call. Haiku misread a worked example, so I skipped the cheapest-first tier here. Outputs date order, sign flips, void markers and unreliable-date systems. Check: markers and quotes occur in the notes.
- `countries`: one batch, haiku then opus. Check: each text mapped once, codes well-formed.
- `vendex-N`: batches of 4, haiku then opus. Check: quotes verbatim in the entry; code re-parses dates and amounts.

## Guards and invariants
- Guards: inputs present, spec parsed, line formats, balances and names parsed, rates known.
- Invariants: row ids unique, rows conserved, each row in one record, one birth date per person, entity ids unique.

## check-traces
- 0 crashes, 0 deopts, 0 timeouts, 0 regressions. Mean field partial 99.7%. Exact 0/3 (trace-1 differs only in record order).

## Disagreements
- trace-0, entity 1457, `amount_usd`: ours -504.00, agent 44265.51. Spec §4: "the most recent row with a usable balance". KOBO 1457 (2025/08/13) is newer than 9683 (2023/10/11), and its "▲" balance is negative. The agent used the older row.
- trace-2, Kristoffer Kjær (ATLAS 6483) and Ute Becker (ATLAS 6748), `birth_date`: ours MDY, agent DMY. The ATLAS notes say "born 10/02/1952 belongs to someone born in October", so the agent is right. Opus still returned MDY. Known miss, not fixed.
