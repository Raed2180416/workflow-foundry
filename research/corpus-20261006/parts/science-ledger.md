# Science cluster: acquisition ledger (corpus-20261006)

Cluster scope: scientific workflow systems: nf-core and other Nextflow pipelines, Galaxy (IWC + WorkflowHub), CWL, Snakemake and WDL (GitHub repositories, Dockstore, WorkflowHub). Items: `parts/science.jsonl` (`foundry-corpus-item/1`). Raw downloads only under `/opt/corpus/{nf-core,galaxy,cwl,wdl,snakemake,workflowhub,dockstore}/` and converter outputs under `/opt/corpus/science-work/` (outside git). Converters and fetchers: `scripts/science-*.py` (pins in `scripts/science-requirements.txt`). All corpus content was treated as data: Nextflow and Snakefiles were scanned statically (regex/tokeniser; never run, no `nextflow` or `snakemake` binary used), Galaxy `.ga` / CWL / YAML parsed as JSON / `yaml.safe_load`, WDL loaded with the miniwdl parser and type checker with a local-only import reader (no network imports). Git clones were shallow, blob-filtered and sparse, with hooks disabled, no LFS and no submodules. No containers, conda environments, test suites or install hooks were run.

Retrieved 2026-10-06/07. Status: **development/diagnostic corpus**, not sealed evaluation data. Total selected: **278** items (237 redistributable as normalised graphs; the other 41 keep URL + derived graph structure only, with titles replaced by ids and no description or summaries).

## Reproduction

```sh
S=research/corpus-20261006/scripts; V=/opt/corpus/.venv-science/bin/python   # uv venv --python 3.13; uv pip install -r $S/science-requirements.txt
python3 -I $S/science-fetch-nfcore.py                       # nf-co.re/pipelines.json + sparse clones at latest release tags
git -c core.hooksPath=/dev/null clone --depth 1 --filter=blob:limit=1m --no-recurse-submodules https://github.com/galaxyproject/iwc /opt/corpus/galaxy/iwc
python3 -I $S/science-fetch-snakemake.py 70                  # snakemake-workflow-catalog: top 70 standardized by stars
python3 -I $S/science-fetch-git.py                           # CWL + WDL GitHub repositories (section E)
python3 -I $S/science-fetch-workflowhub.py meta && ... select && ... files && ... crate-meta && ... gitapi
python3 -I $S/science-fetch-dockstore.py list && ... select 70 && ... files
for c in nfcore iwc snakemake-catalog cwl-repos wdl-repos workflowhub dockstore; do $V -I $S/science-$c.py; done   # -> /opt/corpus/science-work/*.jsonl
python3 -I $S/science-assemble.py && python3 -I $S/science-ledger.py
```

Selection (seeded 20261006, `science-assemble.py`): graphs with <3 nodes are dropped; structural duplicates (same multiset of node types and edge count) are dropped keeping the more authoritative source (IWC > nf-core > Snakemake catalog > CWL repos > WDL repos > Dockstore > WorkflowHub). Per platform a head ranked by complexity plus bonuses for an oracle (output-equivalence +10, test-profile +6), ML-inference steps, runtime fan-out, sub-workflows and branching, minus 20 for tutorial/training/demo material (real production pipelines are preferred); no source owner / IWC category / WorkflowHub project may take more than 35% of a head; then a uniformly random tail from the remainder for representativeness. Non-selected converted candidates stay in `/opt/corpus/science-work/*.jsonl`.

Science-cluster feature conventions (nodes, category, effects, loops, connectors) are documented at the top of `scripts/science-common.py`. In short: nodes are executable steps (processes / tools / rules / calls) after inlining static sub-workflows, plus input-validation and operator nodes; `loops` counts runtime fan-out over data (scatter, collection mapping, per-sample channels, wildcard expansion); `connectors` are `tool:<package>` and `service:<data service>`; `model` marks local ML-inference tools (AlphaFold, DeepVariant, Cellpose, Dorado, ...), not hosted LLM calls. Edges in Nextflow/Snakemake graphs are statically inferred may-flow edges, not traced executions.

## Per-platform outcome

| platform | candidates (by source) | selected (head+tail) | selected by source | redistributable | licences (selected) | oracle kinds (selected) | median nodes (selected) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nf-core | 107 (nf-core 107) | 72 (60+12) | nf-core 72 | 72 | MIT 72 | output-equivalence 46, test-profile 26 | 69 |
| galaxy | 193 (galaxy-iwc 118, workflowhub 75) | 60 (45+15) | galaxy-iwc 35, workflowhub 25 | 49 | MIT 26, CC-BY-4.0 18, Apache-2.0 4, GPL-3.0 4, GPL-3.0-or-later 2, CC-BY-NC-4.0 2, AGPL-3.0-or-later 1, LicenseRef-WorkflowHub-other-open 1, Artistic-2.0 1, unknown 1 | test-profile 26, none 26, output-equivalence 8 | 47 |
| cwl | 132 (workflowhub 89, cwl-repos 43) | 45 (32+13) | cwl-repos 23, workflowhub 22 | 36 | Apache-2.0 23, unknown 8, MIT 7, LicenseRef-US-Government-Public-Domain 4, LicenseRef-WorkflowHub-other-open 1, BSD-3-Clause 1, CC-BY-4.0 1 | none 43, test-profile 2 | 28 |
| snakemake | 117 (snakemake-catalog 70, workflowhub 47) | 40 (28+12) | snakemake-catalog 29, workflowhub 11 | 29 | MIT 25, GPL-3.0 8, unknown 2, CC-BY-4.0 2, BSD-2-Clause 1, Apache-2.0 1, AGPL-3.0 1 | test-profile 28, none 10, output-equivalence 2 | 70 |
| wdl | 81 (dockstore 43, wdl-repos 35, workflowhub 3) | 36 (26+10) | dockstore 17, wdl-repos 17, workflowhub 2 | 28 | BSD-3-Clause 16, MIT 7, unknown 4, GPL-3.0 3, BSD-3-Clause-Clear 3, CC-BY-4.0 2, AGPL-3.0 1 | none 15, output-equivalence 14, test-profile 7 | 36 |
| nextflow | 84 (workflowhub 84) | 25 (18+7) | workflowhub 25 | 23 | MIT 16, Apache-2.0 5, CC-BY-4.0 2, GPL-3.0 1, GPL-3.0-or-later 1 | output-equivalence 9, none 8, test-profile 8 | 78 |

Per-source conversion and filtering (before selection):

| source | converted | kept | dropped <3 nodes | dropped placeholder | dropped structural duplicate |
| --- | --- | --- | --- | --- | --- |
| galaxy-iwc | 126 | 118 | 5 | 0 | 3 |
| nf-core | 107 | 107 | 0 | 0 | 0 |
| snakemake-catalog | 70 | 70 | 0 | 0 | 0 |
| cwl-repos | 45 | 43 | 0 | 0 | 2 |
| wdl-repos | 35 | 35 | 0 | 0 | 0 |
| dockstore | 47 | 43 | 3 | 0 | 1 |
| workflowhub | 329 | 298 | 6 | 0 | 25 |

Structural duplicates dropped (dropped -> kept): `galaxy:iwc/qiime2-I-import/QIIME2-Id-demultiplexed-data-paired-end` -> `galaxy:iwc/qiime2-I-import/QIIME2-Ic-demultiplexed-data-single-end`; `galaxy:iwc/chipseq-sr/chipseq-sr` -> `galaxy:iwc/chipseq-pe/chipseq-pe`; `galaxy:iwc/consensus-peaks/consensus-peaks-chip-sr` -> `galaxy:iwc/consensus-peaks/consensus-peaks-chip-pe`; `cwl:common-workflow-library/bio-cwl-tools/bwa/BWA-Mem2-paired.cwl` -> `cwl:common-workflow-library/bio-cwl-tools/bwa/BWA-Mem2-single.cwl`; `cwl:kids-first/kf-alignment-workflow/workflows-deprecated/kfdrc_alignment_wf_3vcf.cwl` -> `cwl:kids-first/kf-alignment-workflow/workflows-deprecated/kfdrc_alignment_wf.cwl`; `wdl:github.com/erikwolfsohn/public_health_bacterial_genomics/TheiaProk_Illumina_PE_Kaptive2:main` -> `wdl:github.com/erikwolfsohn/public_health_bacterial_genomics/CCPHL_NARMS_Table:main`; `cwl:workflowhub/2051` -> `cwl:workflowhub/2052`; `cwl:workflowhub/1982` -> `cwl:workflowhub/45`; `cwl:workflowhub/1992` -> `cwl:workflowhub/1993`; `snakemake:workflowhub/2321` -> `snakemake:workflowhub/2320`; `cwl:workflowhub/75` -> `cwl:workflowhub/45`; `cwl:workflowhub/1988` -> `cwl:workflowhub/1987`; `cwl:workflowhub/1994` -> `cwl:workflowhub/1990`; `snakemake:workflowhub/1380` -> `snakemake:workflowhub/1377`; `cwl:workflowhub/1989` -> `cwl:workflowhub/1990`; `cwl:workflowhub/98` -> `cwl:workflowhub/121`; `nextflow:workflowhub/1321` -> `nextflow:workflowhub/1320`; `galaxy:workflowhub/1486` -> `galaxy:workflowhub/1601`; `galaxy:workflowhub/1490` -> `galaxy:workflowhub/1496`; `galaxy:workflowhub/1432` -> `galaxy:workflowhub/252`; `galaxy:workflowhub/403` -> `galaxy:workflowhub/794`; `galaxy:workflowhub/1437` -> `galaxy:workflowhub/1788`; `galaxy:workflowhub/1651` -> `galaxy:workflowhub/676`; `galaxy:workflowhub/109` -> `galaxy:iwc/sars-cov-2-variation-reporting/variation-reporting`; `galaxy:workflowhub/1078` -> `galaxy:workflowhub/1561`; `galaxy:workflowhub/2179` -> `galaxy:iwc/histological-staining-area-quantification/histological-staining-area-quantification`; `galaxy:workflowhub/1485` -> `galaxy:workflowhub/1574`; `galaxy:workflowhub/763` -> `galaxy:workflowhub/764`; `galaxy:workflowhub/762` -> `galaxy:workflowhub/764`; `galaxy:workflowhub/761` -> `galaxy:workflowhub/764`; `galaxy:workflowhub/1505` -> `galaxy:workflowhub/41`.

## Feature totals over the selected items

- nodes 19627, edges 52225; items with ML-inference steps 45, runtime fan-out (map) 231, branching 208, inlined sub-workflows 153, inline/local code 156, public-archive reads 121, external effects (notifications/exports) 74, error handlers 81
- node categories: action 10927, code 4186, transform 2568, condition 799, other 624, model 237, merge 197, error-handler 86, subworkflow 3
- async mechanisms: none (scientific pipelines here are batch: no triggers, schedules, webhooks or human steps were found)
- IR verdicts: native 147, via-extension 131; extensions needed: retry-policy 94, error-branch 77, completion-hook 72, subworkflow-call 20, dynamic-dag 17
- oracles: none 102, test-profile 97, output-equivalence 79
- licences: MIT 153, Apache-2.0 33, CC-BY-4.0 25, BSD-3-Clause 17, GPL-3.0 16, unknown 15, LicenseRef-US-Government-Public-Domain 4, GPL-3.0-or-later 3, BSD-3-Clause-Clear 3, CC-BY-NC-4.0 2, LicenseRef-WorkflowHub-other-open 2, AGPL-3.0 2, AGPL-3.0-or-later 1, Artistic-2.0 1, BSD-2-Clause 1
- domains (heuristic keyword tags): science 278, genomics 238, bioinformatics 132, annotation 132, variant-calling 97, assembly 95, phylogenetics 92, transcriptomics 75, metagenomics 68, structural-biology 48, long-read 42, epigenomics 41, clinical 37, imaging 27, population-genetics 26, virology 24, immunology 24, proteomics 19, single-cell 18, earth-science 15, chemistry 11, metabolomics 2
- data services referenced: service:email 72, service:http-download 58, service:ensembl 29, service:im-webhook 29, service:ncbi 29, service:sra 10, service:gtdb 6, service:uniprot 5, service:igenomes-s3 3, service:kegg 3, service:geo 3, service:ena 3, service:idr 3, service:galaxy-export 2, service:zenodo 2, service:copernicus 1, service:dataverse 1

IR notes. Every nf-core pipeline needs `retry-policy` (resource-escalating retries on `task.attempt`), `completion-hook` (e-mail/IM summary on completion) and `error-branch` (onError handler) extensions; DSL2 processes implicitly map over channel items (-> IR map) and params-gated if-blocks become when-guards. Galaxy, CWL and WDL graphs are `native` under the Phase 1 IR when sub-workflows are inlined at compile time (scatter / collection mapping -> map, `when` / if-sections -> when guards); Snakemake `module`/`subworkflow` imports need `subworkflow-call`; Nextflow `recurse`/`until` iteration needs `dynamic-dag`. These verdicts are static-analysis claims about structure, not demonstrations of executed equivalence.

## Most complex selected items

| item | nodes | edges | complexity | oracle | licence | url |
| --- | --- | --- | --- | --- | --- | --- |
| `nf-core:oncoanalyser@3.0.0` | 348 | 2039 | 2859.5 | output-equivalence | MIT | https://nf-co.re/oncoanalyser/3.0.0 |
| `nf-core:viralmetagenome@1.2.0` | 345 | 2821 | 2548.5 | output-equivalence | MIT | https://nf-co.re/viralmetagenome/1.2.0 |
| `nf-core:sarek@3.10.0` | 396 | 1837 | 2405.0 | output-equivalence | MIT | https://nf-co.re/sarek/3.10.0 |
| `nextflow:workflowhub/1030` | 306 | 1603 | 1956.0 | output-equivalence | MIT | https://workflowhub.eu/workflows/1030?version=3 |
| `nf-core:riboseq@2.0.0` | 308 | 1403 | 1832.5 | output-equivalence | MIT | https://nf-co.re/riboseq/2.0.0 |
| `nf-core:rnadnavar@1.0.0` | 244 | 901 | 1548.5 | output-equivalence | MIT | https://nf-co.re/rnadnavar/1.0.0 |
| `nf-core:raredisease@3.1.2` | 315 | 730 | 1404.5 | test-profile | MIT | https://nf-co.re/raredisease/3.1.2 |
| `nf-core:ampliseq@2.18.0` | 184 | 1143 | 1403.5 | output-equivalence | MIT | https://nf-co.re/ampliseq/2.18.0 |
| `snakemake:workflowhub/1759` | 210 | 1615 | 1344.5 | test-profile | GPL-3.0 | https://workflowhub.eu/workflows/1759?version=1 |
| `nf-core:rnaseq@3.27.0` | 191 | 990 | 1310.0 | output-equivalence | MIT | https://nf-co.re/rnaseq/3.27.0 |
| `nf-core:mag@5.5.0` | 161 | 851 | 1223.0 | output-equivalence | MIT | https://nf-co.re/mag/5.5.0 |
| `nf-core:proteinfold@2.0.0` | 285 | 632 | 1204.0 | output-equivalence | MIT | https://nf-co.re/proteinfold/2.0.0 |
| `wdl:github.com/wustl-oncology/analysis-wdls/immuno:main` | 257 | 926 | 1172.5 | none | MIT | https://dockstore.org/workflows/github.com/wustl-oncology/analysis-wdls/immuno:main |
| `nf-core:variantbenchmarking@1.5.0` | 135 | 962 | 1013.0 | output-equivalence | MIT | https://nf-co.re/variantbenchmarking/1.5.0 |
| `nf-core:viralrecon@3.0.0` | 163 | 517 | 952.0 | output-equivalence | MIT | https://nf-co.re/viralrecon/3.0.0 |
| `nextflow:workflowhub/2197` | 122 | 1171 | 915.0 | none | MIT | https://workflowhub.eu/workflows/2197?version=2 |
| `cwl:ncbi/pgap/pgap.cwl` | 233 | 522 | 906.5 | none | LicenseRef-US-Government-Public-Domain | https://github.com/ncbi/pgap/blob/2a81fcde75ca7665814c8de2210c7bc3121a08a3/pgap.cwl |
| `nf-core:funcscan@4.0.0` | 179 | 285 | 862.5 | output-equivalence | MIT | https://nf-co.re/funcscan/4.0.0 |
| `nextflow:workflowhub/1864` | 181 | 349 | 831.0 | none | CC-BY-4.0 | https://workflowhub.eu/workflows/1864?version=1 |
| `cwl:ncbi/pgap/wf_pgap_simple.cwl` | 208 | 473 | 816.0 | none | LicenseRef-US-Government-Public-Domain | https://github.com/ncbi/pgap/blob/2a81fcde75ca7665814c8de2210c7bc3121a08a3/wf_pgap_simple.cwl |
| `galaxy:iwc/post-curation-processing/Post_Curation` | 255 | 366 | 780.5 | test-profile | MIT | https://github.com/galaxyproject/iwc/blob/fc190a435262bb61ba29f316e987aa492eb5d18b/workflows/VGP-assembly-v2/post-curation-processing/Post_Curation.ga |
| `snakemake:friendsofstrandseq/mosaicatcher-pipeline@v2.5.1` | 207 | 389 | 752.0 | test-profile | MIT | https://github.com/friendsofstrandseq/mosaicatcher-pipeline/tree/2289f7cc8ef20ef2914bc1381a03b0367b7fe445 |
| `snakemake:IKIM-Essen/RiboSnake@v0.11.0` | 122 | 199 | 747.0 | test-profile | MIT | https://github.com/IKIM-Essen/RiboSnake/tree/453e8c885b534b372ed1f22da677bf1347e1d955 |
| `nf-core:rnasplice@1.0.4` | 113 | 306 | 745.0 | test-profile | MIT | https://nf-co.re/rnasplice/1.0.4 |
| `nf-core:genomeassembler@2.0.0` | 191 | 405 | 740.5 | output-equivalence | MIT | https://nf-co.re/genomeassembler/2.0.0 |

## Executable oracles (test profiles / test data shipped with the workflow)

Nothing below was run (no Nextflow, Galaxy, cwltool, Snakemake, Cromwell/miniwdl execution, Docker or conda in this container). `output-equivalence` = the source ships expected outputs or checksums to compare against (nf-test snapshots with md5s, planemo `-tests.yml` with reference files/checksums, Snakemake `.tests/unit` expected outputs, WARP `verification/Verify*.wdl` truth comparisons, ENCODE `ref_output/` QC JSON); `test-profile` = a runnable small test configuration with pinned test data but only content assertions or a smoke run (nf-core `conf/test*.config`, planemo content assertions, Snakemake `.test/` configs, Dockstore/WARP test input JSONs, WorkflowHub RO-Crate TestSuite entities). Test data are referenced (nf-core/test-datasets, Zenodo, GCS buckets), not downloaded.

| platform | output-equivalence | test-profile | none |
| --- | --- | --- | --- |
| nf-core | 46 | 26 | 0 |
| galaxy | 8 | 26 | 26 |
| cwl | 0 | 2 | 43 |
| snakemake | 2 | 28 | 10 |
| wdl | 14 | 7 | 15 |
| nextflow | 9 | 8 | 8 |

<details><summary>Selected items with an oracle (evidence from the oracle notes)</summary>

| item | kind | evidence |
| --- | --- | --- |
| `galaxy:iwc/Plot-Nx-Size/Generate-Nx-and-Size-plots-for-multiple-assemblies` | output-equivalence | planemo tests: 1 case(s), 3 checked outputs (1 vs reference files/checksums, 3 with content assertions); inputs from ['zenodo.org'] + local test-data/. Require… |
| `galaxy:iwc/mgnify-amplicon-pipeline-v5-complete/mgnify-amplicon-pipeline-v5-complete` | output-equivalence | planemo tests: 1 case(s), 38 checked outputs (7 vs reference files/checksums, 37 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/mgnify-amplicon-pipeline-v5-its/mgnify-amplicon-pipeline-v5-its` | output-equivalence | planemo tests: 1 case(s), 10 checked outputs (1 vs reference files/checksums, 10 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/mgnify-amplicon-pipeline-v5-rrna-prediction/mgnify-amplicon-pipeline-v5-rrna-prediction` | output-equivalence | planemo tests: 1 case(s), 13 checked outputs (3 vs reference files/checksums, 13 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/pathogen-detection-pathogfair-samples-aggregation-and-visualisation/Pathogen-Detection-PathoGFAIR-Samples-Aggregation-and-Visualisation` | output-equivalence | planemo tests: 1 case(s), 1 checked outputs (1 vs reference files/checksums, 1 with content assertions); inputs from [] + local test-data/. Requires a Galaxy s… |
| `galaxy:iwc/pox-virus-amplicon/pox-virus-half-genome` | output-equivalence | planemo tests: 1 case(s), 1 checked outputs (1 vs reference files/checksums, 0 with content assertions); inputs from ['www.ebi.ac.uk'] + local test-data/. Requ… |
| `galaxy:iwc/scanpy-clustering/Preprocessing-and-Clustering-of-single-cell-RNA-seq-data-with-Scanpy` | output-equivalence | planemo tests: 1 case(s), 21 checked outputs (1 vs reference files/checksums, 20 with content assertions); inputs from ['zenodo.org'] + local test-data/. Requi… |
| `galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting` | output-equivalence | planemo tests: 1 case(s), 4 checked outputs (4 vs reference files/checksums, 1 with content assertions); inputs from [] + local test-data/. Requires a Galaxy s… |
| `nextflow:workflowhub/1030` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 52, job/param files 1, nf-test 66 (snapshots 62), Snakemake .test files 0, test configs 4, test-input sets 0, t… |
| `nextflow:workflowhub/1058` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 8, nf-test 51 (snapshots 49), Snakemake .test files 0, test configs 2, test-input sets 0, te… |
| `nextflow:workflowhub/1862` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 66 (snapshots 63), Snakemake .test files 0, test configs 4, test-input sets 0, te… |
| `nextflow:workflowhub/1865` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 44 (snapshots 18), Snakemake .test files 0, test configs 2, test-input sets 0, te… |
| `nextflow:workflowhub/2105` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 6 (snapshots 6), Snakemake .test files 0, test configs 4, test-input sets 0, test… |
| `nextflow:workflowhub/2217` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 2, job/param files 8, nf-test 31 (snapshots 29), Snakemake .test files 0, test configs 5, test-input sets 0, te… |
| `nextflow:workflowhub/452` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 42 (snapshots 41), Snakemake .test files 0, test configs 1, test-input sets 0, te… |
| `nextflow:workflowhub/462` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 15 (snapshots 11), Snakemake .test files 0, test configs 0, test-input sets 0, te… |
| `nextflow:workflowhub/884` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 10 (snapshots 7), Snakemake .test files 0, test configs 0, test-input sets 0, tes… |
| `nf-core:airrflow@5.1.1` | output-equivalence | profiles ['test', 'test_10x_sc', 'test_assembled_hs', 'test_assembled_immcantation_devel_hs', 'test_assembled_immcantation_devel_mm', 'test_assembled_mm', 'tes… |
| `nf-core:ampliseq@2.18.0` | output-equivalence | profiles ['test', 'test_doubleprimers', 'test_failed', 'test_fasta', 'test_full', 'test_iontorrent', 'test_multi', 'test_multiregion']; nf-test files 16, snaps… |
| `nf-core:bacass@2.6.0` | output-equivalence | profiles ['test', 'test_dfast', 'test_full', 'test_hybrid', 'test_hybrid_dragonflye', 'test_liftoff', 'test_long', 'test_long_autocycler']; nf-test files 14, s… |
| `nf-core:createpanelrefs@1.0.0` | output-equivalence | profiles ['test', 'test_full']; nf-test files 4, snapshots 4 with 58 md5 entries; test data from ['raw.githubusercontent.com/nf-core/test-datasets']. Needs Nex… |
| `nf-core:createtaxdb@3.1.0` | output-equivalence | profiles ['test', 'test_alternatives', 'test_full', 'test_minimal']; nf-test files 3, snapshots 3 with 26 md5 entries; test data from []. Needs Nextflow + a co… |
| `nf-core:differentialabundance@2.0.0` | output-equivalence | profiles ['test', 'test_full']; nf-test files 10, snapshots 10 with 602 md5 entries; test data from ['ftp.ensembl.org', 'raw.githubusercontent.com/nf-core/test… |
| `nf-core:drop@1.0.0` | output-equivalence | profiles ['test', 'test_full']; nf-test files 3, snapshots 3 with 165 md5 entries; test data from ['github.com']. Needs Nextflow + a container engine (Docker/S… |
| `nf-core:epitopeprediction@3.1.1` | output-equivalence | profiles ['test', 'test_fasta_output', 'test_full', 'test_grch38', 'test_mhcflurry', 'test_mhcnuggets', 'test_netmhciipan', 'test_netmhcpan']; nf-test files 8,… |
| `nf-core:funcprofiler@1.0.0` | output-equivalence | profiles ['test', 'test_full']; nf-test files 1, snapshots 1 with 32 md5 entries; test data from []. Needs Nextflow + a container engine (Docker/Singularity); … |
| `nf-core:funcscan@4.0.0` | output-equivalence | profiles ['test', 'test_bakta', 'test_bgc_bakta', 'test_bgc_prokka', 'test_bgc_pyrodigal', 'test_cazyme_pyrodigal', 'test_full', 'test_minimal']; nf-test files… |
| `nf-core:genomeassembler@2.0.0` | output-equivalence | profiles ['test', 'test_busco', 'test_busco_quast', 'test_full', 'test_full_medaka', 'test_input_csv', 'test_input_yml', 'test_quast']; nf-test files 1, snapsh… |
| `nf-core:genomeqc@1.0.1` | output-equivalence | profiles ['test', 'test_decon', 'test_full', 'test_gca', 'test_genomeonly', 'test_hymen', 'test_nofastq', 'test_te']; nf-test files 3, snapshots 3 with 162 md5… |
| `nf-core:hadge@1.0.0` | output-equivalence | profiles ['test', 'test_donor_match', 'test_full', 'test_genetic', 'test_hashing']; nf-test files 4, snapshots 4 with 768 md5 entries; test data from ['github.… |
| `nf-core:longraredisease@1.0.0` | output-equivalence | profiles ['test', 'test_fastq', 'test_full', 'test_ubam']; nf-test files 2, snapshots 1 with 45 md5 entries; test data from ['raw.githubusercontent.com/nf-core… |
| `nf-core:mag@5.5.0` | output-equivalence | profiles ['test', 'test_alternatives', 'test_assembly_input', 'test_full', 'test_hybrid', 'test_longreadonly', 'test_longreadonly_alternatives', 'test_minimal'… |
| `nf-core:magmap@1.2.0` | output-equivalence | profiles ['test', 'test_bakta', 'test_duplicates', 'test_full', 'test_metadata', 'test_single', 'test_skip_preprocessing', 'test_sourmash_genome_selection']; n… |
| `nf-core:metatdenovo@1.4.1` | output-equivalence | profiles ['test', 'test_bbnorm', 'test_eggnog', 'test_eukulele', 'test_full', 'test_kofamscan', 'test_megahit_prokka', 'test_megahit_transdecoder']; nf-test fi… |
| `nf-core:methylong@2.0.0` | output-equivalence | profiles ['test', 'test_dmr', 'test_full', 'test_pod5', 'test_small_aws', 'test_unmodified_bam']; nf-test files 1, snapshots 1 with 16 md5 entries; test data f… |
| `nf-core:methylseq@4.2.0` | output-equivalence | profiles ['test', 'test_full', 'test_gpu', 'test_single_gpu']; nf-test files 8, snapshots 8 with 2002 md5 entries; test data from []. Needs Nextflow + a contai… |
| `nf-core:mhcquant@3.3.0` | output-equivalence | profiles ['test', 'test_full', 'test_ionannotator', 'test_mokapot', 'test_sdrf', 'test_search_presets', 'test_single_quant', 'test_speclib']; nf-test files 7, … |
| `nf-core:nanostring@1.3.3` | output-equivalence | profiles ['test', 'test_full', 'test_samples', 'test_scores']; nf-test files 4, snapshots 4 with 38 md5 entries; test data from []. Needs Nextflow + a containe… |
| `nf-core:oncoanalyser@3.0.0` | output-equivalence | profiles ['test', 'test_full', 'test_stub']; nf-test files 2, snapshots 2 with 254 md5 entries; test data from []. Needs Nextflow + a container engine (Docker/… |
| `nf-core:pacvar@1.1.0` | output-equivalence | profiles ['test', 'test_fiberseq_with_kinetics', 'test_fiberseq_with_m6A_tags', 'test_full', 'test_wgs_deepvariant', 'test_wgs_ensemblvep', 'test_wgs_gatk', 't… |
| `nf-core:pairgenomealign@3.0.4` | output-equivalence | profiles ['test', 'test_full', 'test_reads', 'test_small']; nf-test files 1, snapshots 1 with 24 md5 entries; test data from ['ftp.ncbi.nlm.nih.gov']. Needs Ne… |
| `nf-core:phyloplace@2.3.0` | output-equivalence | profiles ['test', 'test_clustalo', 'test_embedded_taxonomy', 'test_full', 'test_gzipped', 'test_gzipped_hmmfile', 'test_hmmfile', 'test_mafft']; nf-test files … |
| `nf-core:proteinfamilies@2.6.0` | output-equivalence | profiles ['test', 'test_full', 'test_merge', 'test_mgnifam', 'test_minimal', 'test_multi_sample_with_gz', 'test_update']; nf-test files 1, snapshots 1 with 50 … |
| `nf-core:proteinfold@2.0.0` | output-equivalence | profiles ['test', 'test_alphafold3_download', 'test_alphafold3_standard', 'test_alphafold_download', 'test_alphafold_split', 'test_boltz', 'test_colabfold_down… |
| `nf-core:references@0.1` | output-equivalence | profiles ['test', 'test_full']; nf-test files 10, snapshots 10 with 231 md5 entries; test data from ['raw.githubusercontent.com/nf-core/test-datasets']. Needs … |
| `nf-core:reportho@1.1.0` | output-equivalence | profiles ['test', 'test_fasta', 'test_full', 'test_offline']; nf-test files 2, snapshots 2 with 12 md5 entries; test data from ['eggnog5.embl.de', 'raw.githubu… |
| `nf-core:riboseq@2.0.0` | output-equivalence | profiles ['test', 'test_full']; nf-test files 14, snapshots 14 with 4137 md5 entries; test data from ['ftp.ensembl.org', 'raw.githubusercontent.com/nf-core/tes… |
| `nf-core:rnadnavar@1.0.0` | output-equivalence | profiles ['test', 'test_full']; nf-test files 5, snapshots 5 with 63 md5 entries; test data from ['github.com', 'raw.githubusercontent.com/nf-core/test-dataset… |
| `nf-core:rnafusion@4.1.3` | output-equivalence | profiles ['test', 'test_build', 'test_full']; nf-test files 3, snapshots 3 with 88 md5 entries; test data from ['github.com', 'raw.githubusercontent.com/nf-cor… |
| `nf-core:rnaseq@3.27.0` | output-equivalence | profiles ['test', 'test_full', 'test_prokaryotic']; nf-test files 19, snapshots 19 with 2778 md5 entries; test data from ['raw.githubusercontent.com/nf-core/te… |
| `nf-core:rnastructurome@1.0.0` | output-equivalence | profiles ['test', 'test_full', 'test_prokaryote', 'test_transcriptome']; nf-test files 4, snapshots 3 with 4 md5 entries; test data from []. Needs Nextflow + a… |
| `nf-core:rnavar@1.3.0` | output-equivalence | profiles ['test', 'test_full']; nf-test files 19, snapshots 19 with 384 md5 entries; test data from ['raw.githubusercontent.com/nf-core/test-datasets']. Needs … |
| `nf-core:sarek@3.10.0` | output-equivalence | profiles ['test', 'test_full', 'test_full_germline', 'test_full_germline_ncbench_agilent', 'test_mutect2']; nf-test files 61, snapshots 61 with 3542 md5 entrie… |
| `nf-core:scnanoseq@1.3.0` | output-equivalence | profiles ['test', 'test_full']; nf-test files 1, snapshots 1 with 55 md5 entries; test data from ['ftp.ebi.ac.uk', 'raw.githubusercontent.com/U-BDS/test-datase… |
| `nf-core:scrnaseq@4.2.0` | output-equivalence | profiles ['test', 'test_cellranger_multi', 'test_full']; nf-test files 6, snapshots 6 with 505 md5 entries; test data from ['ftp.ensembl.org', 'github.com', 'r… |
| `nf-core:seqsubmit@1.0.0` | output-equivalence | profiles ['test', 'test_assembly_complete_metadata', 'test_assembly_no_coverage_paired_reads', 'test_assembly_no_coverage_single_reads', 'test_assembly_no_stud… |
| `nf-core:smrnaseq@2.4.1` | output-equivalence | profiles ['test', 'test_contamination', 'test_contamination_tech_reps', 'test_full', 'test_full_filter_contamination', 'test_mirgenedb', 'test_nextflex', 'test… |
| `nf-core:spatialaxe@1.0.1` | output-equivalence | profiles ['test', 'test_full']; nf-test files 5, snapshots 5 with 200 md5 entries; test data from []. Needs Nextflow + a container engine (Docker/Singularity);… |
| `nf-core:stableexpression@v1.0.0` | output-equivalence | profiles ['test', 'test_accessions_only', 'test_dataset_eatlas', 'test_dataset_format', 'test_dataset_mus_musculus', 'test_datasets_dsim', 'test_full']; nf-tes… |
| `nf-core:taxprofiler@2.0.1` | output-equivalence | profiles ['test', 'test_alternativepreprocessing', 'test_falcobbduk', 'test_fastpnonpareilkrakenuniq', 'test_full', 'test_malt', 'test_minimal', 'test_motus'];… |
| `nf-core:variantbenchmarking@1.5.0` | output-equivalence | profiles ['test', 'test_full', 'test_full_somatic', 'test_full_sv']; nf-test files 4, snapshots 4 with 154 md5 entries; test data from []. Needs Nextflow + a c… |
| `nf-core:viralmetagenome@1.2.0` | output-equivalence | profiles ['test', 'test_fail_db', 'test_fail_mapped', 'test_full', 'test_group', 'test_minimal', 'test_umi']; nf-test files 7, snapshots 7 with 655 md5 entries… |
| `nf-core:viralrecon@3.0.0` | output-equivalence | profiles ['test', 'test_full', 'test_full_nanopore', 'test_nanopore', 'test_sispa']; nf-test files 6, snapshots 6 with 2497 md5 entries; test data from []. Nee… |
| `snakemake:SchlossLab/mikropml-snakemake-workflow@v1.3.0` | output-equivalence | 56 files under test dirs (40 data files), 12 generated unit tests (13 expected-output files); CI workflows running the test profile: ['tests.yml', 'run-snakema… |
| `snakemake:workflowhub/1900` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 10, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 0, tes… |
| `wdl:ENCODE-DCC/atac-seq-pipeline/atac.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 82, tes… |
| `wdl:ENCODE-DCC/chip-seq-pipeline2/chip.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 104, te… |
| `wdl:broadinstitute/warp/pipelines/wdl/arrays/imputation/Imputation.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 4, test… |
| `wdl:broadinstitute/warp/pipelines/wdl/arrays/imputation_beagle/ImputationBeagle.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 19, tes… |
| `wdl:broadinstitute/warp/pipelines/wdl/dna_seq/germline/joint_genotyping/reblocking/ReblockGVCF.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 2, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 34, tes… |
| `wdl:broadinstitute/warp/pipelines/wdl/dna_seq/germline/single_sample/exome/ExomeGermlineSingleSample.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 7, test… |
| `wdl:broadinstitute/warp/pipelines/wdl/dna_seq/germline/single_sample/ugwgs/UltimaGenomicsWholeGenomeGermline.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 2, test… |
| `wdl:broadinstitute/warp/pipelines/wdl/dna_seq/germline/single_sample/wgs/WholeGenomeGermlineSingleSample.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 11, tes… |
| `wdl:broadinstitute/warp/pipelines/wdl/glimpse/low_pass_imputation/Glimpse2LowPassImputation.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 18, tes… |
| `wdl:broadinstitute/warp/pipelines/wdl/reprocessing/cram_to_unmapped_bams/CramToUnmappedBams.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 8, test… |
| `wdl:broadinstitute/warp/pipelines/wdl/reprocessing/exome/ExomeReprocessing.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 1, test… |
| `wdl:broadinstitute/warp/pipelines/wdl/reprocessing/wgs/WholeGenomeReprocessing.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 1, test… |
| `wdl:broadinstitute/warp/pipelines/wdl/rna_seq/RNAWithUMIsPipeline.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 32, tes… |
| `wdl:broadinstitute/warp/pipelines/wdl/snm3C/snm3C.wdl` | output-equivalence | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 3, test… |
| `cwl:workflowhub/1760` | test-profile | repo listing: planemo tests 0, cwltest/test yml 1, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 0, test… |
| `cwl:workflowhub/1765` | test-profile | repo listing: planemo tests 0, cwltest/test yml 1, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 0, test… |
| `galaxy:iwc/Assembly-Hifi-HiC-phasing-VGP4/Assembly-Hifi-HiC-phasing-VGP4` | test-profile | planemo tests: 2 case(s), 24 checked outputs (0 vs reference files/checksums, 22 with content assertions); inputs from ['zenodo.org'] + local test-data/. Requi… |
| `galaxy:iwc/Assembly-Hifi-Trio-phasing-VGP5/Assembly-Hifi-Trio-phasing-VGP5` | test-profile | planemo tests: 1 case(s), 15 checked outputs (0 vs reference files/checksums, 14 with content assertions); inputs from ['zenodo.org'] + local test-data/. Requi… |
| `galaxy:iwc/Assembly-Hifi-only-VGP3/Assembly-Hifi-only-VGP3` | test-profile | planemo tests: 1 case(s), 12 checked outputs (0 vs reference files/checksums, 11 with content assertions); inputs from ['zenodo.org'] + local test-data/. Requi… |
| `galaxy:iwc/Mitogenome-assembly-VGP0/Mitogenome-Assembly-VGP0` | test-profile | planemo tests: 1 case(s), 4 checked outputs (0 vs reference files/checksums, 4 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `galaxy:iwc/Purge-duplicate-contigs-VGP6/Purge-duplicate-contigs-VGP6` | test-profile | planemo tests: 1 case(s), 12 checked outputs (0 vs reference files/checksums, 12 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/Purge-duplicates-one-haplotype-VGP6b/Purging-duplicates-one-haplotype-VGP6b` | test-profile | planemo tests: 1 case(s), 10 checked outputs (0 vs reference files/checksums, 10 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/Scaffolding-HiC-VGP8/Scaffolding-HiC-VGP8` | test-profile | planemo tests: 1 case(s), 16 checked outputs (0 vs reference files/checksums, 16 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/binning-evaluation/MAGs-binning-evaluation` | test-profile | planemo tests: 1 case(s), 4 checked outputs (0 vs reference files/checksums, 4 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `galaxy:iwc/clinicalmp-database-generation/iwc-clinicalmp-database-generation` | test-profile | planemo tests: 1 case(s), 4 checked outputs (0 vs reference files/checksums, 4 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `galaxy:iwc/clinicalmp-discovery/iwc-clinicalmp-discovery-workflow` | test-profile | planemo tests: 1 case(s), 1 checked outputs (0 vs reference files/checksums, 1 with content assertions); inputs from ['zenodo.org'] + local test-data/. Require… |
| `galaxy:iwc/cutandrun/cutandrun` | test-profile | planemo tests: 2 case(s), 13 checked outputs (0 vs reference files/checksums, 13 with content assertions); inputs from ['zenodo.org'] + local test-data/. Requi… |
| `galaxy:iwc/dna-seq-classification-lstm/dna-seq-classification-lstm` | test-profile | planemo tests: 2 case(s), 10 checked outputs (0 vs reference files/checksums, 10 with content assertions); inputs from [] + local test-data/. Requires a Galaxy… |
| `galaxy:iwc/giraffe-deep-variant-pangenome-calling/Pangenome-Variant-Calling-using-VG-Giraffe-and-Google-DeepVariant` | test-profile | planemo tests: 2 case(s), 11 checked outputs (0 vs reference files/checksums, 11 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/gromacs-mmgbsa/gromacs-mmgbsa` | test-profile | planemo tests: 1 case(s), 3 checked outputs (0 vs reference files/checksums, 3 with content assertions); inputs from [] + local test-data/. Requires a Galaxy s… |
| `galaxy:iwc/hi-c-contact-map-for-assembly-manual-curation/hi-c-map-for-assembly-manual-curation` | test-profile | planemo tests: 2 case(s), 23 checked outputs (0 vs reference files/checksums, 23 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/hyphy/capheine-core-and-compare` | test-profile | planemo tests: 4 case(s), 11 checked outputs (0 vs reference files/checksums, 11 with content assertions); inputs from [] + local test-data/. Requires a Galaxy… |
| `galaxy:iwc/influenza-isolates-consensus-and-subtyping/influenza-consensus-and-subtyping` | test-profile | planemo tests: 1 case(s), 6 checked outputs (0 vs reference files/checksums, 6 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `galaxy:iwc/kmer-profiling-hifi-VGP1/kmer-profiling-hifi-VGP1` | test-profile | planemo tests: 1 case(s), 9 checked outputs (0 vs reference files/checksums, 9 with content assertions); inputs from ['zenodo.org'] + local test-data/. Require… |
| `galaxy:iwc/lncRNAs-annotation/Galaxy-Workflow-lncRNAs_annotation_workflow` | test-profile | planemo tests: 1 case(s), 5 checked outputs (0 vs reference files/checksums, 5 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `galaxy:iwc/mags-building/MAGs-generation` | test-profile | planemo tests: 2 case(s), 15 checked outputs (0 vs reference files/checksums, 15 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/metagenomic-genes-catalogue/metagenomic-genes-catalogue` | test-profile | planemo tests: 1 case(s), 7 checked outputs (0 vs reference files/checksums, 7 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `galaxy:iwc/metagenomic-raw-reads-amr-analysis/metagenomic-raw-reads-amr-analysis` | test-profile | planemo tests: 1 case(s), 8 checked outputs (0 vs reference files/checksums, 8 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `galaxy:iwc/multiplex-tissue-microarray-analysis/multiplex-tma` | test-profile | planemo tests: 1 case(s), 13 checked outputs (0 vs reference files/checksums, 13 with content assertions); inputs from ['zenodo.org'] + local test-data/. Requi… |
| `galaxy:iwc/post-curation-processing/Post_Curation` | test-profile | planemo tests: 2 case(s), 24 checked outputs (0 vs reference files/checksums, 24 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server… |
| `galaxy:iwc/rnaseq-pe/rnaseq-pe` | test-profile | planemo tests: 1 case(s), 8 checked outputs (0 vs reference files/checksums, 8 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `galaxy:iwc/rnaseq-sr/rnaseq-sr` | test-profile | planemo tests: 1 case(s), 8 checked outputs (0 vs reference files/checksums, 8 with content assertions); inputs from ['zenodo.org']. Requires a Galaxy server w… |
| `nextflow:workflowhub/1871` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 3, test-input sets 0, test… |
| `nextflow:workflowhub/2239` | test-profile | repo listing: planemo tests 1, cwltest/test yml 1, job/param files 3, nf-test 32 (snapshots 30), Snakemake .test files 0, test configs 2, test-input sets 0, te… |
| `nextflow:workflowhub/2246` | test-profile | repo listing: planemo tests 1, cwltest/test yml 0, job/param files 1, nf-test 46 (snapshots 29), Snakemake .test files 0, test configs 2, test-input sets 0, te… |
| `nextflow:workflowhub/264` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 2, test-input sets 0, test… |
| `nextflow:workflowhub/444` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 2, test-input sets 0, test… |
| `nextflow:workflowhub/668` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 3, test-input sets 0, test… |
| `nextflow:workflowhub/683` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 1, test-input sets 0, test… |
| `nextflow:workflowhub/813` | test-profile | repo listing: planemo tests 1, cwltest/test yml 0, job/param files 3, nf-test 44 (snapshots 42), Snakemake .test files 0, test configs 2, test-input sets 0, te… |
| `nf-core:atacseq@2.1.2` | test-profile | profiles ['test', 'test_controls', 'test_full']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['raw.githubusercontent.com/nf-core/test-datas… |
| `nf-core:callingcards@1.0.0` | test-profile | profiles ['test', 'test_full', 'test_mammals']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['raw.githubusercontent.com/cmatKhan/test-datas… |
| `nf-core:chipseq@2.1.0` | test-profile | profiles ['test', 'test_full']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from []. Needs Nextflow + a container engine (Docker/Singularity); n… |
| `nf-core:circdna@1.1.0` | test-profile | profiles ['test', 'test_AA', 'test_AA_local', 'test_full']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['raw.githubusercontent.com/nf-core… |
| `nf-core:crisprseq@2.3.0` | test-profile | profiles ['test_screening', 'test_screening_count_table', 'test_screening_full', 'test_screening_paired', 'test_screening_rra', 'test_targeted', 'test_targeted… |
| `nf-core:cutandrun@3.2.2` | test-profile | profiles ['test', 'test_fasta_only', 'test_full', 'test_full_multi', 'test_full_small', 'test_full_small_local_zip', 'test_linear_dedup', 'test_local_zip']; nf… |
| `nf-core:diaproteomics@1.2.4` | test-profile | profiles ['test', 'test_full', 'test_no_align', 'test_no_merge', 'test_skip_processing', 'test_with_library', 'test_with_library_with_decoys', 'test_with_libra… |
| `nf-core:dualrnaseq@1.0.0` | test-profile | profiles ['test', 'test_full']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['github.com', 'nf-core-awsmegatests.s3-eu-west-1.amazonaws.com… |
| `nf-core:eager@2.5.3` | test-profile | profiles ['test', 'test_direct', 'test_full', 'test_resources', 'test_stresstest_human', 'test_tsv_bam', 'test_tsv_complex', 'test_tsv_fna']; nf-test files 0, … |
| `nf-core:hicar@1.0.0` | test-profile | profiles ['test', 'test_full', 'test_hichip', 'test_hipeak', 'test_multi']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['raw.githubusercon… |
| `nf-core:metaboigniter@2.0.1` | test-profile | profiles ['test', 'test_full']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['raw.githubusercontent.com/nf-core/test-datasets']. Needs Next… |
| `nf-core:multiplesequencealign@1.1.1` | test-profile | profiles ['test', 'test_conda', 'test_full', 'test_no_sheet', 'test_pdb', 'test_tiny']; nf-test files 1, snapshots 0 with 0 md5 entries; test data from []. Nee… |
| `nf-core:nanoseq@3.1.0` | test-profile | profiles ['test', 'test_full', 'test_nodx_noaln', 'test_nodx_rnamod', 'test_nodx_stringtie', 'test_nodx_vc']; nf-test files 0, snapshots 0 with 0 md5 entries; … |
| `nf-core:nascent@2.3.0` | test-profile | profiles ['test', 'test_copro', 'test_full', 'test_grocap']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['pints.yulab.org', 'raw.githubuse… |
| `nf-core:neutronstar@1.0.0` | test-profile | profiles ['test']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from []. Needs Nextflow + a container engine (Docker/Singularity); not run here (… |
| `nf-core:pangenome@1.1.3` | test-profile | profiles ['test', 'test_full']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['github.com']. Needs Nextflow + a container engine (Docker/Sin… |
| `nf-core:pathogensurveillance@1.1.0` | test-profile | profiles ['test', 'test_bacteria', 'test_bacteria_full', 'test_bordetella', 'test_bordetella_full', 'test_boxwood_blight', 'test_boxwood_blight_full', 'test_co… |
| `nf-core:phaseimpute@1.1.0` | test-profile | profiles ['test', 'test_all', 'test_all_fullchr', 'test_batch', 'test_beagle5', 'test_dog', 'test_full', 'test_glimpse2']; nf-test files 1, snapshots 1 with 0 … |
| `nf-core:pixelator@5.0.2` | test-profile | profiles ['test', 'test_full', 'test_proxiome_v1', 'test_proxiome_v2']; nf-test files 2, snapshots 2 with 0 md5 entries; test data from []. Needs Nextflow + a … |
| `nf-core:proteogenomicsdb@1.0.0` | test-profile | profiles ['test', 'test_full']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from []. Needs Nextflow + a container engine (Docker/Singularity); n… |
| `nf-core:quantms@1.2.0` | test-profile | profiles ['test_dia', 'test_full_dia', 'test_full_lfq', 'test_full_tmt', 'test_lfq', 'test_lfq_sage', 'test_localize', 'test_tmt']; nf-test files 0, snapshots … |
| `nf-core:raredisease@3.1.2` | test-profile | profiles ['test', 'test_bam', 'test_full', 'test_sentieon', 'test_singleton']; nf-test files 3, snapshots 3 with 0 md5 entries; test data from ['raw.githubuser… |
| `nf-core:rnasplice@1.0.4` | test-profile | profiles ['test', 'test_dexseq', 'test_edger', 'test_fastq', 'test_full', 'test_genome_bam', 'test_rmats', 'test_salmon_results']; nf-test files 0, snapshots 0… |
| `nf-core:slamseq@1.0.0` | test-profile | profiles ['test']; nf-test files 0, snapshots 0 with 0 md5 entries; test data from ['raw.githubusercontent.com/nf-core/test-datasets']. Needs Nextflow + a cont… |
| `nf-core:sopa@1.0.1` | test-profile | profiles ['test', 'test_baysor', 'test_baysor_multi_patches', 'test_cellpose', 'test_cellpose_CK_DAPI', 'test_cellpose_multi_patches', 'test_comseg', 'test_com… |
| `nf-core:tumourevo@1.0.0` | test-profile | profiles ['test', 'test_full']; nf-test files 2, snapshots 2 with 0 md5 entries; test data from ['raw.githubusercontent.com/nf-core/test-datasets']. Needs Next… |
| `snakemake:GuttmanLab/chipdip-pipeline@v3.0.0` | test-profile | 20 files under test dirs (16 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: []. Needs snakemake + conda/… |
| `snakemake:IKIM-Essen/RiboSnake@v0.11.0` | test-profile | 7 files under test dirs (2 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yaml']. Needs snakemake… |
| `snakemake:IKIM-Essen/uncovar@v1.1.1` | test-profile | 7 files under test dirs (2 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yml', 'release-please.y… |
| `snakemake:MPUSP/snakemake-crispr-guides@v1.7.2` | test-profile | 1 files under test dirs (0 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: []. Needs snakemake + conda/ap… |
| `snakemake:NCI-CGR/TriosCompass_v2@1.1.0` | test-profile | 9 files under test dirs (9 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yml']. Needs snakemake … |
| `snakemake:SarahSaadain/pastForward@v2.1.0` | test-profile | 10 files under test dirs (9 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['lint.yml']. Needs snakemake… |
| `snakemake:akcorut/kGWASflow@v1.3.0` | test-profile | 211 files under test dirs (205 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yaml']. Needs snake… |
| `snakemake:cbg-ethz/V-pipe@v3.0.0.pre1` | test-profile | 18 files under test dirs (11 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['run_regression_tests.yaml'… |
| `snakemake:daspacio9/pooledpremiumpcrpipeline2@v4.0.2` | test-profile | 11 files under test dirs (7 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yaml']. Needs snakemak… |
| `snakemake:friendsofstrandseq/mosaicatcher-pipeline@v2.5.1` | test-profile | 0 files under test dirs (0 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['assemblies.yaml', 'test-appt… |
| `snakemake:khanlab/SPIMprep@v0.1.0-alpha` | test-profile | 1 files under test dirs (1 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: []. Needs snakemake + conda/ap… |
| `snakemake:kircherlab/MPRAsnakeflow@v0.7.2` | test-profile | 5 files under test dirs (2 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yml']. Needs snakemake … |
| `snakemake:magwenelab/WeavePop@v1.0.0` | test-profile | 15 files under test dirs (8 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: []. Needs snakemake + conda/a… |
| `snakemake:moiexpositoalonsolab/grenepipe@v0.15.0` | test-profile | 53 files under test dirs (2 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['ci.yaml']. Needs snakemake … |
| `snakemake:niekwit/cut_and_run@v0.5.0` | test-profile | 13 files under test dirs (11 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yml']. Needs snakemak… |
| `snakemake:niekwit/damid-seq@v0.7.0` | test-profile | 0 files under test dirs (0 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yml']. Needs snakemake … |
| `snakemake:nismod/open-gira@v0.4.2` | test-profile | 211 files under test dirs (192 data files), 0 generated unit tests (66 expected-output files); CI workflows running the test profile: []. Needs snakemake + con… |
| `snakemake:snakemake-workflows/dna-seq-gatk-variant-calling@v2.1.1` | test-profile | 7 files under test dirs (4 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yml']. Needs snakemake … |
| `snakemake:snakemake-workflows/dna-seq-varlociraptor@v6.10.1` | test-profile | 47 files under test dirs (12 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['benchmark-giab.yml', 'main… |
| `snakemake:snakemake-workflows/rna-seq-kallisto-sleuth@v4.1.0` | test-profile | 13 files under test dirs (3 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yml']. Needs snakemake… |
| `snakemake:usnistgov/defrabb` | test-profile | 37 files under test dirs (37 data files), 26 generated unit tests (0 expected-output files); CI workflows running the test profile: []. Needs snakemake + conda… |
| `snakemake:workflowhub/1091` | test-profile | repo listing: planemo tests 0, cwltest/test yml 2, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 0, test… |
| `snakemake:workflowhub/1729` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 28, test configs 0, test-input sets 0, tes… |
| `snakemake:workflowhub/1759` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 47, test configs 0, test-input sets 0, tes… |
| `snakemake:workflowhub/2222` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 18, test configs 0, test-input sets 0, tes… |
| `snakemake:ylab-hi/ScanNeo2@v0.7.0` | test-profile | 42 files under test dirs (18 data files), 12 generated unit tests (0 expected-output files); CI workflows running the test profile: ['linting.yml']. Needs snak… |
| `snakemake:zavolanlab/mirflowz@v0.10.0` | test-profile | 19 files under test dirs (14 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: []. Needs snakemake + conda/… |
| `snakemake:zjnolen/PopGLen@v0.4.4` | test-profile | 22 files under test dirs (18 data files), 0 generated unit tests (0 expected-output files); CI workflows running the test profile: ['main.yaml']. Needs snakema… |
| `wdl:broadinstitute/warp/beta-pipelines/broad/somatic/single_sample/targeted/TargetedSomaticSingleSample.wdl` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 0, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 6, test… |
| `wdl:broadinstitute/warp/pipelines/wdl/glimpse/low_pass_imputation/Glimpse2LowPassImputationBatch.wdl` | test-profile | repo listing: planemo tests 0, cwltest/test yml 0, job/param files 1, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 18, tes… |
| `wdl:github.com/hall-lab/sv-pipeline/sv-merge1:master` | test-profile | Dockstore TRS TEST_FILE parameter JSON(s): 1 listed, 1 retrieved; 1 reference gs:// / s3:// / drs:// inputs (need cloud credentials/egress). Input fixtures onl… |
| `wdl:github.com/hall-lab/sv-pipeline/sv-postmerge:master` | test-profile | Dockstore TRS TEST_FILE parameter JSON(s): 1 listed, 1 retrieved; 1 reference gs:// / s3:// / drs:// inputs (need cloud credentials/egress). Input fixtures onl… |
| `wdl:github.com/vgteam/vg_wdl/GiraffeDeepTrio:giraffe-dv-dt-hprcy1` | test-profile | Dockstore TRS TEST_FILE parameter JSON(s): 1 listed, 1 retrieved; 1 reference gs:// / s3:// / drs:// inputs (need cloud credentials/egress). Input fixtures onl… |
| `wdl:workflowhub/409` | test-profile | repo listing: planemo tests 0, cwltest/test yml 9, job/param files 13, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 0, tes… |
| `wdl:workflowhub/410` | test-profile | repo listing: planemo tests 0, cwltest/test yml 9, job/param files 13, nf-test 0 (snapshots 0), Snakemake .test files 0, test configs 0, test-input sets 0, tes… |

</details>

## Sources tried

### A. nf-core (nf-co.re pipelines JSON API + GitHub clones)

Index `https://nf-co.re/pipelines.json` retrieved 2026-10-06 (sha256 `67fcea3ed7d14bd0dc7aec5ac204b5329d804de13a5bb4234165181e06b67682`): 157 pipelines, 107 with at least one release. Every released pipeline was cloned (shallow, blob-filtered, sparse: `*.nf`, `*.config`, `nextflow_schema.json`, `conf/`, `tests/`, `workflows/`, `subworkflows/`, `modules/local/`, `modules.json`, LICENSE) at the latest release tag via the session git proxy. Licence: the LICENSE file of each clone (MIT for every pipeline; nf-core org policy is MIT). Redistributable: yes. Pipelines without a release (dev-only) were not acquired. Graph: static DSL2 analysis with nf-core modules resolved from `modules.json` names, sub-workflows inlined, parameters counted from `nextflow_schema.json`.

| pipeline | tag | commit | published | nodes/edges | test profiles | nf-test (snapshots, md5s) | selected |
| --- | --- | --- | --- | --- | --- | --- | --- |
| airrflow | 5.1.1 | 8bc3e567d0bb | 2026-08-28 | 113/295 | 24 | 19 (19, 507) | yes |
| ampliseq | 2.18.0 | 2723d4c298d4 | 2026-06-17 | 184/1143 | 17 | 16 (16, 250) | yes |
| atacseq | 2.1.2 | 1a1dbe52ffbd | 2023-08-07 | 109/286 | 3 | 0 (0, 0) | yes |
| bacass | 2.6.0 | 61b9413bc053 | 2026-05-05 | 60/316 | 14 | 14 (14, 337) | yes |
| bactmap | 1.0.0 | 834642d8ac15 | 2021-06-18 | 28/37 | 2 | 0 (0, 0) | no |
| bamtofastq | 2.2.1 | 8a295860c0c9 | 2026-05-13 | 29/69 | 2 | 9 (9, 110) | no |
| cageseq | 1.0.2 | 838d2a5165ed | 2021-01-14 | 23/54 | 2 | 0 (0, 0) | no |
| callingcards | 1.0.0 | 20b66e785a82 | 2024-05-24 | 64/167 | 3 | 0 (0, 0) | yes |
| chipseq | 2.1.0 | 76e2382b6d44 | 2024-10-07 | 91/230 | 2 | 0 (0, 0) | yes |
| circdna | 1.1.0 | 8e0e14c84f90 | 2024-02-10 | 41/99 | 4 | 0 (0, 0) | yes |
| clipseq | 1.0.0 | 45ae3c0b9b16 | 2021-04-27 | 30/59 | 2 | 0 (0, 0) | no |
| coproid | 2.0.1 | 045d569d5b01 | 2026-02-17 | 31/45 | 2 | 1 (1, 0) | no |
| createpanelrefs | 1.0.0 | 8ce86a84b5af | 2026-06-08 | 44/84 | 2 | 4 (4, 58) | yes |
| createtaxdb | 3.1.0 | b01a0f8ed96a | 2026-07-03 | 35/72 | 4 | 3 (3, 26) | yes |
| crisprseq | 2.3.0 | 0e9f915c4a3c | 2024-11-08 | 69/153 | 8 | 0 (0, 0) | yes |
| cutandrun | 3.2.2 | 6e1125d4fee4 | 2024-02-01 | 129/408 | 11 | 0 (0, 0) | yes |
| datasync | 1.0.1 | d652a3cac0ba | 2026-10-05 | 9/11 | 3 | 3 (3, 89) | no |
| deepvariant | 1.0 | 2b5486356c4d | 2018-11-19 | 10/13 | 1 | 0 (0, 0) | no |
| demo | 1.2.0 | 32893afef807 | 2026-06-24 | 8/7 | 2 | 1 (1, 20) | no |
| demultiplex | 1.8.0 | daade37c4a75 | 2026-09-15 | 31/95 | 15 | 18 (15, 1755) | no |
| denovotranscript | 1.2.1 | 9ab0f57785c3 | 2025-08-28 | 24/46 | 2 | 0 (0, 0) | no |
| detaxizer | 1.3.0 | 3586921aa3a4 | 2025-11-14 | 33/95 | 4 | 3 (3, 48) | no |
| diaproteomics | 1.2.4 | 58b18dd02583 | 2021-04-29 | 22/27 | 9 | 0 (0, 0) | yes |
| differentialabundance | 2.0.0 | 30ed7741fc39 | 2026-06-23 | 52/123 | 2 | 10 (10, 602) | yes |
| drop | 1.0.0 | 20388350d242 | 2026-04-02 | 73/117 | 2 | 3 (3, 165) | yes |
| drugresponseeval | 1.2.2 | 84cb752a7ca4 | 2026-06-23 | 29/47 | 2 | 1 (1, 9) | no |
| dualrnaseq | 1.0.0 | d8dcd8acfa6f | 2021-02-14 | 123/240 | 2 | 0 (0, 0) | yes |
| eager | 2.5.3 | 3f9d64ced5e2 | 2025-03-18 | 65/380 | 11 | 0 (0, 0) | yes |
| epitopeprediction | 3.1.1 | 48f2eaaeb9b2 | 2026-08-07 | 27/43 | 11 | 8 (8, 76) | yes |
| fastqrepair | 1.1.1 | 70a38209407b | 2026-08-31 | 11/9 | 2 | 2 (2, 20) | no |
| fastquorum | 2.0.0 | 074b201d8ca6 | 2026-06-23 | 23/34 | 4 | 12 (9, 64) | no |
| fetchngs | 1.13.0 | 955c892d8092 | 2026-09-15 | 14/18 | 2 | 1 (1, 42) | no |
| funcprofiler | 1.0.0 | 805e23e866b9 | 2026-09-21 | 27/111 | 2 | 1 (1, 32) | yes |
| funcscan | 4.0.0 | aee3dc965eb0 | 2026-06-27 | 179/285 | 15 | 14 (13, 202) | yes |
| genomeassembler | 2.0.0 | a72d47d9cdb5 | 2026-09-18 | 191/405 | 8 | 1 (1, 439) | yes |
| genomeqc | 1.0.1 | bce44e5b558e | 2026-09-16 | 68/207 | 8 | 3 (3, 162) | yes |
| hadge | 1.0.0 | 921d3780498d | 2026-09-29 | 67/389 | 5 | 4 (4, 768) | yes |
| hgtseq | 1.1.0 | 683daaf41bb3 | 2023-05-16 | 44/65 | 3 | 0 (0, 0) | no |
| hic | 2.1.0 | fe4ac656317d | 2023-06-01 | 30/41 | 2 | 0 (0, 0) | no |
| hicar | 1.0.0 | 429087d2b13e | 2022-05-03 | 110/259 | 5 | 0 (0, 0) | yes |
| hlatyping | 2.2.0 | 3237d20e7e61 | 2026-02-02 | 17/28 | 8 | 7 (7, 1407) | no |
| imcyto | 1.0.0 | 5d6631332b43 | 2020-05-29 | 8/12 | 4 | 0 (0, 0) | no |
| isoseq | 3.0.1 | 6c944831289d | 2026-09-23 | 26/36 | 14 | 13 (13, 2255) | no |
| kmermaid | 0.1.0-alpha | e1f736c5c694 | 2020-10-27 | 21/41 | 9 | 0 (0, 0) | no |
| longraredisease | 1.0.0 | f40870fcbcf2 | 2026-06-26 | 93/356 | 4 | 2 (1, 45) | yes |
| lsmquant | 1.0.3 | b39ec6e1fb26 | 2026-08-10 | 22/56 | 2 | 1 (1, 187) | no |
| mag | 5.5.0 | 56abab5b023c | 2026-08-01 | 161/851 | 9 | 8 (8, 1962) | yes |
| magmap | 1.2.0 | 20c6dda92b52 | 2026-08-11 | 46/56 | 9 | 8 (8, 240) | yes |
| marsseq | 1.0.3 | b02ede773092 | 2023-07-18 | 28/45 | 2 | 0 (0, 0) | no |
| mcmicro | 2.0.0 | f44000015786 | 2026-07-02 | 29/136 | 2 | 3 (3, 33) | no |
| metaboigniter | 2.0.1 | 55d82547604f | 2024-04-15 | 63/184 | 2 | 0 (0, 0) | yes |
| metapep | 1.0.0 | 84feafc94769 | 2024-11-22 | 31/62 | 14 | 13 (13, 204) | no |
| metatdenovo | 1.4.1 | 113adb3c3e5d | 2026-09-15 | 70/206 | 10 | 5 (5, 5) | yes |
| methylong | 2.0.0 | 3513e80df682 | 2025-11-21 | 149/535 | 6 | 1 (1, 16) | yes |
| methylseq | 4.2.0 | 5aa56467a85a | 2025-12-12 | 65/201 | 4 | 8 (8, 2002) | yes |
| mhcquant | 3.3.0 | a4b6d51803af | 2026-10-02 | 57/154 | 9 | 7 (7, 4) | yes |
| mnaseseq | 1.0.0 | eb5ea5c9b122 | 2022-05-25 | 31/59 | 1 | 0 (0, 0) | no |
| molkart | 1.2.0 | 4ec0790d80cf | 2025-10-27 | 23/55 | 2 | 2 (2, 70) | no |
| multiplesequencealign | 1.1.1 | 79724dac3d24 | 2025-05-27 | 79/287 | 6 | 1 (0, 0) | yes |
| nanoseq | 3.1.0 | 6e563e54362c | 2023-03-10 | 55/186 | 6 | 0 (0, 0) | yes |
| nanostring | 1.3.3 | 6f0b2d537a1f | 2026-01-30 | 11/14 | 4 | 4 (4, 38) | yes |
| nascent | 2.3.0 | 7d4fe6197501 | 2025-05-08 | 103/591 | 4 | 0 (0, 0) | yes |
| neutronstar | 1.0.0 | 71f6e3f0377d | 2019-12-12 | 10/12 | 1 | 0 (0, 0) | yes |
| oncoanalyser | 3.0.0 | 7c74c87a4374 | 2026-09-01 | 348/2039 | 3 | 2 (2, 254) | yes |
| pacvar | 1.1.0 | 203648302371 | 2026-06-24 | 43/92 | 9 | 4 (4, 5) | yes |
| pairgenomealign | 3.0.4 | 8ee09a1cdc92 | 2026-08-26 | 39/123 | 4 | 1 (1, 24) | yes |
| pangenome | 1.1.3 | 3d02bd1df79f | 2025-02-09 | 70/134 | 2 | 0 (0, 0) | yes |
| pathogensurveillance | 1.1.0 | 13547eaa7345 | 2026-02-13 | 66/290 | 21 | 1 (1, 0) | yes |
| phaseimpute | 1.1.0 | 452783d960eb | 2025-12-01 | 120/408 | 15 | 1 (1, 0) | yes |
| phyloplace | 2.3.0 | 68db179c0f03 | 2026-09-23 | 36/75 | 12 | 11 (10, 177) | yes |
| pixelator | 5.0.2 | 751307268d51 | 2026-09-11 | 30/48 | 4 | 2 (2, 0) | yes |
| proteinannotator | 1.1.0 | cbf78d471f62 | 2026-05-07 | 22/27 | 2 | 1 (1, 49) | no |
| proteinfamilies | 2.6.0 | 318acd54eb9c | 2026-10-01 | 103/255 | 7 | 1 (1, 50) | yes |
| proteinfold | 2.0.0 | 5338c24b2af6 | 2026-03-27 | 285/632 | 26 | 13 (13, 201) | yes |
| proteogenomicsdb | 1.0.0 | 4eda7a827f83 | 2021-04-27 | 28/35 | 2 | 0 (0, 0) | yes |
| proteomicslfq | 1.0.0 | 43c77e50c955 | 2020-10-19 | 24/35 | 4 | 0 (0, 0) | no |
| quantms | 1.2.0 | fa34d79f5071 | 2023-11-02 | 67/140 | 8 | 0 (0, 0) | yes |
| rangeland | 1.0.0 | 7c5cb9593b80 | 2025-01-17 | 22/30 | 2 | 3 (2, 0) | no |
| raredisease | 3.1.2 | 83f2699d28bc | 2026-07-06 | 315/730 | 5 | 3 (3, 0) | yes |
| readsimulator | 1.0.1 | 0e8805ddbcd0 | 2024-04-26 | 22/38 | 3 | 0 (0, 0) | no |
| references | 0.1 | 3ab25b0cdadc | 2024-12-30 | 41/108 | 2 | 10 (10, 231) | yes |
| reportho | 1.1.0 | 9e8ae5a07ddb | 2025-10-21 | 48/97 | 4 | 2 (2, 12) | yes |
| ribomsqc | 1.0.0 | 79916e8dea42 | 2026-03-13 | 9/8 | 2 | 1 (1, 6) | no |
| riboseq | 2.0.0 | 11d66a3b8ae1 | 2026-09-15 | 308/1403 | 2 | 14 (14, 4137) | yes |
| rnadnavar | 1.0.0 | 8e8debdb0e72 | 2026-06-29 | 244/901 | 2 | 5 (5, 63) | yes |
| rnafusion | 4.1.3 | 76ad76e7c39b | 2026-06-02 | 56/167 | 3 | 3 (3, 88) | yes |
| rnaseq | 3.27.0 | a1fcdddd3b82 | 2026-09-23 | 191/990 | 3 | 19 (19, 2778) | yes |
| rnasplice | 1.0.4 | 1d0494ae3402 | 2024-05-09 | 113/306 | 10 | 0 (0, 0) | yes |
| rnastructurome | 1.0.0 | 959113050df9 | 2026-09-08 | 112/262 | 4 | 4 (3, 4) | yes |
| rnavar | 1.3.0 | a0e4641409eb | 2026-06-03 | 68/171 | 2 | 19 (19, 384) | yes |
| sarek | 3.10.0 | 8ccac7ad37b0 | 2026-08-12 | 396/1837 | 5 | 61 (61, 3542) | yes |
| scnanoseq | 1.3.0 | 83d55ea87eb6 | 2026-06-26 | 126/391 | 2 | 1 (1, 55) | yes |
| scrnaseq | 4.2.0 | 3fc17b4f971a | 2026-07-04 | 37/92 | 3 | 6 (6, 505) | yes |
| seqinspector | 1.1.2 | 6aa08aabb00c | 2026-08-19 | 34/100 | 2 | 21 (21, 1754) | no |
| seqsubmit | 1.0.0 | 717fd19e7a40 | 2026-08-04 | 55/107 | 9 | 14 (14, 51) | yes |
| slamseq | 1.0.0 | 855583252166 | 2020-05-14 | 19/46 | 1 | 0 (0, 0) | yes |
| smrnaseq | 2.4.1 | cb0af579b24c | 2026-01-07 | 89/259 | 10 | 6 (6, 628) | yes |
| sopa | 1.0.1 | 0b959963a398 | 2026-08-25 | 27/52 | 9 | 3 (3, 0) | yes |
| spatialaxe | 1.0.1 | 748d310ac019 | 2026-08-06 | 76/202 | 2 | 5 (5, 200) | yes |
| stableexpression | v1.0.0 | f0313431db96 | 2026-09-22 | 40/66 | 7 | 26 (26, 514) | yes |
| taxprofiler | 2.0.1 | 70ecc15e49b4 | 2026-06-15 | 114/337 | 9 | 8 (8, 130) | yes |
| tumourevo | 1.0.0 | 180ae5447d0e | 2026-10-02 | 56/109 | 2 | 2 (2, 0) | yes |
| variantbenchmarking | 1.5.0 | 8b21c01749c4 | 2026-04-22 | 135/962 | 4 | 4 (4, 154) | yes |
| variantprioritization | 1.0.0 | 8ba629c53dbd | 2026-04-09 | 20/29 | 2 | 4 (4, 74) | no |
| viralintegration | 0.1.1 | 70e558aaff83 | 2023-07-19 | 23/38 | 2 | 2 (1, 8) | no |
| viralmetagenome | 1.2.0 | 74064a43f4b0 | 2026-09-16 | 345/2821 | 7 | 7 (7, 655) | yes |
| viralrecon | 3.0.0 | 395079f1d24d | 2025-10-28 | 163/517 | 5 | 6 (6, 2497) | yes |

### B. Galaxy IWC (Intergalactic Workflow Commission)

`git clone --depth 1 --filter=blob:limit=1m --no-recurse-submodules https://github.com/galaxyproject/iwc` at commit `fc190a435262bb61ba29f316e987aa492eb5d18b` (2026-10-01). Every `workflows/**/*.ga` is one candidate. Licence: the per-workflow `license` field of the `.ga` (SPDX); copyleft (GPL/AGPL) workflows keep graph features only. Oracle: sibling planemo `-tests.yml`. Converted 126; licences: MIT 89, CC-BY-4.0 19, GPL-3.0-or-later 9, Apache-2.0 5, AGPL-3.0-or-later 2, BSD-3-Clause 1, unknown 1; oracles: test-profile 75, output-equivalence 49, none 2; selected 35.

### C. WorkflowHub (workflowhub.eu API, per-workflow licences)

`GET https://workflowhub.eu/workflows.json` and `/workflows/<id>.json` for all 1581 public workflow records (2026-10-06). Candidates (420): every CWL, Snakemake, WDL and non-nf-core Nextflow entry plus the 90 largest Galaxy entries that are not IWC copies. Files: git-backed versions -> shallow sparse clone of the registered remote at the registered commit; otherwise the version's RO-Crate (25 MB cap, only workflow-definition files unpacked, zip-slip guarded); WorkflowHub-hosted git -> per-file git API. Licence: the record's submitter-declared `license` attribute (per workflow; `other-open` -> `LicenseRef-WorkflowHub-other-open`, treated as non-redistributable). Entries duplicating a directly acquired source were skipped.

- file acquisition outcomes (via/status): crate/ok 222, git/ok 173, workflowhub-git/ok 16, crate/too-large 5, workflowhub-git/no-files-via-git-api 2, git/git-error 2
- converter skips (91): main workflow file not found 39, parse failed 18, trivial graph 16, too-large 5, duplicate of directly acquired ebi-metagenomics/pipeline-v5 3, no-files-via-git-api 2, duplicate of directly acquired snakemake-workflows/dna-seq-varlociraptor 2, git-error 2, duplicate of directly acquired ikim-essen/ribosnake 1, duplicate of directly acquired zavolanlab/zarp 1, duplicate of directly acquired cbg-ethz/v-pipe 1, duplicate of directly acquired ihggm-aachen/cnvand 1
- converted 329: cwl 102, galaxy 89, nextflow 86, snakemake 49, wdl 3; licences MIT 103, Apache-2.0 91, CC-BY-4.0 75, GPL-3.0 31, CC0-1.0 5, Artistic-2.0 3, CC-BY-NC-ND-4.0 2, AGPL-3.0 2, LGPL-3.0 2, BSD-3-Clause 2, LicenseRef-WorkflowHub-other-open 2, CC-BY-NC-SA-4.0 2, CC-BY-NC-4.0 2, AGPL-3.0-or-later 2, BSD-2-Clause 1, GPL-3.0-or-later 1, unknown 1, CECILL-2.1 1, AFL-3.0 1

<details><summary>Selected WorkflowHub items</summary>

| item | licence | revision | oracle |
| --- | --- | --- | --- |
| `cwl:workflowhub/107` | Apache-2.0 | WorkflowHub workflow 107 version 1; RO-Crate download | none |
| `cwl:workflowhub/1760` | Apache-2.0 | WorkflowHub workflow 1760 version 1; git https://github.com/CompEpigen/ATACseq_workflows @ f6ad72e6aadbdb831921f3af81cd… | test-profile |
| `cwl:workflowhub/1765` | Apache-2.0 | WorkflowHub workflow 1765 version 1; git https://github.com/CompEpigen/ChIPseq_workflows @ 7b935a043840cccd92d7f02eaa89… | test-profile |
| `cwl:workflowhub/1868` | Apache-2.0 | WorkflowHub workflow 1868 version 2; RO-Crate download | none |
| `cwl:workflowhub/2013` | Apache-2.0 | WorkflowHub workflow 2013 version 1; RO-Crate download | none |
| `cwl:workflowhub/2216` | CC-BY-4.0 | WorkflowHub workflow 2216 version 1; RO-Crate download | none |
| `cwl:workflowhub/254` | Apache-2.0 | WorkflowHub workflow 254 version 3; RO-Crate download | none |
| `cwl:workflowhub/278` | Apache-2.0 | WorkflowHub workflow 278 version 11; git https://gitlab.bsc.es/lrodrig1/structuralvariants_poc.git @ 93fbc4e51770d953fc… | none |
| `cwl:workflowhub/289` | Apache-2.0 | WorkflowHub workflow 289 version 3; RO-Crate download | none |
| `cwl:workflowhub/334` | BSD-3-Clause | WorkflowHub workflow 334 version 1; git https://github.com/vetscience/Assemblosis.git @ c498607f21124d2f3787a21c0d55437… | none |
| `cwl:workflowhub/336` | Apache-2.0 | WorkflowHub workflow 336 version 2; RO-Crate download | none |
| `cwl:workflowhub/344` | Apache-2.0 | WorkflowHub workflow 344 version 1; RO-Crate download | none |
| `cwl:workflowhub/367` | Apache-2.0 | WorkflowHub workflow 367 version 3; RO-Crate download | none |
| `cwl:workflowhub/390` | MIT | WorkflowHub workflow 390 version 2; git https://github.com/HrishiDhondge/CroMaSt.git @ b5a9d4b025ec8e065bae97eeb96f10db… | none |
| `cwl:workflowhub/488` | LicenseRef-WorkflowHub-other-open | WorkflowHub workflow 488 version 3; RO-Crate download | none |
| `cwl:workflowhub/524` | MIT | WorkflowHub workflow 524 version 1; RO-Crate download | none |
| `cwl:workflowhub/525` | MIT | WorkflowHub workflow 525 version 1; RO-Crate download | none |
| `cwl:workflowhub/526` | MIT | WorkflowHub workflow 526 version 1; RO-Crate download | none |
| `cwl:workflowhub/527` | MIT | WorkflowHub workflow 527 version 1; RO-Crate download | none |
| `cwl:workflowhub/549` | Apache-2.0 | WorkflowHub workflow 549 version 2; RO-Crate download | none |
| `cwl:workflowhub/63` | Apache-2.0 | WorkflowHub workflow 63 version 1; RO-Crate download | none |
| `cwl:workflowhub/64` | Apache-2.0 | WorkflowHub workflow 64 version 12; RO-Crate download | none |
| `galaxy:workflowhub/1103` | MIT | WorkflowHub workflow 1103 version 3; RO-Crate download | none |
| `galaxy:workflowhub/1104` | MIT | WorkflowHub workflow 1104 version 2; RO-Crate download | none |
| `galaxy:workflowhub/1189` | MIT | WorkflowHub workflow 1189 version 2; RO-Crate download | none |
| `galaxy:workflowhub/1356` | CC-BY-4.0 | WorkflowHub workflow 1356 version 1; RO-Crate download | none |
| `galaxy:workflowhub/1465` | CC-BY-4.0 | WorkflowHub workflow 1465 version 1; RO-Crate download | none |
| `galaxy:workflowhub/1469` | MIT | WorkflowHub workflow 1469 version 1; RO-Crate download | none |
| `galaxy:workflowhub/1562` | MIT | WorkflowHub workflow 1562 version 2; RO-Crate download | none |
| `galaxy:workflowhub/1601` | CC-BY-4.0 | WorkflowHub workflow 1601 version 1; RO-Crate download | none |
| `galaxy:workflowhub/1606` | CC-BY-4.0 | WorkflowHub workflow 1606 version 2; RO-Crate download | none |
| `galaxy:workflowhub/1607` | CC-BY-4.0 | WorkflowHub workflow 1607 version 1; RO-Crate download | none |
| `galaxy:workflowhub/1685` | CC-BY-4.0 | WorkflowHub workflow 1685 version 1; RO-Crate download | none |
| `galaxy:workflowhub/1688` | MIT | WorkflowHub workflow 1688 version 1; RO-Crate download | none |
| `galaxy:workflowhub/1717` | CC-BY-4.0 | WorkflowHub workflow 1717 version 2; RO-Crate download | none |
| `galaxy:workflowhub/2038` | MIT | WorkflowHub workflow 2038 version 1; RO-Crate download | none |
| `galaxy:workflowhub/2174` | MIT | WorkflowHub workflow 2174 version 6; RO-Crate download | none |
| `galaxy:workflowhub/2304` | Artistic-2.0 | WorkflowHub workflow 2304 version 1; RO-Crate download | none |
| `galaxy:workflowhub/251` | Apache-2.0 | WorkflowHub workflow 251 version 1; RO-Crate download | none |
| `galaxy:workflowhub/472` | CC-BY-NC-4.0 | WorkflowHub workflow 472 version 4; RO-Crate download | none |
| `galaxy:workflowhub/482` | CC-BY-NC-4.0 | WorkflowHub workflow 482 version 7; RO-Crate download | none |
| `galaxy:workflowhub/490` | LicenseRef-WorkflowHub-other-open | WorkflowHub workflow 490 version 1; RO-Crate download | none |
| `galaxy:workflowhub/607` | MIT | WorkflowHub workflow 607 version 1; RO-Crate download | none |
| `galaxy:workflowhub/628` | GPL-3.0 | WorkflowHub workflow 628 version 1; RO-Crate download | none |
| `galaxy:workflowhub/629` | GPL-3.0 | WorkflowHub workflow 629 version 1; RO-Crate download | none |
| `galaxy:workflowhub/794` | GPL-3.0 | WorkflowHub workflow 794 version 2; RO-Crate download | none |
| `galaxy:workflowhub/880` | GPL-3.0 | WorkflowHub workflow 880 version 2; RO-Crate download | none |
| `nextflow:workflowhub/1030` | MIT | WorkflowHub workflow 1030 version 3; git https://github.com/EGA-archive/sarek-IMPaCT-data-QC.git @ 81c1fc9a0688f6696e02… | output-equivalence |
| `nextflow:workflowhub/1058` | MIT | WorkflowHub workflow 1058 version 1; git https://github.com/Plant-Food-Research-Open/assemblyqc @ 690e56b3d349ee32754c9… | output-equivalence |
| `nextflow:workflowhub/106` | Apache-2.0 | WorkflowHub workflow 106 version 3; RO-Crate download | none |
| `nextflow:workflowhub/140` | GPL-3.0 | WorkflowHub workflow 140 version 1; RO-Crate download | none |
| `nextflow:workflowhub/1862` | MIT | WorkflowHub workflow 1862 version 5; git https://github.com/CIBERER/nf-CBRA-snvs @ 25ed63c014cfc79a885456f90621b55efd52… | output-equivalence |
| `nextflow:workflowhub/1864` | CC-BY-4.0 | WorkflowHub workflow 1864 version 1; git https://github.com/TBLabFJD/PARROT-FJD @ fc760a0b9594ef6d1095aff722c8981876dd4… | none |
| `nextflow:workflowhub/1865` | MIT | WorkflowHub workflow 1865 version 1; git https://github.com/TBLabFJD/WHALE @ 1036e1d733271f7de2efa4cc9c5271b712554e3d | output-equivalence |
| `nextflow:workflowhub/1871` | MIT | WorkflowHub workflow 1871 version 1; git https://github.com/takudzwa-coder/chipimputation.git @ 8804b7e6d6d7941729ea1d3… | test-profile |
| `nextflow:workflowhub/1960` | GPL-3.0-or-later | WorkflowHub workflow 1960 version 1; git https://github.com/ZiemertLab/soil-metagenome-pipeline @ b8f617be30cd86ef92d18… | none |
| `nextflow:workflowhub/2080` | Apache-2.0 | WorkflowHub workflow 2080 version 1; git https://github.com/quadram-institute-bioscience/ARG-Sniper @ 9d04754762d3b20e4… | none |
| `nextflow:workflowhub/2105` | MIT | WorkflowHub workflow 2105 version 1; git https://github.com/CCBR/CHAMPAGNE/ @ cca7964af5535f60457ad0d53d87dcdfe485fd65 | output-equivalence |
| `nextflow:workflowhub/2197` | MIT | WorkflowHub workflow 2197 version 2; git https://github.com/EMBL-Hentze-group/CLIPseq-workflow.git @ 06fae5d5e704396b25… | none |
| `nextflow:workflowhub/2217` | MIT | WorkflowHub workflow 2217 version 2; git https://github.com/rodtheo/nf-core-assemblyeval.git @ 7014a2508e38da9fa7953de4… | output-equivalence |
| `nextflow:workflowhub/2239` | MIT | WorkflowHub workflow 2239 version 1; git https://github.com/sanger-tol/ascc.git @ 8e3d2a9dfe42ac761ec94ff37a647fb353045… | test-profile |
| `nextflow:workflowhub/2246` | MIT | WorkflowHub workflow 2246 version 1; git https://github.com/RBGKew/fspassemblypipeline @ 23408c6f9b4a22e83b9a5b73b530b4… | test-profile |
| `nextflow:workflowhub/264` | MIT | WorkflowHub workflow 264 version 1; git https://github.com/vibbits/rnaseq-editing.git @ 6b921d669763d985b62aeb977d2cf99… | test-profile |
| `nextflow:workflowhub/418` | MIT | WorkflowHub workflow 418 version 1; git https://github.com/TRON-Bioinformatics/tronflow-alignment @ 381164605ba2663a3a0… | none |
| `nextflow:workflowhub/438` | CC-BY-4.0 | WorkflowHub workflow 438 version 1; git https://github.com/biocorecrg/MOP2.git @ e6eabb3b20445edcd604fa71041f4b6a11799c… | none |
| `nextflow:workflowhub/444` | MIT | WorkflowHub workflow 444 version 2; git None @ b96678c89705527c37521d4005586f989ace5255 | test-profile |
| `nextflow:workflowhub/452` | Apache-2.0 | WorkflowHub workflow 452 version 3; git https://github.com/EBI-Metagenomics/mobilome-annotation-pipeline.git @ 5c7a32d4… | output-equivalence |
| `nextflow:workflowhub/462` | Apache-2.0 | WorkflowHub workflow 462 version 3; git https://github.com/EBI-Metagenomics/genomes-pipeline.git @ 6d411a98bc9b01262bcc… | output-equivalence |
| `nextflow:workflowhub/668` | MIT | WorkflowHub workflow 668 version 1; git https://github.com/sanger-tol/treeval @ 2413fe52830694763fd868fee90e0884f4981296 | test-profile |
| `nextflow:workflowhub/683` | MIT | WorkflowHub workflow 683 version 3; git https://github.com/eresearchqut/ontvisc.git @ 2274c834a7065215f6b2311312916b5d6… | test-profile |
| `nextflow:workflowhub/813` | MIT | WorkflowHub workflow 813 version 2; git https://github.com/sanger-tol/treeval.git @ ef06981e429d8b19ffc50918555102b67c5… | test-profile |
| `nextflow:workflowhub/884` | Apache-2.0 | WorkflowHub workflow 884 version 2; git https://github.com/EBI-Metagenomics/genomes-generation @ 8f1caf4d82989b690e5a31… | output-equivalence |
| `snakemake:workflowhub/1091` | MIT | WorkflowHub workflow 1091 version 2; git https://github.com/kircherlab/cfDNA-UniFlow.git @ ad88ea0bbcb01a732835f4dff641… | test-profile |
| `snakemake:workflowhub/1729` | CC-BY-4.0 | WorkflowHub workflow 1729 version 1; git https://github.com/sanjaynagi/AmpSeeker @ 83e496ba1ee66e8804d67c78a977d60790cc… | test-profile |
| `snakemake:workflowhub/1759` | GPL-3.0 | WorkflowHub workflow 1759 version 1; git https://github.com/NBISweden/GenErode.git @ d5a96345915025fad253757a263c0d56c4… | test-profile |
| `snakemake:workflowhub/1815` | GPL-3.0 | WorkflowHub workflow 1815 version 5; git https://gitlab.univ-nantes.fr/bird_pipeline_registry/magneto.git @ 98a6cafeda7… | none |
| `snakemake:workflowhub/1900` | GPL-3.0 | WorkflowHub workflow 1900 version 1; git https://github.com/uzh-dqbm-cmi/cfDNA-Flow @ aac8d955ebde0e4bd90fa6a9f9f990211… | output-equivalence |
| `snakemake:workflowhub/1957` | CC-BY-4.0 | WorkflowHub workflow 1957 version 1; git https://github.com/BioIT-CEITEC/count_feature_rna.git @ 27d30bf6d55ed39a277ad9… | none |
| `snakemake:workflowhub/2081` | AGPL-3.0 | WorkflowHub workflow 2081 version 2; git https://github.com/yaccos/Petrisnake.git @ 715b3a9b7231dec4a4e85d565c37fb4765f… | none |
| `snakemake:workflowhub/2087` | GPL-3.0 | WorkflowHub workflow 2087 version 1; git https://gitlab.com/uniluxembourg/lcsb/systems-ecology/pathofact2.git @ 0141766… | none |
| `snakemake:workflowhub/2222` | MIT | WorkflowHub workflow 2222 version 2; git https://github.com/gynecoloji/snakemake_ATACseq_spikein.git @ 34864d4366dd30d6… | test-profile |
| `snakemake:workflowhub/2250` | MIT | WorkflowHub workflow 2250 version 1; git https://github.com/JFKanela/llama-annotation-pipeline @ a4ab11c9e11fcc3dd22f60… | none |
| `snakemake:workflowhub/414` | MIT | WorkflowHub workflow 414 version 1; git https://github.com/kircherlab/ReMM.git @ b1fbe1e017e3ec4a2e692087eb3a134b6d6095… | none |
| `wdl:workflowhub/409` | CC-BY-4.0 | WorkflowHub workflow 409 version 1; git https://github.com/Cristianetaniguti/Reads2Map @ 09cc2139f309dc03093ed91c9f02df… | test-profile |
| `wdl:workflowhub/410` | CC-BY-4.0 | WorkflowHub workflow 410 version 1; git https://github.com/Cristianetaniguti/Reads2Map @ 09cc2139f309dc03093ed91c9f02df… | test-profile |

</details>

### D. Dockstore (GA4GH TRS v2, WDL)

`GET https://dockstore.org/api/ga4gh/trs/v2/tools?toolClass=Workflow&descriptorType=WDL` (all pages, 2026-10-06): 5801 WDL workflow entries. Selection: test/demo organisations and names dropped, sources acquired directly skipped (WARP, ENCODE, IWC, nf-core), at most 2 entries per organisation, verified > production > default-branch version -> 70 candidates. Files: TRS `/files` listing, then PRIMARY/SECONDARY descriptors and TEST_FILEs stored at their repository-absolute path (`dockstore_absolute_path`; a first pass that stored primary-relative paths lost every `../` import and was redone). Licence: Dockstore `licenseInformation.licenseName` (GitHub-detected licence of the source repository) mapped to SPDX; `Other`/missing -> unknown (non-redistributable).

- conversion: {'entries': 70, 'converted': 47, 'failed': 23}; failures: topmed-workflows/UM_variant_caller_wdl: ImportError: Failed to import https://raw.githubusercontent.com/DataBiosphere/topmed-work…; SRANWRP/pull_FASTQs_from_SRA_by_run: trivial graph (1 call); hmmer-docker: trivial graph (1 call); wdl-workflows/bcftools_merge: trivial graph (1 call); gatk/Mutect2_4-4-0-0: MultipleDefinitions: Multiple declarations of tumor_reads_size; gatk/Mutect2_PON_4-4-0-0: ImportError: Failed to import mutect2.wdl; sfkit: trivial graph (1 call); tf-atlas-pipeline/shap: SyntaxError: Unexpected token Token('STRING1_FRAGMENT', '{\n\tinput {\n\t\tString experim…; tf-atlas-pipeline/fastpredict_dev: trivial graph (1 call); biofx-workflows/CopySampleFilesWorkflow: trivial graph (1 call); myco/myco_sra: ImportError: Failed to import https://raw.githubusercontent.com/aofarrel/clockwork-wdl/2.…; altanalyze2_snaf/star_2pass_alignment: trivial graph (1 call); variant-interpretation/RdVisualization: MultipleValidationErrors: ; sv_merge/GraphEvaluation: trivial graph (1 call); ncov/ncov: trivial graph (1 call); ncov/gisaid_ingest: trivial graph (1 call); sv_merge/hapestry_validate: trivial graph (1 call); topology-tools/preprocess_microc: MultipleDefinitions: duplicate call input 'sample_id'; hpp_production_workflows/Dipcall: trivial graph (1 call); hpp_production_workflows/BUSCO: trivial graph (1 call); select_VCFs_wf: trivial graph (1 call); CTAT-LR-fusion/ctat_LR_fusion: trivial graph (1 call); mitochondrial-alignments/PostProcess: trivial graph (1 call)

| entry | version | licence (Dockstore) | files | test files | selected |
| --- | --- | --- | --- | --- | --- |
| github.com/DataBiosphere/topmed-workflows/UM_aligner_wdl | 1.32.0 | BSD 3-Clause "New" or "Revised" License | 2 | 1 | no |
| github.com/DataBiosphere/topmed-workflows/UM_variant_caller_wdl | 1.32.0 | BSD 3-Clause "New" or "Revised" License | 2 | 1 | no |
| github.com/broadinstitute/viral-pipelines/assemble_denovo | v2.1.0.2 | Other | 6 | 1 | no |
| github.com/broadinstitute/viral-pipelines/assemble_refbased | v2.1.4.1 | Other | 4 | 0 | no |
| github.com/vgteam/vg_wdl/GiraffeDeepTrio | giraffe-dv-dt-hprcy1 | MIT License | 3 | 1 | yes |
| github.com/aofarrel/SRANWRP/pull_FASTQs_from_SRA_by_run | v1.1.18 | none | 2 | 0 | no |
| github.com/gatk-workflows/gatk4-data-processing/processing-for-variant-discovery-gatk4 | 2.1.0 | BSD 3-Clause "New" or "Revised" License | 2 | 1 | no |
| github.com/vgteam/vg_wdl/GiraffeDeepVariantLite | giraffe-dv-dt-hprcy1 | MIT License | 3 | 1 | no |
| github.com/wshands/hmmer-docker | 1.0.1 | none | 2 | 1 | no |
| github.com/jmonlong/wdl-workflows/bcftools_merge | giraffe-paper | none | 2 | 1 | no |
| github.com/evalkanas/gatk/Mutect2_4-4-0-0 | master | Other | 1 | 0 | no |
| github.com/evalkanas/gatk/Mutect2_PON_4-4-0-0 | master | Other | 2 | 0 | no |
| github.com/hcholab/sfkit | prod | MIT License | 1 | 0 | no |
| github.com/viramalingam/tf-atlas-pipeline/shap | main | none | 1 | 0 | no |
| github.com/viramalingam/tf-atlas-pipeline/fastpredict_dev | main | none | 1 | 0 | no |
| github.com/AoU-Multiomics-Analysis/prepare_QTL/prepare_eQTL | main | none | 4 | 0 | no |
| github.com/AoU-Multiomics-Analysis/prepare_QTL/prepare_pQTL | main | none | 4 | 0 | no |
| github.com/mgbpm/biofx-workflows/DepthOfCoverageWorkflow | main | none | 1 | 0 | no |
| github.com/mgbpm/biofx-workflows/CopySampleFilesWorkflow | main | none | 2 | 0 | no |
| github.com/aofarrel/myco/myco_sra | main | GNU General Public License v3.0 | 3 | 2 | no |
| github.com/VJalili/gatk-sv | main | BSD 3-Clause "New" or "Revised" License | 7 | 0 | no |
| github.com/NDeeSeee/altanalyze2_snaf/star_2pass_alignment | main | none | 2 | 1 | no |
| github.com/NDeeSeee/altanalyze2_snaf/splicing_analysis | main | none | 2 | 1 | no |
| github.com/klarman-cell-observatory/cumulus/Cellranger | master | BSD 3-Clause "New" or "Revised" License | 7 | 0 | no |
| github.com/theiagen/public_health_bioinformatics/TheiaCoV_ClearLabs_PHB | main | GNU General Public License v3.0 | 25 | 0 | yes |
| github.com/theiagen/public_health_bioinformatics/TheiaCoV_ONT_PHB | main | GNU General Public License v3.0 | 31 | 0 | yes |
| github.com/talkowski-lab/variant-interpretation/RdVisualization | main | none | 2 | 0 | no |
| github.com/talkowski-lab/variant-interpretation | main | none | 2 | 0 | no |
| github.com/wustl-oncology/analysis-wdls/immuno | main | MIT License | 117 | 0 | yes |
| github.com/MethodsDev/LongReadAlignmentAssembler/LRAA | main | Other | 5 | 0 | yes |
| github.com/PacificBiosciences/HiFi-human-WGS-WDL/HiFi-human-WGS-WDL-singleton | main | BSD 3-Clause Clear License | 25 | 0 | yes |
| github.com/PacificBiosciences/HiFi-human-WGS-WDL/HiFi-human-WGS-WDL-family | main | BSD 3-Clause Clear License | 28 | 0 | yes |
| github.com/lilab-bcb/cumulus/Cumulus | master | BSD 3-Clause "New" or "Revised" License | 3 | 1 | no |
| github.com/lilab-bcb/cumulus/Smart-Seq2 | master | BSD 3-Clause "New" or "Revised" License | 2 | 1 | no |
| github.com/mjfos2r/ONT_DemuxAndQC/ONT_DemuxAndQC | main | none | 5 | 0 | no |
| github.com/CDPHE-bioinformatics/CDPHE-SARS-CoV-2/SC2_ont_assembly | main | GNU General Public License v3.0 | 4 | 0 | no |
| github.com/CDPHE-bioinformatics/CDPHE-SARS-CoV-2/SC2_illumina_pe_assembly | main | GNU General Public License v3.0 | 4 | 0 | no |
| github.com/rlorigro/sv_merge/GraphEvaluation | fc_dev_googlebatch | Apache License 2.0 | 1 | 0 | no |
| github.com/MethodsDev/LongReadAlignmentAssembler/LRAA-cell_cluster_guided | main | Other | 9 | 0 | yes |
| github.com/Cristianetaniguti/Reads2Map/EmpiricalMaps | main | MIT License | 12 | 0 | yes |
| github.com/Cristianetaniguti/Reads2Map/EmpiricalSNPCalling | main | MIT License | 21 | 0 | yes |
| github.com/nextstrain/ncov/ncov | master | MIT License | 3 | 1 | no |
| github.com/nextstrain/ncov/gisaid_ingest | master | MIT License | 3 | 1 | no |
| github.com/rlorigro/sv_merge/hapestry_validate | fc_dev_googlebatch | Apache License 2.0 | 1 | 0 | no |
| github.com/klarman-cell-observatory/cumulus/Cellranger_create_reference | master | BSD 3-Clause "New" or "Revised" License | 1 | 0 | yes |
| github.com/mjfos2r/ONT_CleanReads/ONT_CleanReads | main | none | 7 | 0 | no |
| github.com/mobinasri/flagger/Asm2AsmAligner | main | MIT License | 5 | 0 | no |
| github.com/mobinasri/flagger/DeepVariantScattered | main | MIT License | 3 | 0 | no |
| github.com/f73chen/rnaSeqQC/RNASeqQC | master | none | 2 | 1 | no |
| github.com/DOH-HNH0303/public_health_bioinformatics_waphl/TheiaCoV_Illumina_PE_PHB | main | GNU General Public License v3.0 | 31 | 0 | yes |
| github.com/DOH-HNH0303/public_health_bioinformatics_waphl/Freyja_FASTQ_PHB | main | GNU General Public License v3.0 | 16 | 0 | no |
| github.com/gatk-workflows/gatk4-germline-snps-indels/haplotypecaller-gvcf-gatk4 | master | BSD 3-Clause "New" or "Revised" License | 2 | 1 | no |
| github.com/aryeelab/topology-tools/preprocess_microc | main | none | 1 | 0 | no |
| github.com/aryeelab/topology-tools/preprocess_rcmc | main | none | 1 | 0 | no |
| github.com/human-pangenomics/hpp_production_workflows/Dipcall | master | MIT License | 1 | 0 | no |
| github.com/human-pangenomics/hpp_production_workflows/BUSCO | master | MIT License | 1 | 0 | no |
| github.com/shadizaheri/HiFi-human-WGS-WDL/HiFi_human_WGS_WDL_main | main | BSD 3-Clause Clear License | 14 | 0 | yes |
| github.com/shadizaheri/HiFi-human-WGS-WDL/HiFi_human_WGS_WDL_cohort_analysis | main | BSD 3-Clause Clear License | 7 | 0 | no |
| github.com/phuwanat/select_VCFs_wf | main | none | 1 | 0 | no |
| github.com/CuriousTim/gatk-sv/TinyResolve | main | BSD 3-Clause "New" or "Revised" License | 4 | 0 | no |
| github.com/large-scale-gxe-methods/gem-workflow/gem-workflow | master | Other | 2 | 1 | no |
| github.com/TrinityCTAT/CTAT-LR-fusion/ctat_LR_fusion | main | Other | 1 | 0 | no |
| github.com/erikwolfsohn/public_health_bacterial_genomics/CCPHL_NARMS_Table | main | GNU Affero General Public License v3.0 | 30 | 0 | yes |
| github.com/CuriousTim/gatk-sv/RefineComplexVariantsCaching | main | BSD 3-Clause "New" or "Revised" License | 7 | 0 | no |
| github.com/malariagen/pipelines/MalariaVector_ShortReadAlignmentAndGenotyping | master | MIT License | 8 | 0 | yes |
| github.com/malariagen/pipelines/MalariaVector_Phasing | master | MIT License | 10 | 0 | no |
| github.com/GrantDaly/mitochondrial-alignments/PostProcess | master | none | 2 | 1 | no |
| github.com/hall-lab/sv-pipeline/sv-merge1 | master | none | 3 | 1 | yes |
| github.com/hall-lab/sv-pipeline/sv-postmerge | master | none | 3 | 1 | yes |
| github.com/erikwolfsohn/public_health_bacterial_genomics/TheiaProk_Illumina_PE_Kaptive2 | main | GNU Affero General Public License v3.0 | 30 | 0 | no |

### E. CWL and WDL GitHub repositories (session git proxy)

Shallow (`--depth 1`), `--filter=blob:none`, sparse clones of definition files only (`*.cwl`, job/test YAML; `*.wdl`, input JSON) with the full file list written from tree objects (test data listed, not downloaded). Licence: repository LICENSE file at the cloned commit (no LICENSE file -> unknown, non-redistributable; NCBI PGAP's LICENSE.md is a US-Government public-domain notice). CWL: top-level workflows (not referenced by another file's `run:`), test/deprecated paths skipped, at most 8 per repository, largest first. WDL: every workflow file outside tests/verification/deprecated paths that miniwdl loads with local imports only.

| platform | repository | commit | date | licence | CWL top-level workflows | converted | WDL load failures | selected |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cwl | Barski-lab/workflows | 4723ce567089 | 2025-09-04 | unknown | 37 | 8 | - | 4 |
| cwl | EBI-Metagenomics/pipeline-v5 | fff6fa392370 | 2026-04-21 | Apache-2.0 | 4 | 4 | - | 3 |
| wdl | ENCODE-DCC/atac-seq-pipeline | 47ba8dff9c33 | 2024-02-15 | MIT | - | 1 | 0 | 1 |
| wdl | ENCODE-DCC/chip-seq-pipeline2 | 26eeda81a054 | 2024-02-15 | MIT | - | 1 | 0 | 1 |
| wdl | broadinstitute/warp | aca5a0119518 | 2026-10-01 | BSD-3-Clause | - | 33 | 13 | 15 |
| cwl | common-workflow-library/bio-cwl-tools | 810495363e06 | 2025-03-25 | Apache-2.0 | 3 | 3 | - | 1 |
| wdl | gatk-workflows/gatk4-somatic-snvs-indels | fdf7b59855f6 | 2020-03-09 | BSD-3-Clause | - | 0 | 3 | 0 |
| cwl | hubmapconsortium/salmon-rnaseq | 81e448498625 | 2026-09-16 | GPL-3.0 | 2 | 2 | - | 0 |
| cwl | kids-first/kf-alignment-workflow | 43d7b79b07b8 | 2026-02-12 | Apache-2.0 | 27 | 8 | - | 3 |
| cwl | kids-first/kf-germline-workflow | 66a532460059 | 2025-02-24 | unknown | 4 | 4 | - | 3 |
| cwl | kids-first/kf-somatic-workflow | 41ac01945eac | 2026-07-21 | unknown | 3 | 3 | - | 1 |
| cwl | mskcc/ACCESS-Pipeline | b0f226a9ac51 | 2021-04-22 | MIT | 4 | 3 | - | 2 |
| cwl | ncbi/pgap | 2a81fcde75ca | 2026-06-02 | LicenseRef-US-Government-Public-Domain | 13 | 8 | - | 4 |
| cwl | nci-gdc/gdc-dnaseq-cwl | 86f949778822 | 2026-09-26 | Apache-2.0 | 2 | 2 | - | 2 |

WDL load failures (raw reasons): `broadinstitute/warp:pipelines/wdl/atac/atac.wdl`: ImportError: Failed to import ../peak_calling/PeakCalling.wdl; `broadinstitute/warp:pipelines/wdl/dna_seq/germline/joint_genotyping/JointGenotyping.wdl`: ImportError: Failed to import https://raw.githubusercontent.com/broadinstitute/gatk/4.5.0.0/scripts/vcf_site_…; `broadinstitute/warp:pipelines/wdl/dna_seq/germline/joint_genotyping/UltimaGenomics/UltimaGenomicsJointGenotyping.wdl`: ImportError: Failed to import https://raw.githubusercontent.com/broadinstitute/gatk/4.5.0.0/scripts/vcf_site_…; `broadinstitute/warp:pipelines/wdl/glimpse/sv_imputation/Glimpse2SVImputation.wdl`: ImportError: Failed to import ./PreprocessPLsGVCF.wdl; `broadinstitute/warp:pipelines/wdl/glimpse/sv_imputation/PreprocessPLsGVCF.wdl`: MultipleDefinitions: imported struct RuntimeAttr must be aliased because it collides with a struct type in th…; `broadinstitute/warp:pipelines/wdl/multiome/Multiome.wdl`: MultipleDefinitions: duplicate call input 'cloud_provider'; `broadinstitute/warp:pipelines/wdl/optimus/Optimus.wdl`: ImportError: Failed to import ../../../tasks/wdl/H5adUtils.wdl; `broadinstitute/warp:pipelines/wdl/paired_tag/PairedTag.wdl`: ImportError: Failed to import ../atac/atac.wdl; `broadinstitute/warp:pipelines/wdl/peak_calling/PeakCalling.wdl`: MultipleDefinitions: Workflow name collides with a task also named PeakCalling; `broadinstitute/warp:pipelines/wdl/slideseq/SlideSeq.wdl`: ImportError: Failed to import ../../../tasks/wdl/H5adUtils.wdl; `broadinstitute/warp:pipelines/wdl/slidetags/SlideTags.wdl`: ImportError: Failed to import ../optimus/Optimus.wdl; `broadinstitute/warp:pipelines/wdl/smartseq2_single_nucleus_multisample/MultiSampleSmartSeq2SingleNucleus.wdl`: ImportError: Failed to import ../../../tasks/wdl/H5adUtils.wdl; `broadinstitute/warp:tasks/wdl/sample_fastq.14.wdl`: MultipleValidationErrors: ; `gatk-workflows/gatk4-somatic-snvs-indels:mutect2-normal-normal.wdl`: ImportError: Failed to import https://raw.githubusercontent.com/gatk-workflows/gatk4-somatic-snvs-indels/2.5.…; `gatk-workflows/gatk4-somatic-snvs-indels:mutect2.wdl`: StaticTypeMismatch: Expected Array[Any] instead of File?; command placeholder has 'sep' option for non-Array …; `gatk-workflows/gatk4-somatic-snvs-indels:mutect2_pon.wdl`: ImportError: Failed to import https://raw.githubusercontent.com/gatk-workflows/gatk4-somatic-snvs-indels/2.6.…

### F. Snakemake workflow catalog

Catalog `https://github.com/snakemake/snakemake-workflow-catalog` cloned at `f1638109ec0447c7292d87496a06586388d78eba` (2026-10-05); 468 standardized workflows; the 70 with most stars (template repository excluded) were sparse-cloned at their latest release tag (else default-branch HEAD) with only Snakefiles, rules, schemas, config tables, `.test` configs, `.tests/unit`, CI workflows and LICENSE checked out. Licence: repository LICENSE/COPYING at the cloned commit.

| repository | ref | commit | stars | licence | nodes/edges | selected |
| --- | --- | --- | --- | --- | --- | --- |
| snakemake-workflows/rna-seq-star-deseq2 | v3.1.1 | aa6b17edf339 | 350 | MIT | 25/42 | 0 |
| franciscozorrilla/metaGEM | v1.0.5 | d26adafd8f81 | 262 | MIT | 37/22 | 0 |
| snakemake-workflows/dna-seq-gatk-variant-calling | v2.1.1 | cffa77a96348 | 207 | MIT | 32/60 | 1 |
| cbg-ethz/V-pipe | v3.0.0.pre1 | 7013890976e7 | 147 | Apache-2.0 | 88/104 | 1 |
| moiexpositoalonsolab/grenepipe | v0.15.0 | 53912b0749f9 | 102 | GPL-3.0 | 96/213 | 1 |
| epigen/atacseq_pipeline | v2.1.0 | d6101d696d79 | 93 | MIT | 26/44 | 0 |
| snakemake-workflows/dna-seq-varlociraptor | v6.10.1 | a96a2abbe3ca | 91 | MIT | 122/142 | 1 |
| GooglingTheCancerGenome/sv-callers | v1.2.2 | 9f7ab801957f | 79 | Apache-2.0 | 13/1 | 0 |
| epigen/enrichment_analysis | v3.0.1 | cd347fe16149 | 77 | MIT | 16/22 | 0 |
| snakemake-workflows/rna-seq-kallisto-sleuth | v4.1.0 | 46fb01a2d09f | 69 | MIT | 75/129 | 1 |
| epigen/unsupervised_analysis | v4.0.1 | 16f50294d958 | 67 | MIT | 27/46 | 0 |
| epigen/dea_limma | v2.2.1 | 70fe01d1e56e | 62 | MIT | 12/14 | 1 |
| epigen/scrnaseq_processing_seurat | v3.0.9 | 756b2d9819a8 | 54 | MIT | 15/20 | 0 |
| epigen/mixscape_seurat | v2.0.3 | bcf72d5769e2 | 51 | MIT | 7/7 | 0 |
| epigen/spilterlize_integrate | v3.0.7 | bc9d8c28f3ea | 49 | MIT | 14/19 | 0 |
| sneuensc/mapache | v0.3.0 | 54c773df91c0 | 35 | GPL-3.0 | 95/183 | 1 |
| zavolanlab/zarp | v1.0.0 | e2288df00aed | 35 | Apache-2.0 | 38/68 | 0 |
| LiaOb21/colora | Colora_v1.2.0 | d6569edaff8d | 33 | MIT | 25/50 | 0 |
| zjnolen/PopGLen | v0.4.4 | 1276acd74df9 | 27 | GPL-3.0 | 129/274 | 1 |
| akcorut/kGWASflow | v1.3.0 | 27654c839824 | 26 | MIT | 70/120 | 1 |
| friendsofstrandseq/mosaicatcher-pipeline | v2.5.1 | 2289f7cc8ef2 | 26 | MIT | 207/389 | 1 |
| epigen/dea_seurat | v2.0.3 | b2f91010acad | 25 | MIT | 10/11 | 0 |
| epigen/genome_tracks | v2.0.5 | e7016b746d98 | 25 | MIT | 12/11 | 0 |
| nismod/open-gira | v0.4.2 | 3acb87d7d7d2 | 24 | MIT | 155/195 | 1 |
| ncherric/Iliad | v1.0.0 | 136deec37a5b | 23 | MIT | 26/31 | 0 |
| IKIM-Essen/uncovar | v1.1.1 | 17b4f32f2570 | 22 | BSD-2-Clause | 170/382 | 1 |
| ylab-hi/ScanNeo2 | v0.7.0 | 30d98b6869c7 | 22 | MIT | 135/235 | 1 |
| MathiasEskildsen/ONT-AmpSeq | v1.1.2 | 4f0694de31a5 | 21 | MIT | 27/42 | 0 |
| tucca-cellag/tucca-rna-seq | v1.0.1 | 697b13d4ee46 | 19 | MIT | 39/70 | 0 |
| kircherlab/MPRAsnakeflow | v0.7.2 | 72daedcf15a0 | 16 | MIT | 95/177 | 1 |
| DavideBrex/SpikeFlow | v1.3.2 | 87ce94f092f3 | 14 | MIT | 32/59 | 0 |
| MPUSP/snakemake-ms-proteomics | v1.1.1 | bb54855e5ae3 | 14 | MIT | 13/15 | 0 |
| snakemake-workflows/dna-seq-benchmark | v1.17.0 | 62fd9fd124b6 | 13 | MIT | 60/111 | 0 |
| ncbench/ncbench-workflow | v1.4.0 | a784cc03953a | 13 | MIT | 3/0 | 0 |
| IKIM-Essen/RiboSnake | v0.11.0 | 453e8c885b53 | 12 | MIT | 122/199 | 1 |
| SchlossLab/mikropml-snakemake-workflow | v1.3.0 | 7159f18df561 | 12 | MIT | 21/28 | 1 |
| epigen/rnaseq_pipeline | v1.2.2 | df795ef403ff | 12 | MIT | 26/49 | 1 |
| epigen/fetch_ngs | v1.0.5 | 257f43285b23 | 10 | MIT | 7/9 | 0 |
| StergachisLab/IsoSeq_smk | v0.1.1 | c941cd6c2666 | 9 | MIT | 22/34 | 0 |
| Zilong-Li/lcWGS-imputation-workflow | HEAD | 182a1b39a01d | 9 | MIT | 43/62 | 0 |
| fischuu/Snakebite-Holoruminant-MetaG | 0.4.62 | cfd990e0a891 | 9 | unknown | 161/246 | 1 |
| niekwit/crispr-screens | v1.2.0 | 45387ad4b9ea | 9 | MIT | 40/67 | 0 |
| MPUSP/snakemake-crispr-guides | v1.7.2 | 8e6116a7eca3 | 8 | MIT | 10/9 | 1 |
| PathoGenOmics-Lab/VIPERA | v1.3.1 | a5ab53c46398 | 8 | GPL-3.0 | 66/112 | 0 |
| boulardlab/3t-seq | v1.1.0 | 8a18bb6c1d76 | 8 | MIT | 45/42 | 0 |
| odcambc/dumpling | v0.9.0 | 0fc2b14c40b6 | 8 | MIT | 30/34 | 0 |
| semenko/serpent-methylation-pipeline | HEAD | 3cb160ff283c | 8 | MIT | 26/47 | 0 |
| usnistgov/defrabb | HEAD | d13873ee7b34 | 8 | unknown | 82/176 | 0 |
| MPUSP/snakemake-ont-bacterial-variants | v1.1.1 | 42cdc6938077 | 7 | MIT | 23/34 | 0 |
| NCI-CGR/TriosCompass_v2 | 1.1.0 | b6733d99f86a | 7 | MIT | 64/63 | 1 |
| PyPSA/grid-builder | HEAD | 6905b99e677d | 6 | MIT | 7/3 | 0 |
| SarahSaadain/pastForward | v2.1.0 | 987da084aa80 | 6 | MIT | 156/315 | 1 |
| TRON-Bioinformatics/oblx | v2.0.2 | a32b146bec83 | 6 | MIT | 62/147 | 0 |
| dbespiatykh/RDscan | v1.0.5 | f7e2d91608c7 | 6 | MIT | 19/23 | 0 |
| daspacio9/pooledpremiumpcrpipeline2 | v4.0.2 | cc7966138bf7 | 6 | MIT | 34/47 | 1 |
| nodrogluap/tamor | HEAD | 241314a13da3 | 6 | Apache-2.0 | 26/36 | 0 |
| zavolanlab/mirflowz | v0.10.0 | 10b78c8b9877 | 6 | MIT | 70/113 | 1 |
| niekwit/rna-seq-salmon-deseq2 | v0.9.0 | 387bef1947bb | 6 | MIT | 18/21 | 0 |
| niekwit/cut_and_run | v0.5.0 | dd734eeb0417 | 6 | MIT | 52/86 | 1 |
| GArcho44/snvs-annotation-pipeline | v0.0.2 | 10b4f63e29c7 | 5 | MIT | 20/32 | 0 |
| GuttmanLab/chipdip-pipeline | v3.0.0 | a5b0ddd7b7f2 | 5 | MIT | 36/30 | 1 |
| GooglingTheCancerGenome/sv-gen | v1.1.0 | cb57bbf0833c | 5 | Apache-2.0 | 9/7 | 0 |
| IHGGM-Aachen/CNVand | 0.4 | d2cb34017713 | 5 | MIT | 18/35 | 0 |
| MPUSP/snakemake-bacterial-riboseq | v1.6.0 | 9f66b9cdb197 | 5 | MIT | 22/35 | 0 |
| khanlab/SPIMprep | v0.1.0-alpha | 85f518d103bc | 5 | MIT | 30/84 | 1 |
| MPUSP/snakemake-ont-basecalling | v1.6.0 | 4c1f8bccb3be | 5 | MIT | 16/17 | 0 |
| magwenelab/WeavePop | v1.0.0 | b04735d51514 | 5 | GPL-3.0 | 88/204 | 1 |
| modelblocks-org/module_geo_boundaries | v1.0.1 | c24455dede73 | 5 | Apache-2.0 | 13/6 | 0 |
| niekwit/damid-seq | v0.7.0 | 5e7a30822c6f | 5 | MIT | 70/119 | 1 |
| niekwit/rna-seq-star-tetranscripts | v0.6.0 | a64634d6ecb0 | 5 | MIT | 27/34 | 0 |

## Blocked, failed or unavailable

- GitHub REST API (other repositories) is blocked by the egress proxy: repository metadata, licences and file lists were obtained from `git clone` through the session git proxy (tree objects) instead; no GitHub search was used to find workflows.
- nf-core: 50 pipelines in the index have no release (in development) and were not acquired.
- WorkflowHub: 5 RO-Crates over the 25 MB cap (not downloaded), 0 crate endpoints answered with non-zip content, 2 registered git remotes failed to clone, 2 hosted-git entries listed no files; 18 main files did not parse as a workflow of their declared class (raw reasons in `/opt/corpus/science-work/workflowhub-stats.json`).
- WorkflowHub: 39 entries have no workflow file in what was acquired (metadata-only RO-Crates of workflows registered by URL, or a git checkout without the declared main file); 25 of them are oxo-flow (`*.oxoflow`) pipelines registered under the WDL class, a workflow system outside this cluster's parsers. Not fetched from their remotes.
- Dockstore: 23 of 70 candidates did not convert (remote imports not fetched by design, miniwdl validation errors, or single-call wrappers below the 2-node threshold); listed above.
- WDL: imports from other repositories (e.g. `raw.githubusercontent.com/broadinstitute/gatk/...`) are refused by the local-only reader, so the affected WARP pipelines are recorded as failures rather than parsed with missing calls.
- Not attempted: Dockstore CWL/Nextflow/Galaxy entries (covered via WorkflowHub, IWC, nf-core and the GitHub clones), the nf-core modules/subworkflows repositories as standalone items, Snakemake wrappers, and executing any test profile.

## Known limitations

- Nextflow and Snakemake graphs come from static analysis: Nextflow edges are may-flow (conditional channel reassignments are unioned), Snakemake edges come from matching input to output path patterns, and input functions/lambdas are only partly resolved. The `nodes`/`edges` counts therefore over-approximate any single run's DAG.
- Domain tags are keyword heuristics over titles, descriptions and tool names and over-tag (e.g. `phylogenetics` from `tree`).
- Licences are the declared licence of the workflow definition (repository LICENSE, `.ga` field, WorkflowHub/Dockstore metadata). Tool containers and reference data each carry their own licences, which were not assessed.
- WorkflowHub Galaxy entries include Galaxy Training Network tutorial workflows; they are down-weighted, not excluded, and are flagged by title in the selection stats (13 selected).
