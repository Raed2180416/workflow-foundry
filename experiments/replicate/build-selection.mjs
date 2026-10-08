#!/usr/bin/env node
// R-bench selection builder (development/diagnostic, 2026-10-08).
// Joins hand-written per-item annotations (below) with corpus metadata from
// research/corpus-20261006/items.jsonl and the agentic ledgers in /var/tmp/foundry-work/corpus-agentic/,
// pins each raw source by sha256, checks the selection rules, and writes
//   experiments/replicate/selection.json
//   research/replicate-20261008/SELECTION.md
// Corpus text and raw sources are untrusted data: this script reads only item metadata and hashes raw files;
// it never copies raw content into its outputs. Run: node experiments/replicate/build-selection.mjs
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const ITEMS = path.join(root, 'research/corpus-20261006/items.jsonl');
const AGENTIC = '/var/tmp/foundry-work/corpus-agentic/google-adk.jsonl';
const OUT_JSON = path.join(root, 'experiments/replicate/selection.json');
const OUT_MD = path.join(root, 'research/replicate-20261008/SELECTION.md');

const CLUSTER = {
  activepieces: 'automation', coze: 'automation', dify: 'automation', flowise: 'automation', langflow: 'automation', n8n: 'automation',
  'node-red': 'automation', zapier: 'automation', airflow: 'orchestration', argo: 'orchestration', dagster: 'orchestration',
  'github-actions': 'orchestration', 'gitlab-ci': 'orchestration', kubeflow: 'orchestration', prefect: 'orchestration', tekton: 'orchestration',
  temporal: 'orchestration', cwl: 'science', galaxy: 'science', nextflow: 'science', 'nf-core': 'science', snakemake: 'science', wdl: 'science',
  'apple-shortcuts': 'consumer-creative', comfyui: 'consumer-creative', 'home-assistant': 'consumer-creative', ifttt: 'consumer-creative',
  'google-adk': 'agentic'
};

// For directory-level raw paths, the file whose sha256 pins the item.
const MAIN_FILE = {
  'nf-core:stableexpression@v1.0.0': 'main.nf', 'nf-core:reportho@1.1.0': 'main.nf', 'nf-core:nanostring@1.3.3': 'main.nf',
  'snakemake:daspacio9/pooledpremiumpcrpipeline2@v4.0.2': 'workflow/Snakefile',
  'temporal:samples-go/shoppingcart': 'workflow.go',
  'dagster:data-quality-patterns': 'src/data_quality_patterns/definitions.py'
};

const C = '/opt/corpus';
const IWC = `${C}/galaxy/iwc/workflows`;
// ---------------------------------------------------------------------------------------------
// Annotations. tasks: T1 translate (original definition -> Foundry workflow), T2 rebuild from intent
// (description + example I/O only), T3 improve (same job, cheaper/faster/more reliable).
// priority: A = harness in the first wave, B = second wave, C = stretch.
// originalControl: 'runnable' (the original itself can be executed offline against the fixtures),
// 'shipped-outputs' (the shipped expected outputs were produced by the original), 'heavy' (runnable only with
// containers/servers inside the D5 cap), 'transcribed' (not runnable; a reference re-implementation written from
// the definition stands in and is labelled weaker), 'none'.
// ---------------------------------------------------------------------------------------------
const A = [
  // ------------------------------------------------------------------ science
  {
    id: 'galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting', priority: 'A',
    pilot: 'science (shipped test data and reference outputs)',
    why: 'IWC workflow by Wolfgang Maier that turns per-sample VCFs from any IWC variant-calling workflow into by-sample and by-variant reports: 31 Galaxy tool steps (35 with inputs) chaining SnpSift filter/extractFields, column_maker, datamash, find-and-replace, joins and collection collapse. A reporting chore people otherwise script by hand; deterministic tabular job with light tools (no aligner).',
    constructs: ['run parameters (AF, DP, DP_ALT thresholds)', 'map over a sample collection', 'filter', 'joins and group-by aggregation (fan-in)', 'split to collection'],
    tasks: {
      T1: 'feasible: .ga is MIT and complete; tool semantics (SnpSift expressions, datamash ops) must be reproduced in code nodes',
      T2: 'feasible: README + the four parameter annotations + one example VCF and its four output tables',
      T3: 'feasible: same four tables with far fewer steps and no model calls; robustness to multi-sample collections and missing ANN fields'
    },
    oracle: {
      kind: 'output-equivalence',
      files: [
        `${IWC}/variant-calling/variation-reporting/Generic-variation-analysis-reporting-tests.yml`,
        `${IWC}/variant-calling/variation-reporting/test-data/Variation data to report_filtered variants ERR3485802.vcf`,
        `${IWC}/variant-calling/variation-reporting/test-data/af_recalculated.tabular`,
        `${IWC}/variant-calling/variation-reporting/test-data/all_variants_all_samples.tabular`,
        `${IWC}/variant-calling/variation-reporting/test-data/by_variant_report.tabular`,
        `${IWC}/variant-calling/variation-reporting/test-data/combined_variant_report.tabular`
      ],
      plan: 'Run the candidate on the shipped VCF with AF 0.05, DP 1, DP_ALT 10. The four tables must match the shipped ones: the tests file allows compare: diff with lines_diff 6; R-bench reports that score and a stricter one (row multiset equal after header normalisation). Generalisation set: 20 seeded variants of the shipped VCF (resampled records, 2 to 5 samples per collection, shifted thresholds) whose expected tables come from a reference implementation that must first reproduce the shipped outputs exactly (oracle health gate); these cases are labelled derived.',
      pass: 'all four tables equal on the shipped case and on >= 18/20 derived cases'
    },
    controls: { original: 'shipped-outputs', originalHow: 'the shipped tables are the original workflow outputs; a planemo re-run needs a Galaxy server with pinned tool-shed tools (optional, heavy)', broken: ['AF filter uses > instead of >=', 'DP_ALT recalculation dropped', 'collapse keeps only the first sample', 'empty'] },
    mocks: [], acquisition: [], effortHours: 10,
    risks: ['only one sample in the shipped test, so generalisation cases depend on our reference implementation (validated on the shipped case first)', 'SnpSift expression and ANN-field semantics must be matched exactly', 'lines_diff 6 is a loose shipped criterion'],
    licenceNote: 'MIT (workflow and test data in galaxyproject/iwc); redistributable'
  },
  {
    id: 'nf-core:stableexpression@v1.0.0', priority: 'B',
    why: 'Finds the most stable reference genes for a species by pooling public and custom RNA-seq/microarray count datasets: cleaning, ID mapping, CPM/TPM and quantile normalisation, geNorm and NormFinder, a combined stability score and a report. Niche question, small team, Python/R table scripts rather than aligners.',
    constructs: ['optional external fetch (Expression Atlas, GEO, Ensembl, g:Profiler)', 'per-dataset fan-out', 'merge and imputation', 'two stability algorithms in parallel', 'aggregate ranking', 'error tolerance per dataset'],
    tasks: {
      T1: 'feasible but large: Nextflow modules map to code nodes; parquet intermediates',
      T2: 'feasible: description + the local beta_vulgaris datasets + an example summary table',
      T3: 'feasible: drop redundant normalisation passes; robustness to missing values and empty datasets'
    },
    oracle: {
      kind: 'output-equivalence',
      files: [
        `${C}/nf-core/repos/stableexpression/conf/test_dataset_format.config`,
        `${C}/nf-core/repos/stableexpression/tests/test_data/workflows/sampled/beta_vulgaris/samplesheet.csv`,
        `${C}/nf-core/repos/stableexpression/tests/test_data/workflows/sampled/beta_vulgaris/design.csv`,
        `${C}/nf-core/repos/stableexpression/tests/test_data/workflows/sampled/beta_vulgaris/counts.csv.gz`,
        `${C}/nf-core/repos/stableexpression/tests/test_data/workflows/sampled/beta_vulgaris/counts1.csv`,
        `${C}/nf-core/repos/stableexpression/tests/test_data/workflows/sampled/beta_vulgaris/counts2.csv`,
        `${C}/nf-core/repos/stableexpression/tests/default.nf.test.snap`,
        `${C}/nf-core/repos/stableexpression/tests/test_data/modules/normfinder/`,
        `${C}/nf-core/repos/stableexpression/tests/test_data/modules/compute_stability_scores/`
      ],
      plan: 'Expected reporting/all_genes_summary.csv comes from one pinned original run (nextflow + docker, profile test_dataset_format, all inputs local). Where a profile is snapshotted, the run must first reproduce the md5 in tests/default.nf.test.snap. Candidate pass: the 10 most stable genes as a set and Kendall tau >= 0.9 on their order, per-gene stability scores within 1e-6 relative. Module fixtures give unit-level checks for NormFinder and the combined score. Fetch-mode scenarios use mock Expression Atlas/GEO responses built from the module test data (labelled derived).',
      pass: 'top-10 set equal, tau >= 0.9, scores within tolerance on the local profile'
    },
    controls: { original: 'heavy', originalHow: 'nextflow run -profile test_dataset_format,docker with pinned container digests (D5 cap)', broken: ['quantile normalisation skipped', 'geNorm M ranking reversed', 'imputation dropped'] },
    mocks: ['Expression Atlas API', 'GEO', 'Ensembl FTP (GFF)', 'g:Profiler'],
    acquisition: ['Nextflow binary (pinned)', 'container images by digest'], effortHours: 16,
    risks: ['pyarrow is not installed for the code sandbox; parquet intermediates need it or CSV substitutes', 'the local profile may not be snapshotted; then the expected file is our pinned original run', 'NormFinder is an R implementation; numeric tolerance must be frozen before runs'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'nf-core:reportho@1.1.0', priority: 'B',
    why: 'Orthology report for query proteins: gathers orthologs from OMA, PANTHER and EggNOG (online APIs or offline database dumps), scores consensus across sources, filters by min_score, computes stats and plots. Specialist pipeline; Python scripts and ripgrep over small tables.',
    constructs: ['per-query fan-out', 'parallel source lookups (online or offline branch)', 'merge and score', 'threshold filter', 'optional downstream branch', 'stats fan-in'],
    tasks: {
      T1: 'feasible after acquiring bin/ scripts (not in the sparse clone)',
      T2: 'feasible: description + mini databases + an example score table',
      T3: 'feasible: one pass over each database; graceful handling of a source with no hits'
    },
    oracle: {
      kind: 'output-equivalence',
      files: [
        `${C}/nf-core/repos/reportho/conf/test_offline.config`,
        `${C}/nf-core/repos/reportho/tests/offline.nf.test`,
        `${C}/nf-core/repos/reportho/tests/offline.nf.test.snap`,
        'nf-core/test-datasets@<pin>:reportho/testdata/samplesheet/samplesheet.csv',
        'nf-core/test-datasets@<pin>:reportho/testdata/databases/{oma-mini.txt.gz,oma-uniprot-mini.txt.gz,oma-ensembl-mini.txt.gz,oma-refseq-mini.txt.gz,AllOrthologs-mini.txt,1_members-mini.tsv.gz,latest.Eukaryota-mini.tsv.gz}'
      ],
      plan: 'Expected score/<id>/<id>_score_table.csv and filtered hits from one pinned original run with profile test_offline (min_score 2); output file list must match tests/offline.nf.test.snap. Online-mode scenarios serve mock OMA/PANTHER/UniProt/EggNOG/Ensembl responses generated from the same mini databases, so online and offline candidates must agree (metamorphic check).',
      pass: 'score tables and filtered hit lists equal per query; online == offline'
    },
    controls: { original: 'heavy', originalHow: 'nextflow run -profile test_offline,docker after acquiring test-datasets', broken: ['score counts sources with no hit', 'min_score off by one', 'EggNOG id mapping dropped'] },
    mocks: ['OMA REST', 'PANTHER', 'UniProt', 'EggNOG', 'Ensembl', 'RefSeq (online mode only)'],
    acquisition: ['bin/*.py scripts at the pinned revision', 'nf-core/test-datasets reportho branch files (pinned SHA)'], effortHours: 14,
    risks: ['the sparse clone lacks bin/ scripts, so T1 and semantics depend on acquisition', 'the snapshot pins file lists, not values, for some outputs'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'nf-core:nanostring@1.3.3', priority: 'B',
    why: 'NanoString nCounter processing: RCC QC and normalisation via NACHO, annotated tables, optional gene-score computation and heatmap. Assay-specific and small (11 nodes) but numerically exact, so a rebuild either does the normalisation right or fails.',
    constructs: ['per-sample parsing', 'QC gate', 'normalisation', 'optional gene-score branch', 'report fan-in'],
    tasks: {
      T1: 'feasible: R scripts in modules/local/*/resources/usr/bin plus the NACHO module',
      T2: 'feasible: description + RCC files + example normalised table',
      T3: 'feasible: robustness to failed-QC samples; fewer passes'
    },
    oracle: {
      kind: 'output-equivalence',
      files: [
        `${C}/nf-core/repos/nanostring/conf/test.config`,
        `${C}/nf-core/repos/nanostring/tests/test.nf.test.snap`,
        `${C}/nf-core/repos/nanostring/tests/test_samples.nf.test.snap`,
        `${C}/nf-core/repos/nanostring/tests/test_scores.nf.test.snap`,
        `${C}/nf-core/repos/nanostring/modules/local/compute_gene_scores/resources/usr/bin/compute_gene_scores.R`,
        'nf-core/test-datasets@<pin>:nanostring/samplesheets/samplesheet_test.csv and the RCC files it lists'
      ],
      plan: 'Expected normalised and annotated count tables from one pinned original run (profile test, and test_scores for the gene-score branch); its md5s must match the shipped snapshots (38 md5 entries over the snap files). Candidate pass: per gene and sample values within 1e-6 relative, QC flags equal.',
      pass: 'normalised tables within tolerance, QC flags equal, gene scores within tolerance'
    },
    controls: { original: 'heavy', originalHow: 'nextflow run -profile test,docker (R/NACHO containers)', broken: ['positive-control scaling skipped', 'arithmetic instead of geometric mean for housekeeping factors', 'failed-QC samples silently dropped'] },
    mocks: [], acquisition: ['RCC files and samplesheets from nf-core/test-datasets (pinned SHA)', 'Nextflow and container digests'], effortHours: 12,
    risks: ['md5 equality is impossible across implementations, so the numeric tolerance carries the judgement', 'small DAG: T2 difficulty sits in the numerics, not the structure'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'galaxy:iwc/hyphy/capheine-core-and-compare', priority: 'C',
    why: 'CAPHEINE: a hand-assembled selection-analysis bundle (preprocessing, codon alignment, tree inference, HyPhy selection tests, and a branch comparison with optional foreground labelling by list or regex). Shipped Dengue test data, four test cases.',
    constructs: ['nested sub-workflows (core, compare, preprocessing)', 'optional branches (foreground list vs regex vs none)', 'map over genes', 'fan-in summary'],
    tasks: {
      T1: 'feasible only with tool capabilities (tape-backed)',
      T2: 'constrained: the rebuild must use the recorded tool set',
      T3: 'feasible on orchestration (skip redundant analyses, fail-soft per gene)'
    },
    oracle: {
      kind: 'test-profile + tool tapes',
      files: [
        `${IWC}/comparative_genomics/hyphy/capheine-core-and-compare-tests.yml`,
        `${IWC}/comparative_genomics/hyphy/test-data/`
      ],
      plan: 'Record each heavy tool call of an original run once (tool, version, args, input hash -> outputs) from pinned containers; candidates call tool capabilities that replay tapes and fail closed on unrecorded calls. Pass = every has_text assertion of the four shipped cases, plus correct foreground/background labelling per case.',
      pass: 'all shipped assertions in 4/4 cases'
    },
    controls: { original: 'heavy', originalHow: 'planemo test with pinned tools, or tape replay of the original calls', broken: ['regex foreground labelling ignored', 'RELAX comparison skipped', 'empty'] },
    mocks: ['tool tapes: codon aligner, IQ-TREE, HyPhy'], acquisition: ['pinned tool containers for recording'], effortHours: 20,
    risks: ['tapes restrict T2 to the original tool set, so the oracle judges orchestration and glue, not the science', 'has_text assertions are weak', 'HyPhy runtime during recording'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'snakemake:daspacio9/pooledpremiumpcrpipeline2@v4.0.2', priority: 'C',
    why: 'Single-author lab pipeline (Derek Sprayberry Aspacio) that demultiplexes pooled, dual-barcoded amplicons returned by the Plasmidsaurus Premium PCR service and calls per-sample consensus, coverage QC and AB1 export. The clearest niche, hand-built science item in the corpus.',
    constructs: ['barcode reference preparation sub-workflow', 'demultiplex fan-out', 'per-sample consensus', 'QC fan-in', 'cleanup'],
    tasks: {
      T1: 'feasible after acquiring workflow/scripts and test reads',
      T2: 'feasible for demultiplexing; consensus needs tool tapes',
      T3: 'feasible on demultiplexing robustness'
    },
    oracle: {
      kind: 'output-equivalence + tool tapes',
      files: [
        `${C}/snakemake/repos/daspacio9__pooledpremiumpcrpipeline2/.test/config/config.yaml`,
        `${C}/snakemake/repos/daspacio9__pooledpremiumpcrpipeline2/workflow/rules/demux.smk`,
        'daspacio9/pooledpremiumpcrpipeline2@cc7966138bf74fd72643dfffb7d6123890302d68: .test/ reads, barcode fasta/csv, workflow/scripts/*.py (blobs not materialised in the partial clone)'
      ],
      plan: 'Expected read-to-sample assignment and consensus sequences from one pinned original run. Pass = assignment exact; consensus identity >= 99.9% (medaka polishing replayed from tapes); QC summary values equal.',
      pass: 'assignment exact, consensus identity >= 0.999 for every sample'
    },
    controls: { original: 'heavy', originalHow: 'snakemake --use-conda or apptainer, once, to record', broken: ['barcode orientation swapped', 'min-length filter dropped'] },
    mocks: ['tool tapes: minimap2, medaka, samtools'], acquisition: ['scripts and test data blobs at the pinned SHA', 'conda environments or containers'], effortHours: 24,
    risks: ['most of the job lives in tools', 'medaka model weights and env resolution', 'acquisition from a partial clone'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'galaxy:workflowhub/251', priority: 'B',
    why: 'RELIANCE-project researcher workflow: extract five half-year periods (Jan-Jun 2019/2020/2021, Jul-Dec 2019/2020) of a CAMS air-quality variable at one location and compute mean/min/max per period (53 nodes of xarray_select, datamash, text processing, paste). Non-biology science item.',
    constructs: ['parameterised location', 'five parallel period extractions', 'per-period aggregation', 'fan-in table'],
    tasks: {
      T1: 'feasible: .ga is Apache-2.0',
      T2: 'feasible: description + a synthetic grid + example table',
      T3: 'feasible: 53 steps collapse to one pass; period boundaries made explicit'
    },
    oracle: {
      kind: 'authored output-equivalence',
      files: [`${C}/workflowhub/x/251/Galaxy-Workflow-Investigation_of_lockdown_effect_on_air_quality_between_January_2019_to_May_2021.ga`],
      plan: 'Seeded synthetic CAMS-like grids (lat/lon/time, hourly, JSON) with known values; the oracle computes per-period mean/min/max at the nearest grid point. Pass = values within 1e-9, correct inclusive period boundaries in UTC, correct nearest-point choice.',
      pass: 'all periods correct on >= 19/20 seeded grids'
    },
    controls: { original: 'heavy', originalHow: 'Galaxy with xarray tools (optional)', broken: ['period end off by one day', 'interpolated instead of nearest point', 'mean of daily means'] },
    mocks: [], acquisition: [], effortHours: 8,
    risks: ['no shipped test: authored oracle (T3-tier)', 'real input is a Copernicus netCDF; the synthetic grid stands in', 'computationally simple: the value is in period/coordinate semantics and consolidation'],
    licenceNote: 'Apache-2.0; redistributable'
  },
  // ------------------------------------------------------------------ orchestration
  {
    id: 'github-actions:shafthq/shaft_engine/.github/workflows/update-selenium-grid-versions.yml', priority: 'A',
    pilot: 'choice: orchestration cluster, and the only pilot whose original runs offline as a true control',
    why: 'A maintainer bot in the SHAFT test-automation framework: weekly, fetch Selenium\'s reference docker-compose, extract chrome/edge/firefox/hub tags, strip nightly/beta/dev tags, compare with the repo\'s selenium4.yml, rewrite versions, validate, and open a pull request only on change: a 177-line workflow, mostly hand-written bash, in six steps.',
    constructs: ['schedule trigger (run input)', 'external fetch', 'parse and normalise', 'guard on change', 'file-edit effect', 'pull-request effect'],
    tasks: {
      T1: 'feasible: bash steps map to code nodes plus HTTP/file/PR capabilities',
      T2: 'feasible: description + one reference compose + the repo file',
      T3: 'feasible: idempotent PR (update an open bot PR instead of opening another), fail loudly on malformed reference'
    },
    oracle: {
      kind: 'mocked-execution (effect trace + file state)',
      files: [
        '/opt/corpus/github-actions/raw/shafthq__shaft_engine@3b2eae51248d2cf58146a64c48265259ee077a0a/.github/workflows/update-selenium-grid-versions.yml',
        'shafthq/shaft_engine@3b2eae51248d2cf58146a64c48265259ee077a0a:src/main/resources/docker-compose/selenium4.yml (acquire one file)'
      ],
      plan: '12+ authored scenarios: normal bump, nightly/beta tags on some images, an image missing from the reference, no change, malformed reference, already-open bot PR. Pass = resulting selenium4.yml byte-equal to the expected edit, PR opened iff changed with the expected branch/title fields, no PR on no-change, visible failure on malformed input.',
      pass: 'all scenarios'
    },
    controls: { original: 'runnable', originalHow: 'execute the run: steps under bash in a temp repo with curl shimmed to the fixture and peter-evans/create-pull-request replaced by a recording stub', broken: ['pre-release filter dropped', 'PR opened without change', 'only chrome updated'] },
    mocks: ['HTTP GET raw.githubusercontent.com (fixture)', 'repository filesystem (temp dir)', 'GitHub pull-request API (recording stub)', 'docker compose config validation (stub)'],
    acquisition: ['selenium4.yml at the pinned SHA'], effortHours: 6,
    risks: ['low judgement: a short script solves it, so it measures replication fidelity and control machinery, not judgement', 'grep/sed first-match semantics must be reproduced'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'prefect:prefect-recipes/flows-advanced/merge_dependabot_pull_requests.py', priority: 'B',
    why: 'Community recipe for a cross-repo chore: scrape the collections catalog for Prefect-authored repos, find each repo\'s open dependabot PR with a given title, approve it and comment "@dependabot merge". Sub-flows, retries, task caching.',
    constructs: ['sub-flow per repository (map)', 'retries with delay', 'cached lookup', 'guard on title match', 'two write effects per match'],
    tasks: {
      T1: 'feasible',
      T2: 'feasible: docstring description + example API responses',
      T3: 'feasible: idempotence (no duplicate comment on re-run), handle more than ten open PRs'
    },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/prefect/PrefectHQ__prefect-recipes@ebc974b22430f8fceda609dd0d17663ab2008c01/flows-advanced/merge_dependabot_pull_requests.py'],
      plan: 'Stateful mock GitHub (REST git/trees and contents, GraphQL pull-request query, review and comment mutations). Scenarios: matching and non-matching titles, closed PRs, non-Prefect catalog entries, transient 502 (retry), more than ten open PRs, re-run. Pass = exactly the expected PRs approved and commented once; others untouched.',
      pass: 'all scenarios'
    },
    controls: { original: 'heavy', originalHow: 'pinned venv (prefect, prefect-github, httpx) with HTTPS interception to the mock; needs owner approval for the install', broken: ['approve without title match', 'comment twice'] },
    mocks: ['GitHub REST', 'GitHub GraphQL'], acquisition: [], effortHours: 8,
    risks: ['three normalised nodes understate the code', 'the original page size of ten is a latent defect the T3 track should expose'],
    licenceNote: 'Apache-2.0; redistributable'
  },
  {
    id: 'github-actions:canboat/canboatjs/.github/workflows/test_canboat_changes.yml', priority: 'B',
    why: 'Maintainer\'s cross-repo compatibility check for the canboat NMEA 2000 PGN database: on dispatch, check out canboat.json, ts-pgns, canboatjs and ten downstream Signal K packages, build and test each with always(), and report which broke. Niche (marine electronics), failure-tolerant fan-out.',
    constructs: ['event trigger with inputs', 'ordered builds with links', 'continue after failure (always())', 'status fan-in report'],
    tasks: { T1: 'feasible with tapes', T2: 'feasible with tapes', T3: 'feasible: parallel downstream tests, clearer report' },
    oracle: {
      kind: 'mocked-execution with tapes',
      files: ['/opt/corpus/github-actions/raw/canboat__canboatjs@504490a138d5615cb389c4e6ab42d4971552bbad/.github/workflows/test_canboat_changes.yml'],
      plan: 'Build/test outcomes per repository replayed from tapes for scenarios (all pass, generate fails in ts-pgns, one downstream fails, missing branch). Pass = dependency order respected, downstream steps still run after an earlier failure, final status and the list of failing repositories correct.',
      pass: 'all scenarios'
    },
    controls: { original: 'runnable', originalHow: 'workflow steps executed with checkout/npm replaced by tape stubs', broken: ['stop at first failure', 'skip downstream when canboatjs fails'] },
    mocks: ['git checkout tapes', 'npm build/test tapes'], acquisition: [], effortHours: 8,
    risks: ['the real job (building thirteen repositories) is not reproduced; the oracle judges orchestration semantics only'],
    licenceNote: 'Apache-2.0; redistributable'
  },
  {
    id: 'temporal:samples-go/shoppingcart', priority: 'B',
    why: 'Vendor sample kept as a calibration control: it ships an executable Go test (add/remove/invalid updates, checkout) for a long-lived entity workflow, so R-bench can check that its event-sequence harness reproduces a known-correct result. Reported separately from the niche items.',
    constructs: ['update handlers (events)', 'validation with rejection', 'entity state', 'terminal signal'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'limited' },
    oracle: {
      kind: 'test-profile ported to a scenario tape',
      files: [
        '/opt/corpus/temporal/extracted/github.com/temporalio/samples-go@v1.3.1-0.20261002171058-aaf79b672b32/shoppingcart/workflow.go',
        '/opt/corpus/temporal/extracted/github.com/temporalio/samples-go@v1.3.1-0.20261002171058-aaf79b672b32/shoppingcart/workflow_test.go'
      ],
      plan: 'Port each RegisterDelayedCallback update to an event; pass = returned cart state after each update, rejection of "invalid" with the exact error text, final cart at checkout.',
      pass: 'test-equivalent'
    },
    controls: { original: 'heavy', originalHow: 'go test ./shoppingcart (Go toolchain and module download; optional)', broken: ['invalid action accepted', 'remove below zero'] },
    mocks: [], acquisition: [], effortHours: 5,
    risks: ['vendor sample, not niche', 'updates need the signal-wait extension; the harness stands in with one run per event and external state'],
    licenceNote: 'Apache-2.0 per corpus item; redistributable'
  },
  {
    id: 'dagster:data-quality-patterns', priority: 'B',
    why: 'Vendor example kept as a calibration control for table-in/report-out jobs: synthetic data generator, Python validators, asset checks and freshness checks with a shipped pytest suite.',
    constructs: ['data generation', 'parallel checks', 'check aggregation'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'feasible: one-pass validation' },
    oracle: {
      kind: 'test-profile',
      files: [
        `${C}/dagster/dagster-io__dagster@8ed0d4d398c8bb2ed82049d272abab6747aeb391/examples/data-quality-patterns/tests/test_validators.py`,
        `${C}/dagster/dagster-io__dagster@8ed0d4d398c8bb2ed82049d272abab6747aeb391/examples/data-quality-patterns/tests/test_asset_checks.py`,
        `${C}/dagster/dagster-io__dagster@8ed0d4d398c8bb2ed82049d272abab6747aeb391/examples/data-quality-patterns/src/data_quality_patterns/lib/validators.py`
      ],
      plan: 'Seeded datasets with injected defects (nulls, out-of-range values, duplicates, stale timestamps). Pass = per-check pass/fail and counts equal to the original validators run in-process.',
      pass: 'all checks equal on >= 19/20 seeds'
    },
    controls: { original: 'heavy', originalHow: 'pytest in a pinned venv; the Great Expectations checks may need a heavy dependency (partial)', broken: ['inclusive/exclusive threshold swapped', 'duplicates counted per row instead of per key'] },
    mocks: [], acquisition: ['pinned dagster venv for the original control'], effortHours: 6,
    risks: ['vendor sample', 'GE dependency weight'],
    licenceNote: 'Apache-2.0; redistributable'
  },
  // ------------------------------------------------------------------ automation
  {
    id: 'n8n:12679', priority: 'A',
    pilot: 'automation that needs mocks (two stateful SaaS systems)',
    why: 'Community-built two-way contact sync between Zoho CRM and the KlickTipp email-marketing tool: five entry points (three Zoho webhooks, two KlickTipp triggers), segment switches, single vs double opt-in, delete propagation, cross-linked IDs, opt-out mirroring, and a guard that only processes changes made by UI users so the sync does not echo forever.',
    constructs: ['five triggers', 'loop-prevention guard', 'segment routing (switch)', 'create/update/delete per side', 'raw HTTP calls next to connector nodes'],
    tasks: {
      T1: 'feasible: definition read from rawPath at task time (not committed)',
      T2: 'feasible: written intent + example events',
      T3: 'feasible: idempotent upserts, fewer API calls, explicit conflict rule'
    },
    oracle: {
      kind: 'mocked-execution (state invariants + effect trace)',
      files: ['/opt/corpus/n8n/workflows/12679.json.gz'],
      plan: 'In-memory stateful mocks of both systems (contacts, tags, the Zoho-ID custom field in KlickTipp, KlickTipp_ID and Email_Opt_Out in Zoho). The harness turns every mock-side change into the matching trigger event, tagged with origin (UI user or API), and runs the candidate once per event until quiescence (at most 20 runs). 15 scripted scenarios. Pass = state invariants (each in-segment subscribed Zoho contact has exactly one KlickTipp subscriber with matching email/name/phone and both IDs cross-linked; deletions propagated; opt-out mirrored; tags per segment), no echo loop (API-origin events never processed), no duplicate creates in the trace.',
      pass: '15/15 scenarios'
    },
    controls: { original: 'transcribed', originalHow: 'n8n nodes call fixed vendor endpoints and the KlickTipp node is a community package, so the original cannot run offline; a reference re-implementation written node by node from the JSON stands in (labelled weaker)', broken: ['UI-user guard removed (echo loop)', 'SOI and DOI swapped', 'delete not propagated'] },
    mocks: ['Zoho CRM v3 contacts (get/create/update/delete, add_tags, bulk PUT)', 'KlickTipp subscribers (get/create/update/delete/tag)', 'webhook and trigger events'],
    acquisition: [], effortHours: 14,
    risks: ['n8n ToS: the definition stays in /opt/corpus and is read at task time; only our fixtures are committed', 'mock semantics are authored from the definition itself, so invariants are kept semantic rather than API-shaped', 'triggers and cross-run state are harness stand-ins'],
    licenceNote: 'ToS n8n self-serve terms; not redistributable (fixtures are our own work)'
  },
  {
    id: 'n8n:20281', priority: 'A',
    pilot: 'model calls (narrow, gradable classification)',
    why: 'Support-operations automation: Gmail and Outlook intake normalised to one shape, internal and automated senders filtered before spending tokens, an LLM classifier with an enum schema (customer request, category, priority, confidence), low confidence routed to a human review queue, Jira dedupe by JQL then comment or create, Slack/Teams notifications, configurable acknowledgement (off/draft/send), audit log, error workflow, all dispatched through a self-calling sub-workflow router.',
    constructs: ['two polling triggers', 'pre-filter before model', 'structured model judgement', 'confidence gate to human review', 'dedupe then create-or-comment', 'mode switch', 'sub-workflow dispatch', 'error workflow'],
    tasks: {
      T1: 'feasible: the self-call router maps to inlined branches or call',
      T2: 'feasible: written intent + 10 example emails with outcomes',
      T3: 'feasible: same routing and accuracy with a cheaper model or fewer calls; cost is recorded'
    },
    oracle: {
      kind: 'mocked-execution + labelled judgement',
      files: ['/opt/corpus/n8n/workflows/20281.json.gz'],
      plan: '80 synthetic labelled emails (fictional company and products, both provider shapes): 15 internal/no-reply, 10 duplicates of open tickets, 10 deliberately ambiguous. Labels frozen before any run, two-annotator check. Pass = (a) deterministic routing exact: filtered senders get no model call and no ticket, duplicates comment on the right open key, every ambiguous or below-threshold email reaches the review queue; (b) category accuracy >= 0.85 and priority accuracy >= 0.80 on non-filtered emails; (c) acknowledgement mode honoured. Model calls and cost are recorded per run.',
      pass: '(a) and (c) exact, (b) thresholds met'
    },
    controls: { original: 'transcribed', originalHow: 'vendor endpoints and credentials; reference re-implementation plus the labels', broken: ['everything classified as Bug', 'no dedupe', 'acknowledgement sent in draft mode'] },
    mocks: ['Gmail (trigger, reply, draft)', 'Outlook (trigger, reply)', 'Jira (JQL search, create, comment)', 'Slack', 'Teams webhook', 'Google Sheets append'],
    acquisition: [], effortHours: 16,
    risks: ['label quality decides the oracle; freeze labels and thresholds first', 'n8n ToS', 'self-calling sub-workflow needs call or inlining'],
    licenceNote: 'ToS n8n; not redistributable'
  },
  {
    id: 'n8n:19463', priority: 'B',
    why: 'SRE-built mobile observability router: Alertmanager webhook, resolved short-circuit, fingerprint dedupe with cooldown in Postgres, alert-storm rate limit, source classification, a tool-calling RCA agent (client telemetry, Prometheus, deployments, past-incident search) with output validation, escalation policy, ticket create vs comment on repeats, error trigger with dead-letter row and platform alert, scheduled heartbeat.',
    constructs: ['webhook trigger with response', 'dedupe and rate limit (cross-run state)', 'agent with tools', 'output validation gate', 'escalation switch', 'error workflow', 'schedule heartbeat'],
    tasks: {
      T1: 'feasible: agent tools become fetch tasks or agent.tools',
      T2: 'feasible',
      T3: 'feasible: fetch evidence deterministically, one cheap classification call'
    },
    oracle: {
      kind: 'mocked-execution + labelled judgement',
      files: ['/opt/corpus/n8n/workflows/19463.json.gz'],
      plan: '20 scripted alert sequences with telemetry fixtures in which the root cause is determinable (deploy then crash spike, backend 5xx, flapping). Pass = escalation trace exact (page only for critical or flapping; ticket created once, commented on repeats; storm notice instead of per-alert RCA above the rate; resolved closes the incident; dead-letter row and platform alert when a tool fails) and RCA class/severity correct on >= 80%.',
      pass: 'trace exact, judgement >= 0.8'
    },
    controls: { original: 'transcribed', originalHow: 'reference re-implementation', broken: ['no cooldown (duplicate pages)', 'page on every alert'] },
    mocks: ['Postgres tables incidents/workflow_health_log/dead_letter_events (in memory)', 'Slack', 'PagerDuty', 'ClickUp', 'email', 'APM, Prometheus and CI/CD HTTP tools', 'vector search'],
    acquisition: [], effortHours: 18,
    risks: ['agent tool loop is not native', 'scenario authoring cost', 'n8n ToS'],
    licenceNote: 'ToS n8n; not redistributable'
  },
  {
    id: 'n8n:17541', priority: 'B',
    why: 'Hobby investor\'s tracker: every 45 minutes fetch the SEC EDGAR Form 4 feed (with a declared User-Agent), enrich each filing from its ownership XML, scrape the House disclosure page to the current-year ZIP, parse the periodic-transaction index and PDFs, merge both sources, dedupe against a sheet and within the run, apply a recency gate against first-run spam, append rows, email each new filing.',
    constructs: ['schedule trigger', 'two source branches merged', 'archive and document parsing', 'dedupe against external state', 'recency gate', 'per-item email'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'feasible: incremental fetch, robust parsing' },
    oracle: {
      kind: 'mocked-execution (multi-run)',
      files: ['/opt/corpus/n8n/workflows/17541.json.gz'],
      plan: 'Fixtures with fictional filers in the real formats: EDGAR Atom feed and Form 4 XML, House landing HTML, ZIP with XML index, PTR text (PDF extraction offered as a capability returning text), sheet state. 10 multi-run scenarios (empty sheet, repeats, stale filings, malformed XML). Pass = appended rows and emails are exactly the new recent filings with correct amounts, tickers and transaction types; no duplicates across runs.',
      pass: 'all scenarios'
    },
    controls: { original: 'transcribed', originalHow: 'reference re-implementation', broken: ['recency gate dropped', 'dedupe only within the run'] },
    mocks: ['HTTP (EDGAR, House clerk site)', 'scraping proxy node', 'PDF text extraction capability', 'Google Sheets', 'Gmail'],
    acquisition: [], effortHours: 14,
    risks: ['fixture realism for EDGAR/House formats is authored by us', 'PDF parsing reduced to a text capability', 'use fictional filers only', 'n8n ToS'],
    licenceNote: 'ToS n8n; not redistributable'
  },
  {
    id: 'n8n:19295', priority: 'B',
    why: 'A dental practice\'s treatment-recovery routine: daily, read the patient and procedure sheets, decide per unscheduled treatment whether to send a first or second reminder or escalate to the front desk for a call (by days unscheduled and value), update stage and contact date; weekly owner summary of recovered vs still-unscheduled value.',
    constructs: ['two schedule triggers', 'join two sheets', 'staged decision rule', 'per-item email and row update', 'weekly aggregate'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'feasible: batch updates, explicit idempotence' },
    oracle: {
      kind: 'mocked-execution (virtual clock)',
      files: ['/opt/corpus/n8n/workflows/19295.json.gz'],
      plan: 'Virtual-clock run over 21 days of seeded sheet fixtures with fictional patients. Pass = exact sequence of reminder emails, escalations and row updates, and the weekly summary numbers.',
      pass: 'trace and summaries exact'
    },
    controls: { original: 'transcribed', originalHow: 'reference re-implementation', broken: ['escalation before the second reminder', 'summary over the wrong window'] },
    mocks: ['Google Sheets (read, update rows)', 'Gmail send', 'clock'], acquisition: [], effortHours: 6,
    risks: ['health-adjacent: synthetic data only, no patient operations', 'simple logic, low judgement', 'n8n ToS'],
    licenceNote: 'ToS n8n; not redistributable'
  },
  {
    id: 'n8n:18122', priority: 'B',
    why: 'Error-workflow pattern: on any workflow failure, dedupe by execution id in workflow static data, post to Slack, fall back to Discord when Slack fails. Small, but it exercises an error trigger, a fallback branch and cross-run state.',
    constructs: ['error trigger', 'cross-run dedupe state', 'fallback on failed effect'],
    tasks: { T1: 'feasible from a redacted copy', T2: 'feasible', T3: 'feasible: bounded state, retry before fallback' },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/n8n/workflows/18122.json.gz (contains credential-shaped webhook URLs: use only a redacted copy)'],
      plan: 'Scripted failure events (repeated execution ids, Slack 500 and timeout, both channels down). Pass = exactly one notification per execution id, Discord only when Slack failed, the notified-id store stays bounded.',
      pass: 'all scenarios'
    },
    controls: { original: 'transcribed', originalHow: 'reference re-implementation', broken: ['notify twice', 'never fall back'] },
    mocks: ['Slack webhook', 'Discord webhook', 'error-trigger event', 'workflow static data'], acquisition: [], effortHours: 4,
    risks: ['the raw source embeds Slack and Discord webhook URLs that look like live credentials: never copy them into tasks, fixtures or reports; T1 prompts use a redacted copy; tell the owner', 'n8n ToS'],
    licenceNote: 'ToS n8n; not redistributable'
  },
  {
    id: 'n8n:11805', priority: 'B',
    why: 'E-commerce recovery sequence: webhook, cart and customer history, abandonment-reason heuristics, personalised offers, then waits of 1 h, 4 h, 24 h and 48 h with order checks in between, email then SMS then email then WhatsApp plus retargeting, a high-value alert and attribution logging.',
    constructs: ['webhook trigger', 'long durable waits', 'check-then-act after each wait', 'segment rules', 'multi-channel effects', 'attribution fan-in'],
    tasks: { T1: 'feasible with the durable-wait stand-in', T2: 'feasible', T3: 'feasible: stop early, fewer status calls' },
    oracle: {
      kind: 'mocked-execution (virtual clock)',
      files: ['/opt/corpus/n8n/workflows/11805.json.gz'],
      plan: 'Scenarios in which the order completes before each stage, never, or the cart is high value. Pass = the touchpoint trace stops at the right stage, discount codes follow the segment rules, attribution rows and the Slack alert only above the threshold.',
      pass: 'all scenarios'
    },
    controls: { original: 'transcribed', originalHow: 'reference re-implementation', broken: ['no order check after a wait', 'message sent after purchase'] },
    mocks: ['Shopify order get', 'cart and customer APIs', 'SendGrid', 'Twilio', 'WhatsApp', 'Facebook Graph', 'Google Sheets', 'Slack', 'clock'],
    acquisition: [], effortHours: 10,
    risks: ['waits up to 48 h exceed the IR wait cap of 1 h: needs durable-wait or harness time skipping', 'template-like structure, so niche-ness is moderate', 'n8n ToS'],
    licenceNote: 'ToS n8n; not redistributable'
  },
  {
    id: 'n8n:16639', priority: 'B',
    why: 'A runner\'s personal training log: daily fetch Strava activities, classify zone-2 long runs and 5K tests by pace and elapsed time, format pace, place each into the right cell of a training-cycle sheet (cycle rows 2/6/10, five run columns) and skip already logged IDs.',
    constructs: ['schedule trigger', 'loop over activities', 'rule-based classification', 'cell placement in external state', 'merge'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'feasible: fix the zone-2 rule (see risks)' },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/n8n/workflows/16639.json.gz'],
      plan: 'Activity and sheet fixtures. Pass = exact cell updates. One scenario separates the author\'s evident intent (zone 2 = pace between 6.3 and 7.0 min/km) from the original expression, which chains comparisons in JavaScript ((6.3 <= pace) <= 7 is always true), so neither pace bound is enforced; T1 is graded for fidelity, T2/T3 for intent (frozen before runs).',
      pass: 'all scenarios for the graded mode'
    },
    controls: { original: 'transcribed', originalHow: 'reference re-implementation; the original itself fails the intent scenario (documented defect)', broken: ['chained comparison kept', 'already-logged IDs written again'] },
    mocks: ['Strava activities API', 'Google Sheets', 'clock'], acquisition: [], effortHours: 5,
    risks: ['small', 'intent must be frozen before runs', 'n8n ToS'],
    licenceNote: 'ToS n8n; not redistributable'
  },
  {
    id: 'node-red:a04546c46361167fd1d83aed8e4f22ec', priority: 'B',
    why: 'Home-solar owner\'s flow for the GivEnergy cloud API: register devices, keep serials in flow context, poll latest system and meter data, read 19 inverter registers per inverter, route by serial, throttle, and show about 40 values for two inverters. Boundary item: the corpus verdict is unsupported (interactive dashboard state).',
    constructs: ['inject timers', 'flow-context state', 'per-inverter routing', 'rate-limited HTTP', 'dashboard sinks'],
    tasks: { T1: 'partial: dashboard widgets become a JSON status product', T2: 'feasible as a data product', T3: 'feasible: one batched read per poll' },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/node-red/pages/page-010.json.gz#a04546c46361167fd1d83aed8e4f22ec'],
      plan: 'Mock GivEnergy v1 API (communication devices, system-data/latest, meter-data/latest, inverter settings read) and scripted polls. Pass = per-inverter status (field to value) equal to the expected one; values routed to the right inverter.',
      pass: 'all fields for both inverters'
    },
    controls: { original: 'heavy', originalHow: 'Node-RED and node-red-dashboard containers (pinned) pointed at the mock API', broken: ['inverter routing swapped', 'register map shifted by one'] },
    mocks: ['GivEnergy cloud API', 'flow context', 'inject schedule'], acquisition: ['public GivEnergy API documentation for fixture realism'], effortHours: 10,
    risks: ['licence unknown (flows.nodered.org): local use only', 'fixtures authored from the flow\'s own parsing are circular without the API docs', 'dashboard semantics are out of IR scope'],
    licenceNote: 'unknown; not redistributable'
  },
  // ------------------------------------------------------------------ consumer
  {
    id: 'home-assistant:CCOSTAN/Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml#0', priority: 'A',
    pilot: 'consumer (Home Assistant)',
    why: 'Carlo Costanzo\'s garbage-day reminder: debounced garage-open trigger (20 s), Wednesday and Sunday only, a shared snooze timer, an actionable push with 30-minute and 2-hour snooze buttons, inside speech, then Alexa announcements at +30, +90 and +180 s that stop as soon as the door closes, the day changes or a snooze starts. Restart mode means a snooze press also kills pending announcements.',
    constructs: ['state trigger with for: debounce', 'event triggers from notification actions (human step)', 'weekday and timer conditions', 'parallel effects', 'repeat with delays and in-loop conditions', 'restart concurrency mode'],
    tasks: {
      T1: 'feasible: YAML is MIT',
      T2: 'feasible: written intent + two example traces',
      T3: 'feasible: same trace with fewer timer checks; explicit cancellation instead of relying on restart mode'
    },
    oracle: {
      kind: 'mocked-execution (ordered service-call trace)',
      files: ['/opt/corpus/home-assistant/git/CCOSTAN__Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml'],
      plan: 'Home Assistant mock built once for all HA items: entity state machine, virtual clock, service registry that records calls, event bus. 14 scenarios: Monday open (nothing); Wednesday flapping under 20 s (nothing); Wednesday open and staying open (push + speech + three announcements at the exact offsets); door closes after the first announcement (one announcement); 30-minute snooze mid-sequence (timer.start 00:30:00, logbook entry, no further announcements, a new open within 30 minutes suppressed); Sunday 2-hour snooze; Wednesday message mentions recycling, Sunday does not. Pass = ordered trace equal (service, target, key data, time offset +-1 s).',
      pass: '14/14 scenarios'
    },
    controls: { original: 'heavy', originalHow: 'pytest-homeassistant-custom-component (pinned) with time travel and stub scripts gives a real original-passes control (about 6 h extra)', broken: ['debounce dropped', 'snooze ignored inside the repeat', 'announces on Monday'] },
    mocks: ['HA state machine and clock', 'script.notify_engine_two_button', 'script.speech_engine', 'script.send_to_logbook', 'notify.alexa_media_garage', 'timer'],
    acquisition: [], effortHours: 12,
    risks: ['HA semantics (a failed condition inside repeat stops the whole run; restart mode) must be written down precisely in the harness, the same semantics the candidate has to reproduce', 'Jinja templating'],
    licenceNote: 'MIT (Copyright 2018 Carlo Costanzo); redistributable'
  },
  {
    id: 'home-assistant:CCOSTAN/Home-AssistantConfig/config/packages/llmvision.yaml#automation/1', priority: 'B',
    why: 'Front-door package detection: three triggers (person count, relock, manual button), delays of 3 min and 20 s, a rate limit from the last-run timestamp (15 min, or 5 min on relock and only if a package is already flagged), a cost-controlled vision call, tolerant normalisation of the model\'s on/off answer, bookkeeping, logbook and a manual-check notification.',
    constructs: ['three triggers with ids', 'trigger-specific delays', 'rate limit from stored state', 'model call via service with response', 'response normalisation', 'restart mode'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'feasible: fewer vision calls at equal detection' },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/home-assistant/git/CCOSTAN__Home-AssistantConfig/config/packages/llmvision.yaml'],
      plan: 'HA mock plus a scripted vision-analyzer capability whose answers include "On.", "yes, a box", "unknown" and empty. Pass = vision calls only when allowed (count and cost recorded), correct boolean transitions, set_value/set_datetime/logbook/notify trace.',
      pass: 'all scenarios'
    },
    controls: { original: 'heavy', originalHow: 'pytest-HA with a stub llmvision service', broken: ['rate limit dropped', '"no" treated as on'] },
    mocks: ['llmvision.stream_analyzer (scripted)', 'camera', 'lock', 'person-count sensor', 'scripts'], acquisition: [], effortHours: 8,
    risks: ['the vision judgement itself is scripted (no images), so model quality is not measured here'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'home-assistant:CCOSTAN/Home-AssistantConfig/config/packages/tesla_model_y.yaml#script/tesla_home_charge_protect', priority: 'B',
    why: 'Safety script for home EV charging: snapshot from a custom charge-guard integration, a condition over excessive/unverified/restart-required states, verification-timestamp arithmetic, alert flags, and a parallel block (stop charging only if allowed, urgent notification, Alexa warning) in which every branch continues on error.',
    constructs: ['service call with response', 'guard condition', 'timestamp arithmetic', 'parallel branches with continue_on_error', 'single mode'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'feasible: explicit outcome record per branch' },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/home-assistant/git/CCOSTAN__Home-AssistantConfig/config/packages/tesla_model_y.yaml'],
      plan: '12 charge-guard snapshot fixtures with injected service failures. Pass = flags and timestamps set exactly; stop attempted iff stop_allowed; notifications sent even when the switch call fails; nothing happens for charging_safe without the restart flag.',
      pass: '12/12'
    },
    controls: { original: 'heavy', originalHow: 'pytest-HA with a stub tesla_charge_guard', broken: ['continue_on_error dropped (notification lost when the switch fails)', 'stop when not allowed'] },
    mocks: ['tesla_charge_guard.snapshot', 'switch', 'script.notify_engine', 'notify.alexa_media_garage', 'input helpers'], acquisition: [], effortHours: 6,
    risks: ['the custom component\'s response shape is known only from this YAML'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'home-assistant:TheFes/HA-configuration/packages/00-general/energy/start_washingmachine.yaml#automation/0', priority: 'B',
    why: 'A Dutch power user\'s automation that schedules the washing machine at the cheapest window given dynamic energy prices and the chosen programme\'s energy profile, number of washes, an end-time limit and an only-today switch; it then starts the machine remotely (waking it from sleep), notifies, and resets helpers at midnight.',
    constructs: ['time, state and template triggers', 'optimisation over a price curve', 'branch per trigger id', 'device command sequence', 'event to set a sensor', 'parallel mode'],
    tasks: { T1: 'feasible after acquiring the cheapest_energy_hours macro', T2: 'feasible', T3: 'feasible: fix the reset branch (see oracle)' },
    oracle: {
      kind: 'independent optimum + mocked-execution',
      files: ['/opt/corpus/home-assistant/git/TheFes__HA-configuration/packages/00 general/energy/start_washingmachine.yaml'],
      plan: 'The oracle brute-forces the cost of every feasible start on a 15-minute grid over the price curve and programme profile within [now, end]. Pass = the chosen start is optimal (ties allowed), notification date logic correct, start branch only when the remote flag is on and the machine status allows it, wake before start when asleep. The reset branch tests trigger id reset_helpers while the triggers declare helper_reset, so the midnight reset never runs; the T3 track must fix it (a scenario checks the 00:00 reset).',
      pass: 'optimal start on all price curves; reset scenario for T3'
    },
    controls: { original: 'heavy', originalHow: 'pytest-HA after acquiring the macro; the original fails the reset scenario (documented defect)', broken: ['earliest start instead of cheapest', 'washes count ignored'] },
    mocks: ['price sensor attributes', 'energy_plots sensor', 'select.wasmachine_operation', 'notify', 'counters and helpers'],
    acquisition: ['TheFes cheapest-energy-hours macro at a pinned revision (licence to check)'], effortHours: 10,
    risks: ['licence unknown (no LICENSE in the repo): local use only', 'macro semantics (weights, split windows) are intricate', 'Dutch notification strings'],
    licenceNote: 'unknown; not redistributable'
  },
  {
    id: 'home-assistant:basnijholt/home-assistant-config/automations/apple_watch.yaml#5', priority: 'B',
    why: 'A two-level Apple Watch menu: an iOS action opens an actionable notification for the room, waits at most 20 s, then a second menu for the light action (off, on, 50%, 100%, 1%, white, cozy), maps the choices to light groups and service calls; the notify target comes from the source device; parallel mode.',
    constructs: ['event trigger', 'two human steps with timeouts', 'dynamic service target', 'choice-to-action mapping', 'parallel mode'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'feasible: correlate answers to the asking device' },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/home-assistant/git/basnijholt__home-assistant-config/automations/apple_watch.yaml'],
      plan: 'Scripted notification-action events (answers, timeout, answers out of order, two watches at once). Pass = correct light calls per answers, nothing after a timeout, and concurrent runs do not consume each other\'s answers. The original listens to global events in parallel mode, so it cross-talks (documented defect; T1 graded for fidelity, T3 for the fix).',
      pass: 'all scenarios for the graded mode'
    },
    controls: { original: 'heavy', originalHow: 'pytest-HA', broken: ['continue after timeout', 'hall mapped to one light only'] },
    mocks: ['notify.mobile_app_*', 'light services', 'event bus'], acquisition: [], effortHours: 5,
    risks: ['human steps simulated by scripted answers', 'small mapping job'],
    licenceNote: 'MIT; redistributable'
  },
  {
    id: 'apple-shortcuts:workflowllm-seed-06844', priority: 'B',
    why: 'Events Overview v1.3 by Alex Sotirakis (RoutineHub): today\'s and tomorrow\'s calendar events with a per-event weather forecast, optional reminders, a temperature-unit setting, choose-from-list event details, then a menu to show the event in Calendar or get directions in Apple or Google Maps; 52 actions with menus and loops.',
    constructs: ['date arithmetic', 'loops over events', 'per-event lookups', 'human menus and lists', 'sub-shortcut calls', 'device effects'],
    tasks: { T1: 'feasible from the WorkflowLLM transcription', T2: 'feasible', T3: 'feasible: one forecast fetch per day instead of per event' },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/apple-shortcuts/workflowllm/data.zip#seed_data.json[6844]'],
      plan: 'Mock device APIs (calendar with fixed events, reminders, location, hourly forecast, maps) and scripted user choices. Pass = rendered list text (order, time format, weather per event, unit) and the effect of the chosen path (directions request to the right app with the event location; nothing on cancel).',
      pass: 'all scenarios'
    },
    controls: { original: 'transcribed', originalHow: 'iOS only; a reference re-implementation from the transcription stands in', broken: ['tomorrow\'s events dropped', 'wrong temperature unit'] },
    mocks: ['calendar', 'reminders', 'location', 'weather', 'maps', 'notification', 'menu answers'], acquisition: [], effortHours: 10,
    risks: ['WorkflowLLM converted the original plist into Python-like code with model-written comments, so the definition is lossy', 'per-shortcut author terms not checked (dataset is Apache-2.0)', 'locale and date formats must be frozen'],
    licenceNote: 'Apache-2.0 (dataset); original author terms unverified'
  },
  {
    id: 'apple-shortcuts:workflowllm-seed-10733', priority: 'B',
    why: 'Identify a song with Shazam or ask for title and artist, look it up in iTunes, build a lyrics.ovh URL with word-by-word encoding loops, fetch the lyrics, handle not-found, and render HTML with text replacements.',
    constructs: ['menu (human step)', 'external lookups', 'loops building an encoded URL', 'not-found branch', 'document rendering'],
    tasks: { T1: 'feasible from the transcription', T2: 'feasible', T3: 'feasible: one encoding call, better not-found handling' },
    oracle: {
      kind: 'mocked-execution',
      files: ['/opt/corpus/apple-shortcuts/workflowllm/data.zip#seed_data.json[10733]'],
      plan: 'Mocks for the Shazam result or scripted ask answers, iTunes search and lyrics.ovh. Pass = correct URL encoding of artist and title (spaces, ampersands, accents), not-found path, rendered HTML equal after replacements. Lyrics fixtures are invented text.',
      pass: 'all scenarios'
    },
    controls: { original: 'transcribed', originalHow: 'iOS only', broken: ['no URL encoding', 'crash on not-found'] },
    mocks: ['Shazam', 'iTunes Search API', 'lyrics.ovh', 'ask/menu answers', 'preview'], acquisition: [], effortHours: 7,
    risks: ['lossy transcription', 'copyrighted lyrics: fixtures use invented text', 'small'],
    licenceNote: 'Apache-2.0 (dataset); original author terms unverified'
  },
  // ------------------------------------------------------------------ agentic (ledgers in /var/tmp/foundry-work/corpus-agentic/)
  {
    id: 'google-adk:adk-samples/core/python/ambient-expense-agent/expense_agent/agent.py', priority: 'B',
    why: 'Event-driven expense approval: a Pub/Sub message is parsed and routed by an amount threshold; small amounts are auto-approved; larger ones go to an LLM reviewer that raises a structured alert through a tool, then the run pauses for a manager to approve or reject, and the decision is logged. The google-adk ledger records a defect: a malformed message becomes amount 0 and reaches the auto-approve node, which then indexes a missing key.',
    constructs: ['webhook-style trigger', 'threshold router in code', 'model review with a tool', 'human approval pause', 'log'],
    tasks: { T1: 'feasible', T2: 'feasible', T3: 'feasible: malformed messages rejected, not auto-approved' },
    oracle: {
      kind: 'mocked-execution + labelled judgement',
      files: [
        '/opt/corpus/agentic/google-adk/adk-samples/core/python/ambient-expense-agent/expense_agent/agent.py',
        '/opt/corpus/agentic/google-adk/adk-samples/core/python/ambient-expense-agent/tests/conftest.py',
        '/opt/corpus/agentic/google-adk/adk-samples/core/python/ambient-expense-agent/tests/test_integration.py'
      ],
      plan: '30 synthetic expense events (fictional), scripted manager decisions. Pass = routing by threshold exact, review alert fields (category, risk flags) correct on >= 80% against frozen labels, approvals and rejections logged, malformed messages flagged (T3).',
      pass: 'routing exact, judgement >= 0.8'
    },
    controls: { original: 'heavy', originalHow: 'pytest tests/test_integration.py with the canned model in conftest.py (pinned google-adk venv; optional)', broken: ['auto-approve everything', 'threshold inclusive/exclusive swapped'] },
    mocks: ['Pub/Sub push', 'alert tool', 'manager approval (human node)', 'log sink'], acquisition: ['pinned google-adk venv for the original control'], effortHours: 8,
    risks: ['vendor sample, less niche', 'small graph'],
    licenceNote: 'Apache-2.0; redistributable'
  },
  {
    id: 'google-adk:adk-samples/contrib/python/small-business-loan-agent/app/agent.py', priority: 'C',
    why: 'Small-business loan workflow: a status tool, then document-extraction, underwriting and pricing specialists as agent tools, a user approval pause and a decision specialist; hooks persist per-step state and halt later steps on flagged issues.',
    constructs: ['supervisor with agent tools', 'per-step state', 'halt rule', 'human approval', 'decision'],
    tasks: { T1: 'feasible with restructuring', T2: 'feasible', T3: 'feasible: deterministic underwriting rules in code, model only for extraction' },
    oracle: {
      kind: 'labelled judgement + shipped unit expectations',
      files: [
        '/opt/corpus/agentic/google-adk/adk-samples/contrib/python/small-business-loan-agent/app/agent.py',
        '/opt/corpus/agentic/google-adk/adk-samples/contrib/python/small-business-loan-agent/tests/unit/test_tools_logic.py'
      ],
      plan: 'Synthetic applications (fictional businesses, documents as text) with known facts. Pass = key extracted numbers exact, risk tier and halt decisions per the decision table in tests/unit/test_tools_logic.py, pricing outputs per rule, approval pause honoured; generated explanations are not graded.',
      pass: 'numbers and decisions exact on >= 90% of applications'
    },
    controls: { original: 'heavy', originalHow: 'pytest tests/unit (pure helpers) in a pinned venv', broken: ['halt table inverted', 'dollar parsing of "1.2M" wrong'] },
    mocks: ['Firestore state', 'document store', 'human approval'], acquisition: ['pinned google-adk venv'], effortHours: 12,
    risks: ['vendor sample', 'README evalset absent in the pinned tree', 'agent tool loop not native'],
    licenceNote: 'Apache-2.0; redistributable'
  }
];

// ---------------------------------------------------------------------------------------------
const REJECTED = [
  ['comfyui (all)', 'needs GPUs and model weights; outputs are images without a cheap independent oracle'],
  ['ifttt (all)', 'closed services; applet internals not inspectable; ToS'],
  ['zapier, activepieces templates', 'vendor-authored template catalogues rather than user-built workflows; ToS'],
  ['coze (all)', 'platform test fixtures, not user workflows'],
  ['COVERAGE.md section 8 vendor items (Dify recommended apps, Flowise and Langflow starters, Airflow provider system tests, Argo and KFP examples)', 'vendor templates; kept only as calibration candidates, two of which (Temporal, Dagster) are in the set'],
  ['dify:mkt-89b63325-acec-4965-ae17-2013ef6f0029 (EUDR Evidence Studio)', 'niche and hand-built, but its core is a proprietary geospatial plugin service whose responses we would have to invent'],
  ['dify:mkt-b5155008-5aee-4efc-9afb-a2f55146bd72 (exam grader)', 'vision over photographed exam papers; no fixtures'],
  ['n8n:12174 (construction cost estimator)', 'niche and hand-built, but needs the DDC CWICR rate database in a vector store plus embeddings; chat session over Telegram'],
  ['github-actions:z3prover/z3 release-notes-updater.lock.yml', 'compiled gh-aw file; the prompt (.md) it imports was not acquired, so the intent is missing'],
  ['github-actions:agadmator-library load-new-videos.yml', 'the job lives in repository TypeScript that was not acquired'],
  ['github-actions:mlocati monitor-php8.5.yml', 'the job is building PHP extensions in Docker for six distros'],
  ['galaxy:iwc pathogen-detection aggregation', 'phylogeny steps (clustalw, fasttree) and a single reference output'],
  ['snakemake:kircherlab/MPRAsnakeflow', 'scripts and test data absent from the sparse clone; consortium standard rather than niche'],
  ['cwl, wdl items', 'no local tests, aligner-heavy, test inputs on gs:// or s3://'],
  ['node-red Pollenwarnung', 'a few gauges over one public JSON; too small']
];

// ---------------------------------------------------------------------------------------------
const sha256File = p => createHash('sha256').update(readFileSync(p)).digest('hex');
function rawPin(item) {
  const raw = item.source.rawPath ?? '';
  let file = raw.split('#')[0];
  if (MAIN_FILE[item.id]) file = path.join(file, MAIN_FILE[item.id]);
  const fragment = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : null;
  if (!file || !existsSync(file)) return { file, fragment, sha256: null, note: 'raw file missing' };
  if (statSync(file).isDirectory()) return { file, fragment, sha256: null, note: 'directory without a main file mapping' };
  return { file, fragment, sha256: sha256File(file) };
}

const readJsonl = p => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const corpus = new Map(readJsonl(ITEMS).map(x => [x.id, x]));
if (!existsSync(AGENTIC)) throw new Error(`agentic ledger items missing: ${AGENTIC}`);
for (const x of readJsonl(AGENTIC)) corpus.set(x.id, x);

const items = A.map((a, i) => {
  const x = corpus.get(a.id);
  if (!x) throw new Error(`unknown corpus item ${a.id}`);
  const f = x.features;
  return {
    rank: i + 1, id: a.id, platform: x.source.platform, cluster: CLUSTER[x.source.platform], title: x.title,
    priority: a.priority, pilot: a.pilot ?? null,
    source: { url: x.source.url, revision: x.source.revision, retrievedAt: x.source.retrievedAt, license: x.source.license,
      redistributable: x.source.redistributable, rawPath: x.source.rawPath, rawPin: rawPin(x) },
    shape: { nodes: f.nodeCount, edges: f.edgeCount, branching: f.branching, loops: f.loops, humanSteps: f.humanSteps,
      modelCalls: f.hasModelCalls, code: f.hasCode, async: f.async ?? [], subworkflows: f.subworkflows, irVerdict: x.ir.verdict,
      corpusOracle: x.oracle.kind },
    why: a.why, constructs: a.constructs, tasks: a.tasks, oracle: a.oracle, controls: a.controls, mocks: a.mocks,
    acquisition: a.acquisition, effortHours: a.effortHours, risks: a.risks, licenceNote: a.licenceNote
  };
});

// ---------------------------------------------------------------------------------------------
// Selection rules (fail loudly).
const problems = [];
const count = (k, v) => items.filter(it => it[k] === v).length;
if (items.length < 28 || items.length > 32) problems.push(`expected about 30 items, got ${items.length}`);
if (new Set(items.map(it => it.id)).size !== items.length) problems.push('duplicate ids');
for (const c of ['science', 'orchestration', 'automation', 'consumer-creative']) if (count('cluster', c) < 5) problems.push(`cluster ${c} has fewer than 5 items`);
// Pilot order for the report: science, automation with mocks, model calls, consumer, owner's choice.
const PILOT_ORDER = ['galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting', 'n8n:12679', 'n8n:20281',
  'home-assistant:CCOSTAN/Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml#0',
  'github-actions:shafthq/shaft_engine/.github/workflows/update-selenium-grid-versions.yml'];
const pilots = items.filter(it => it.pilot).sort((a, b) => PILOT_ORDER.indexOf(a.id) - PILOT_ORDER.indexOf(b.id));
if (pilots.some(it => !PILOT_ORDER.includes(it.id))) throw new Error('pilot missing from PILOT_ORDER');
for (const it of items) it.pilotSlot = it.pilot ? `P${PILOT_ORDER.indexOf(it.id) + 1}` : null;
if (pilots.length !== 5) problems.push(`expected 5 pilots, got ${pilots.length}`);
const need = [
  ['science with shipped test data', it => it.cluster === 'science' && it.controls.original === 'shipped-outputs'],
  ['automation needing mocks', it => it.cluster === 'automation' && it.mocks.length > 0 && !/model/.test(it.pilot)],
  ['model calls', it => it.shape.modelCalls && /model/.test(it.pilot)],
  ['consumer', it => it.cluster === 'consumer-creative']
];
for (const [name, ok] of need) if (!pilots.some(ok)) problems.push(`no pilot satisfies: ${name}`);
for (const it of items) {
  if (!it.oracle.files.length) problems.push(`${it.id}: no oracle files`);
  if (!it.controls.broken.length) problems.push(`${it.id}: no broken control`);
  if (!it.source.rawPin.sha256) problems.push(`${it.id}: raw not pinned (${it.source.rawPin.note})`);
}
const out = JSON.stringify({ schema: 'foundry-replicate-selection/1', created: '2026-10-08', status: 'development/diagnostic selection; nothing frozen, nothing run', items }, null, 1);
// Credential-shaped strings must never appear in outputs (n8n:18122's raw source holds webhook URLs).
if (/hooks\.slack\.com\/services\/|discord(app)?\.com\/api\/webhooks\/|xox[abp]-|ghp_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}/.test(out)) problems.push('credential-shaped string in output');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

mkdirSync(path.dirname(OUT_JSON), { recursive: true });
writeFileSync(OUT_JSON, out + '\n');

// ---------------------------------------------------------------------------------------------
// SELECTION.md
const esc = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
const short = it => it.id.length > 58 ? it.id.slice(0, 55) + '...' : it.id;
const totalHours = items.reduce((s, it) => s + it.effortHours, 0);
const byCluster = Object.entries(items.reduce((m, it) => (m[it.cluster] = (m[it.cluster] ?? 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(', ');
const byPriority = ['A', 'B', 'C'].map(p => `${p} ${count('priority', p)} (${items.filter(it => it.priority === p).reduce((s, it) => s + it.effortHours, 0)} h)`).join(', ');
const ctl = { 'shipped-outputs': 'shipped outputs', runnable: 'runnable offline', heavy: 'heavy (containers/venv)', transcribed: 'transcribed reference' };

let md = `# R-bench selection: niche workflows to replicate (2026-10-08)

*Development/diagnostic selection. Nothing here is frozen, compiled into Foundry IR, or run; no oracle exists yet. Generated by
\`node experiments/replicate/build-selection.mjs\` from the annotations in that script plus corpus metadata
(\`research/corpus-20261006/items.jsonl\`, agentic ledgers in \`/var/tmp/foundry-work/corpus-agentic/\`). Machine-readable twin:
\`experiments/replicate/selection.json\` (each raw source pinned by sha256).*

## 1. What R-bench is

The owner's idea (2026-10-08): take workflows that users spent real effort hand-building, see whether Foundry can cheaply recreate
them and do the same job, and see what could be improved. Each selected workflow yields up to three tasks:

- **T1 translate:** given the original definition, produce an equivalent Foundry workflow.
- **T2 rebuild from intent:** given only the author's description and example inputs/outputs, build something that does the job.
- **T3 improve:** the same job, cheaper, faster or more reliable. Several items carry a documented defect in the original
  (marked below); T3 is graded on the author's evident intent, T1 on fidelity.

Every task is judged by an executable oracle on hidden scenarios, independent of how the workflow was built, with two controls:
the original (or, where it cannot run, a labelled reference re-implementation) must pass, and item-specific broken controls must fail.

## 2. How items were chosen

Inputs: the 1,342-item corpus (\`research/corpus-20261006/\`), its 30-item pilot shortlist (COVERAGE.md section 8), the IR gaps in
\`research/review-20261007/02-ir-expressiveness.md\`, the current IR (\`skills/micro-harness/references/ir.md\`, \`operators.md\`) and
the agentic ledgers. For each candidate the raw source under \`/opt/corpus/\` was opened and checked for: shipped test data and expected
outputs, mockable external effects, determinism of the job, heavy dependencies (GPUs, large containers, proprietary services:
rejected), and licence.

Preferences, in order: (1) hand-built by a user for a specific need (personal configs, lab pipelines, community submissions, maintainer
bots) over vendor templates; (2) an executable oracle that does not depend on how the job is done; (3) mid-to-high complexity;
(4) construct diversity (triggers, waits, human steps, error handling, sub-workflows, loops, model calls, cross-run state).

The COVERAGE.md shortlist was **not** reused as is: 18 of its 30 items are vendor templates or examples (Dify recommended apps,
Flowise/Langflow starters, Airflow provider system tests, Argo/KFP/Temporal samples), and most of the other 12 (CWL, Galaxy, Snakemake,
WDL) need aligner-class tools with remote test data. Two vendor samples with shipped tests are kept as calibration controls (Temporal
shopping cart, Dagster data quality) and reported separately. n8n contributes 8 of 30 items and Home Assistant 5, above COVERAGE's cap
of 3 per platform, on purpose: n8n's community library and personal HA configurations are where hand-built automations live.

Result: ${items.length} items (${byCluster}); priorities ${byPriority}; total estimated effort ${totalHours} h.
Original controls: ${Object.entries(items.reduce((m, it) => (m[it.controls.original] = (m[it.controls.original] ?? 0) + 1, m), {})).map(([k, v]) => `${ctl[k] ?? k} ${v}`).join(', ')}.

## 3. The five pilots to harness first

| # | role | item | oracle in one line |
| --- | --- | --- | --- |
`;
const pilotLine = {
  'galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting': 'run on the shipped VCF (AF 0.05, DP 1, DP_ALT 10); the four report tables must match the shipped test-data tables, plus 20 seeded multi-sample variants scored by a reference implementation that first reproduces the shipped outputs.',
  'n8n:12679': 'stateful in-memory Zoho CRM and KlickTipp mocks; each mock-side change becomes a trigger event; after 15 scripted scenarios the cross-system state must satisfy the sync invariants with no echo loop and no duplicate creates.',
  'n8n:20281': '80 frozen, labelled synthetic support emails through Gmail/Outlook/Jira/Slack mocks: routing, dedupe, review queue and acknowledgement mode exact; category accuracy >= 0.85 and priority >= 0.80; model calls and cost recorded.',
  'home-assistant:CCOSTAN/Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml#0': 'Home Assistant mock (state machine, virtual clock, service recorder, event bus); 14 scripted door/day/snooze scenarios; the ordered service-call trace with time offsets must equal the expected one.',
  'github-actions:shafthq/shaft_engine/.github/workflows/update-selenium-grid-versions.yml': 'authored reference-compose fixtures; the edited selenium4.yml must be byte-equal to the expected edit and a PR opened iff something changed; the original bash steps run as the real original-passes control.'
};
pilots.forEach((it, i) => { md += `| P${i + 1} | ${esc(it.pilot)} | \`${it.id}\` | ${esc(pilotLine[it.id])} |\n`; });
md += `
Why these five:

- **P1 science** has everything local: workflow, input VCF and four reference outputs produced by the original. It also tests whether
  Foundry code nodes can replace a chain of 31 Galaxy text-tool steps without a Galaxy server.
- **P2 automation** forces the mock layer R-bench needs for most automation items: stateful SaaS mocks, a harness that turns effects
  into trigger events, and invariant-based oracles. Its loop-prevention guard is the kind of hard-won detail a rebuild tends to miss.
- **P3 model calls** has a narrow, gradable judgement (enum classification with a confidence gate) inside deterministic plumbing, so
  capability and cost of cheap executors can be measured against frozen labels instead of a judge model.
- **P4 consumer** builds the Home Assistant mock once (the four other HA items reuse it) and covers human steps (actionable notifications),
  debounce, timers, in-loop conditions and restart concurrency.
- **P5 (choice)** adds the orchestration cluster and is the only pilot whose original runs offline unchanged (bash with a curl shim and
  a PR recording stub), so the "original passes" control is real rather than transcribed. It is cheap (about 6 h) and checks the control
  machinery before the expensive items depend on it.

## 4. Selection table

Effort is hours to build fixtures, oracle, controls and the bed wrapper for one item (estimate). Controls: S = shipped outputs from the
original, R = original runnable offline, H = original runnable with containers or a pinned venv inside the D5 cap, T = transcribed reference only.

| # | id | platform | cluster | prio | why it is a good replication target | oracle plan (exact files) | mocks | h | ctl | risks | licence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
`;
const ctlCode = { 'shipped-outputs': 'S', runnable: 'R', heavy: 'H', transcribed: 'T' };
for (const it of items) {
  const files = it.oracle.files.map(f => `\`${f.replace('/opt/corpus/', '')}\``).join(', ');
  md += `| ${it.rank} | \`${esc(short(it))}\`${it.pilot ? ` **(${it.pilotSlot})**` : ''} | ${it.platform} | ${it.cluster} | ${it.priority} | ${esc(it.why)} | ${esc(it.oracle.plan)} Files: ${esc(files)}. Pass: ${esc(it.oracle.pass)}. | ${esc(it.mocks.join('; ') || 'none')} | ${it.effortHours} | ${ctlCode[it.controls.original] ?? '?'} | ${esc(it.risks.join('; '))} | ${esc(it.licenceNote)} |\n`;
}
md += `
File paths in the table are relative to \`/opt/corpus/\` unless they name another repository at a pinned revision (\`owner/repo@sha:path\`,
still to acquire). Full ids, URLs, revisions, sha256 pins, task feasibility (T1/T2/T3), constructs, broken controls and acquisition needs
are in \`selection.json\`.

## 5. Documented defects in originals (T3 targets)

These come from reading the sources; none was confirmed by execution.

- \`n8n:16639\`: the zone-2 rule \`6.3 <= pace <= 7\` is a chained comparison in JavaScript; \`(6.3 <= pace) <= 7\` is always true, so neither pace bound is enforced.
- \`home-assistant:TheFes/.../start_washingmachine.yaml\`: the reset branch tests trigger id \`reset_helpers\`, the trigger declares \`helper_reset\`; the midnight helper reset never runs.
- \`home-assistant:basnijholt/.../apple_watch.yaml#5\`: parallel mode with \`wait_for_trigger\` on global notification events lets concurrent runs consume each other's answers (inferred from the YAML).
- \`google-adk ambient-expense-agent\`: a malformed message becomes amount 0 and is routed to auto-approve, which indexes a missing key (from the google-adk ledger).
- \`prefect merge_dependabot_pull_requests\`: its docstring says it queries ten pull requests per repository; a re-run would comment \"@dependabot merge\" again (inferred, not checked against prefect-github).

## 6. Fit with the bed contract and the runner

R-bench families follow \`beds/CONTRACT.md\`: \`generate\` (seeded; the prompt carries the original definition for T1, the description and
example I/O for T2, the T2 material plus baseline cost/latency for T3), \`oracle\`, \`referenceSolve\`, \`badControls\`
(empty, corrupted, and the item's plausible-but-wrong broken controls above). The output is a Foundry workflow; the oracle validates it,
runs it per hidden scenario with mock capabilities registered in a \`CapabilityRegistry\` and a virtual clock, and compares outputs and
effect traces. Deviations to settle with the owner before building:

1. **Oracle runtime.** Running a candidate workflow takes seconds to minutes, not the contract's < 2 s. Proposal: a per-scenario budget
   (60 s) and executor-side sandboxing, recorded as a contract extension for replication beds.
2. **Loader.** \`experiments/lib/beds.mjs\` loads only \`beds/<id>/index.mjs\` or sealed beds. \`beds/\` and \`experiments/lib/\` are
   frozen for the running experiments, so R-bench families will live in \`experiments/replicate/beds/<family>/\` and need either a
   one-line re-export per family under \`beds/\` after the freeze lifts, or a thin runner shim in \`experiments/replicate/\`.
3. **Judgement requirement.** Several items are deliberately script-solvable (P5, the dental and Strava items). They measure replication
   fidelity and control machinery, not judgement, and are reported separately from judgement-bearing items.
4. **Contamination.** Originals are public by design (T1 needs them). Hidden scenarios, labels and fixtures are fresh and fictional.
5. **Triggers, waits, human steps.** Foundry has no triggers; as in COVERAGE.md section 8, each trigger event becomes one run, external
   state lives in the mocks, delays use a virtual clock, and human answers come from the scenario script.

## 7. Licence and safety handling

- ${items.filter(it => it.source.redistributable).length} of ${items.length} items are redistributable (MIT, Apache-2.0). n8n items are under
  n8n's terms of service, the Node-RED flow and TheFes' configuration have no licence: their definitions stay in \`/opt/corpus/\` and are
  read at task-generation time with a sha256 check; only our fixtures, labels and oracles are committed.
- \`n8n:18122\`'s raw source embeds Slack and Discord webhook URLs that look like live credentials. They were not copied anywhere; any T1
  prompt must use a redacted copy, and the owner may want to know they are public in that template.
- Health-adjacent and finance-adjacent items (dental reminders, insider trades, loans, expenses) use fictional people and companies only.
  No real third-party service is called; every external effect is a mock.
- Shortcuts definitions are WorkflowLLM transcriptions (Python-like code with model-written comments), not the original plists.

## 8. Rejected after inspection

| candidate | reason |
| --- | --- |
${REJECTED.map(([c, r]) => `| ${esc(c)} | ${esc(r)} |`).join('\n')}

## 9. Next steps

1. Build the shared mock kit once: HTTP fixture server, stateful SaaS mocks, Home Assistant mock, virtual clock, tool-tape replayer.
2. Harness P1 to P5: fixtures, reference solutions, broken controls, oracle health tests (determinism, controls pass/fail on >= 20 seeds,
   no truth leakage). Freeze scenarios, labels, tolerances and budgets before any comparative run.
3. Acquire what the B and C items need (pinned): nf-core test-datasets files, reportho \`bin/\`, the pooled-PCR scripts and reads, the
   selenium4.yml file, the cheapest-energy-hours macro, Nextflow and container digests.
4. Run the baseline arms (frontier builder vs cheap builder vs plain script) on T1/T2/T3 of the pilots and report a capability number.
`;
mkdirSync(path.dirname(OUT_MD), { recursive: true });
writeFileSync(OUT_MD, md);
console.log(`wrote ${path.relative(root, OUT_JSON)} (${items.length} items, ${pilots.length} pilots, ${totalHours} h) and ${path.relative(root, OUT_MD)}`);
