# Provenance of the fixtures

Item: `galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting` (R-bench pilot P1, harness built 2026-10-08).

| field | value |
| --- | --- |
| upstream | https://github.com/galaxyproject/iwc, `workflows/variant-calling/variation-reporting/` |
| revision | iwc commit `fc190a435262bb61ba29f316e987aa492eb5d18b`; workflow release 0.1.1 (CHANGELOG: 2023-11-20) |
| retrieved | 2026-10-06 (corpus acquisition `research/corpus-20261006/`), copied from `/opt/corpus/galaxy/iwc/...` on 2026-10-08 |
| licence | MIT. Evidence: the `license` field of `Generic-variation-analysis-reporting.ga` ("MIT"). The IWC checkout in the corpus has no LICENSE file at its root, so the workflow's own field is the evidence of record. Redistribution of the workflow and its test data follows from that field. |
| author | Wolfgang Maier (ORCID 0000-0002-9464-6640), per the `creator` field of the .ga |
| acquisition outcome | file copy of five workflow files and five test-data files; nothing executed, nothing installed, no network |
| modifications | none to content. `test-data/Variation data to report_filtered variants ERR3485802.vcf` is stored as `shipped/input.vcf`; the four `.tabular` references keep their names |

## Files (sha256)

| path here | upstream path | sha256 |
| --- | --- | --- |
| original/Generic-variation-analysis-reporting.ga | Generic-variation-analysis-reporting.ga | b146d115ad99dc836ce2df56975b99176e1a6abdc7b30a8e338b9872e088589f |
| original/Generic-variation-analysis-reporting-tests.yml | Generic-variation-analysis-reporting-tests.yml | c60b5c742e5b50c490acc09bd574b1a79999a49ccd55cb61c9d98a211bd24159 |
| original/README.md | README.md | 016c83187d3e20ae91db074dee7801987d3a1d40beb6c47b4c854be0a6ef81be |
| original/CHANGELOG.md | CHANGELOG.md | 45e999782195b75f93787234214d4b962ef1facc68cda1379fdbae7d6a7baead |
| shipped/input.vcf | test-data/Variation data to report_filtered variants ERR3485802.vcf | 4e717c6db8ad784193709cbb64461a0753818b4a423170b0834bf55055d8fbe7 |
| shipped/af_recalculated.tabular | test-data/af_recalculated.tabular | 6a1701a1f6a0b5fe73c576bb0f8e7a54deab1e62ac8b7c7c510b76c272ec95ef |
| shipped/all_variants_all_samples.tabular | test-data/all_variants_all_samples.tabular | f14e8e3990a94e7239718b3be11c07b97e7d3dfe3d3f4bca657b509153a79ec4 |
| shipped/by_variant_report.tabular | test-data/by_variant_report.tabular | c23935f7d721d55c861ea930924e2ba81471af312029391c7d2f12eb52a3054c |
| shipped/combined_variant_report.tabular | test-data/combined_variant_report.tabular | 9769df7c4d5913634ca16574c56bf0f08899a86b47afefe79421d7b940fae970 |

The `.ga` hash equals the `rawPin.sha256` recorded in `experiments/replicate/selection.json`.

## Derived data

`fixtures/frozen-battery.json` holds hashes (not data) of the canonical derived battery. The derived VCFs are generated on demand by
`cases.mjs` from the shipped records (resampled and perturbed; sample names, depths, allele counts and positions of the hand-built
boundary records are synthetic). The expected tables of derived cases come from `reference.mjs` and are labelled `derived`.

## Safety

The workflow and test data are untrusted data: nothing from the corpus was executed. The only code run is code written in this item.
No external service is called by the item, its oracle or its controls (there is nothing to mock; see README "External calls").
