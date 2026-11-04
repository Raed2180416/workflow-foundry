# PREREG-TIERDOWN AMENDMENT-1: the C-slice selection, frozen before any H call

Written 2026-11-04 ~14:55 UTC, after every C-slice paid answer and the C injection, and before any H-slice request was
answered by any tier. Nothing in the H slice had been read by a person or a model when this was frozen. The base
preregistration ([PREREG-TIERDOWN.json](PREREG-TIERDOWN.json), sha256 `2790ad22…dfaffd4`) is unchanged.

## Frozen inputs (sha256)

| file | sha256 |
|---|---|
| `experiments/tierdown/rules/countries.mjs` | `cca9abe4e66e77a4c156d12705a02567c3eff38b698c1d81df5d92e3c593a361` |
| `experiments/tierdown/rules/date-order.mjs` | `15374a3882306b08f95d4c16d9a1cb02241b94c5466037b46303ece83c23e17b` |
| `experiments/tierdown/rules/index.mjs` | `12e3d48e8efd4ff22f65c44b35085d267c69e4b90637cf86da7cba1a81b40975` |
| `data/select-C.json` (selection, order, baselines, assignment specs) | `9613f165f7aacbfec28dbf0171aec329893142b0ae79addb0fdfa23a441faf73` |
| `data/answers-C.jsonl` | `e27d70a6184bc50ab31d971f195b5a4bdc95192cc62959862a6ccad129c2d84f` |
| `data/answers-C-rule.jsonl` | `67cc5f6617cb2b30adad722dd696bb0df37e81b49f43ebffaaca9d87b63e05d6` |
| `data/inject-C.json` | `daadb673a585a88a408af24ad17ad7fe53a053b885b9b44bba25b8fd24f1945b` |

## The frozen order (fixed-sequence testing on H, in this order)

| # | site | tier | leverage class (C) | δ | zero-flip units needed |
|---|---|---|---|---|---|
| 1 | kinetics/prose-events-a | claude-haiku-5-5 | high | 0.02 | 149 |
| 2 | records/source-rules | claude-haiku-5-5 | mid | 0.05 | 59 |
| 3 | records/void-values | mercury-3 | high | 0.02 | 149 |
| 4 | records/date-order | mercury-3 | high | 0.02 | 149 |
| 5 | records/vendex-entries | mercury-3 | low | 0.10 | 29 |
| 6 | records/countries | rule | low | 0.10 | 29 |
| 7 | records/country-names | rule | low | 0.10 | 29 |

Not selected on C (keep the reference): records/rules (Haiku: Bound 2 fails, disagreement 0.062, and 1 pass→fail plus
2 deopts in 11 C units; Mercury: usable 3/5), kinetics/well-events (Haiku: disagreement 0.231, 2 pass→fail in 3 C units;
Mercury: not asked, the C token share ran out), kinetics/extract:* (Haiku: disagreement 0.115, 1 pass→fail in 2 units),
and every memo tier (no identical earlier delivery request exists in the archive, so memo never answered).

**Prediction restated.** Site 1 needs 149 zero-flip H units and has 5; the sequence stops there, so the primary policy
promotes nothing. The secondary (exploratory) provisional policy is computed exactly as preregistered.

## Combined assignments injected on H (frozen)

- `selected`: all seven selected (site, tier) pairs together (the provisional policy is this set minus every pair that
  fails its H conditions; if any pair fails, the reduced set is injected as `provisional` in a second $0 pass).
- `B-screen`: void-values@mercury-3, vendex-entries@mercury-3, country-names@rule, countries@rule.
- `B-all-haiku`: rules, source-rules, well-events, prose-events-a, extract:* at claude-haiku-5-5.
- `B-all-mercury`: rules, source-rules, well-events, date-order, void-values, vendex-entries, country-names, countries at mercury-3.
- `B-sink`: extract:*@claude-haiku-5-5, date-order@rule, void-values@mercury-3, vendex-entries@mercury-3, country-names@rule, countries@rule.
- `B-memo`: every site at memo.
- plus every single (site, tier) pair with H answers (`--each`).

## Clarifications fixed here (each decided on C, before H)

1. **Floating point in Bound 2.** `bound2` compared `1 - 0.95 = 0.050000000000000044` with ε = 0.05 and failed
   records/date-order@mercury-3 (19 of 20 leaves). The preregistered rule is "≤ 0.05"; the comparison now allows
   1e-12. This changed one C eligibility (date-order@mercury-3 became eligible) and nothing else.
2. **B-sink's "cheapest measured tier"** is the cheapest tier with at least one usable C answer. Memo never answered, so
   it cannot stand in for a cheap model; a literal reading would have made B-sink equal to the reference on extract:*.
3. **Incomplete units** (an assigned tier with no answer for some decision of the unit, e.g. after a token cap) are left
   out of a combined comparison and counted; they are never scored as reference units.
4. **Token allocation.** The item's 450,000 Mercury tokens are split 225,000 C / 225,000 H. C used 216,474 (Mercury
   writes long answers: two records/source-rules answers ran to ~23.7K output tokens and were truncated). H asks
   Mercury in this order until its share is spent: the selected Mercury sites (void-values, date-order, vendex-entries),
   then the small B-all-mercury sites (country-names, countries), then records/rules, kinetics/well-events and
   records/source-rules. A B-all-mercury unit left without answers is incomplete (clarification 3).
5. **Haiku.** C spent $0.228 of the $3 Haiku cap; H asks Haiku for every Haiku site.

## Observed on C (development evidence, in-sample for the rule tier)

- The rule tier answered every C request it was written for (countries 11/11, country-names 19/19, date-order 10/10)
  and changed no C outcome for the worse; on date-order it disagreed with the Haiku ×5 reference on 2 of 10 tasks and
  both of those injected as **fail→pass** (the reference was wrong: a worked example "dob=01/02/1996 is 2 January 1996"
  read as DMY, and "11/05/1996 is 5 November 1996" read as DMY). Bound 2 (agreement with the reference) still rejects
  it (disagreement 0.083 > 0.05): the preregistered yardstick penalises a tier that is right where the reference is
  wrong. The rule is kept out of the policy as preregistered; RESULT-TIERDOWN.md reports it.
- records/date-order@mercury-3 also produced 1 fail→pass on C.
