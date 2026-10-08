# R-bench item: Generic variation analysis reporting (IWC, Galaxy)

`galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting`, pilot P1 in `research/replicate-20261008/SELECTION.md`.
Harness built 2026-10-08; adversarially verified the same day by a second agent, which changed the battery (family **version 2**, see
"Adversarial verification" and "Known limits" at the end). **Status: development/diagnostic harness. Nothing here is a sealed evaluation.** The `test`
split is frozen (`fixtures/frozen-battery.json`) but was authored by the agents that wrote the oracle, so a sealed run needs a battery written by someone else.

## The job, in the author's terms

Wolfgang Maier's IWC workflow (v0.1.1, MIT, 35 steps, 31 tool-shed tool steps) takes a **collection of per-sample VCFs** from any IWC variant-calling
workflow and three numbers, and publishes tabular reports: "tabular lists of variants by Samples and by Variant". The numbers are the minimum
allele frequency (`AF Filter`, default 0.05), minimum depth at the site (`DP Filter`, default 1) and minimum depth of reads supporting the variant
(`DP_ALT Filter`, default 10). The workflow flags every record that fails one of the three tests by appending a label such as
`min_af_0.05Xmin_dp_1Xmin_dp_alt_10` to the FILTER column, extracts a table per sample (adding an allele frequency recomputed from the read counts),
keeps the highest-impact effect per variant, stacks all samples, and builds a by-variant report and a combined report. Four of its published outputs
are tested by the author and judged here:

| table | one per | what it is | order |
| --- | --- | --- | --- |
| `af_recalculated` | sample | every extracted record (one row per predicted effect) plus `AFrecalc = round((DP4[2]+DP4[3])/DP, 6)` | VCF order |
| `all_variants_all_samples` | job | all samples stacked (`Sample` column first), highest-impact effect only, `AF` = recalculated, `AFcaller` = the caller's, `change`, `change_with_pos` | sample, then VCF order |
| `by_variant_report` | job | one row per variant that passes in at least one sample: sample counts, min/max AF, sample lists | numeric POS |
| `combined_variant_report` | job | every row of every position that passes in at least one sample, with per-position AF range and counts | Sample, then numeric POS |

The flag test (taken from the `##FILTER=<ID=SnpSift,...>` line of the shipped VCF and from steps 5 and 7 of the .ga):
`(DP4[2]+DP4[3]) < AF*DP | DP < dp | AF_caller*DP < dp_alt - 0.5`, evaluated per record, and the label is **appended again** to a FILTER value that already carries it.
Records with `DP < 1` never reach the tables (step 4, `DP >= 1`).

## What T1, T2 and T3 give the solver

All three are scored on the same hidden battery (below), so results are comparable. Everything supplied is data, not instructions.

| task | solver gets (`generate({taskType})`) | goal |
| --- | --- | --- |
| T1 translate | `original/Generic-variation-analysis-reporting.ga`, `original/...-tests.yml`, the job interface, a note on which tool-shed tools it uses | an equivalent Foundry workflow |
| T2 rebuild | `description.md` (the author's annotations and output labels, nothing else), three small worked examples `examples/example-N/` (job.json, sample VCFs, the four expected tables, which the prompt says were computed by the re-implementation because the original cannot run here) | the same job from intent. The examples differ in thresholds, one has raw and two have pre-flagged inputs, one has multi-effect records; all carry the v2 probes (a DP=0 record, a multi-allelic site) |
| T3 improve | the T1 material plus a target in `budget.target`: at most 8 nodes, 0 model calls, 2000 ms per job | the same tables, cheaper and faster. Tables are judged first; cost and latency count only for a solution whose tables are right |

The worked examples come from their own random stream (`dev`), never from the evaluation battery. Test `T2 sufficiency` checks that every fault the
oracle can detect is visible in at least one example for seeds 1 to 5, so a T2 failure is not a failure to read information that was never given.
The shipped test job and its four tables are public in the IWC repository (MIT); a solver with web access or a memorised copy can look them up.
The derived cases are new.

## Job interface

```
Job:    { params: { af: number, dp: integer, dp_alt: integer }, samples: [ { id, vcf: "<file text>" }, ... ] }   // collection order = array order, ids ascending
Result: { af_recalculated: { <sampleId>: tsv }, all_variants_all_samples: tsv, by_variant_report: tsv, combined_variant_report: tsv }
```

A candidate is any function `(job) -> result`, or an external command that reads the job as JSON on stdin and prints the result as JSON
(`candidate.mjs`, the same contract as a Foundry `code` node). The host runs it on every job from `evalInputs(task)` and passes
`{ cases: { <caseId>: result } }` (optionally `meta: { nodes, modelCalls, wallMs }`, recorded but never judged) to `oracle(task, output)`.
The host passes a candidate only `inputs`, never the case id or kind (the shipped job is public, so a candidate that could recognise it by name could hard-code it).

Untrusted text: the supplied files (the author's annotations, the .ga, VCF INFO text) are copied from a public repository and are data. This item adds
no injected instructions of its own; nothing in the task text asks a solver to do anything but the job.

## Layout

```
README.md            this file
index.mjs            beds/CONTRACT.md surface: family, outputSchema, generate, oracle, referenceSolve, badControls
                     + evalInputs, originalControls, diagnose, runCandidate, corpusItem
tasks.mjs            prompts, files and budgets of T1/T2/T3 (author description is read from the .ga, not retyped)
cases.mjs            the shipped case and the seeded derived cases; worked examples
oracle.mjs           judge: truth, health gate, pass rule      compare.mjs  exact / strict / diff6 table comparison
reference.mjs        labelled reference implementation of the job (also the source of truth for derived cases) + fault injection
original-emulator.mjs  executes the real .ga step by step with emulated tool-shed tools      miniexpr.mjs  the two expression dialects it needs
formats.mjs          Python / Java / printf number formatting      controls.mjs  pass and fail controls
candidate.mjs        external-command candidates      reference-cli.mjs  the reference as such a command
freeze.mjs           freezes / checks the canonical battery      run-controls.mjs  prints the control matrix
item.test.mjs        27 node:test tests      independent-solve.mjs  the verifier's own implementation with fault knobs (tests only)
fixtures/original/   the .ga, its test outline, README, CHANGELOG (MIT)        fixtures/shipped/  input VCF and the four expected tables
fixtures/PROVENANCE.md  URL, commit, sha256, licence, acquisition outcome       fixtures/frozen-battery.json  hashes of the canonical battery
```

## External calls and mocks

None. The job is a pure file-to-tables transform: no network, no service, no clock, no randomness. There is therefore nothing to mock and no
recorded response to ship. (Galaxy, the tool-shed and the container registries are not called either; see "Original control".)
The task statement tells candidates to run offline, and the oracle never inspects how a candidate was built.

## Oracle

`oracle(task, output)` is deterministic and recomputes its truth from `(seed, split, difficulty)`. It never trusts `output` beyond its value.

* **Cases.** `shipped` (the author's test job: one real sample, AF 0.05, DP 1, DP_ALT 10, truth = the four tables the original run shipped) and
  `derived-00` to `derived-19` (truth = `reference.mjs`). Derived cases are labelled `derived` everywhere. Each resamples and perturbs the shipped
  records into 2 to 5 samples (5 cases each), draws shifted thresholds (15 of 20 differ from the defaults), mixes raw and pre-flagged inputs, and from
  odd indices injects multi-effect records (10 of 20), whose effect lists are in SnpEff's order (highest impact first, v2). Every case also carries 4 to
  6 hand-built records that sit exactly on or next to a decision boundary (alt reads exactly `AF*DP`; `AF*DP` exactly `dp_alt-0.5`; only the AF test
  fires; only the variant-depth test fires; depth below / at the DP threshold), built only where double arithmetic, division and exact arithmetic agree,
  and ordinary records are kept clear of float-rounding ambiguity. Since v2 every case (and every worked example) also carries two probes from their own
  random stream: a `DP=0` record that only step 4 removes, and a multi-allelic site (two SNVs at one POS, both passing, different FUNCLASS). The AF
  threshold of the 15 shifted cases is stratified (0.02, 0.1, 0.2, 0.25 and 0.05, three cases each). Difficulty 1 to 5 scales the number of variants per
  case (18, 40, 90, 160, 280); level 3 is the plan's setting.
* **Levels per table.** `exact` (text equal after normalising CRLF and trailing blank lines), `strict` (same header, same multiset of rows, rows in the
  order the original's own sorts define; ties inside a sort key are free because the original leaves them to GNU sort), `diff6` (Galaxy's shipped
  `lines_diff: 6` criterion, computed with a minimal line diff).
* **Pass.** All four tables strict on the shipped case **and** on at least 18 of 20 derived cases (`PASS_RULE`). `score` = strict cases / 21.
  `details` also reports exact and diff6 counts, the failed case ids and the first failure.
* **Health gate (AGENTS.md: an invalid evaluator blocks claims).** Before any verdict, `evaluatorHealth()` checks that the reference reproduces the
  shipped tables byte for byte. If it ever does not, `oracle` returns `pass:false` with `evaluatorInvalid`.
* **Schema.** A non-object output, a missing `cases`, a case whose `af_recalculated` is not an object or whose other tables are not strings, a missing
  or extra collection element, and a missing case all fail that case.

## Controls (seed 1, split test, difficulty 3; `node run-controls.mjs 1 test 3`)

**Original control: the .ga cannot run here, so it is emulated.** Checked in this container on 2026-10-08: `planemo`, `galaxy`, `datamash`, `SnpSift`
and `snpEff` are not on PATH; `java` 21 and `perl` exist but there is no SnpSift/SnpEff jar; `docker` has a client but
`failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running: dial unix /var/run/docker.sock: connect: no such file or directory`.
Installing the tool-shed tools or a Galaxy server from the corpus or the network was out of bounds for this task (no installs from corpus sources,
no real third-party calls). Two stand-ins, both labelled:

1. **Shipped tables.** The shipped case is answered with the tables the original Galaxy run produced (the author's own test data). This is the only
   place the real original's output is used.
2. **`.ga` emulator** (`original-emulator.mjs`). Reads `fixtures/original/*.ga` and executes its 35 steps in order. Every parameter, regex, column list,
   expression and sort key comes from the .ga at run time; only the tool-shed tools themselves are re-implemented. It reproduces all four shipped tables
   byte for byte and agrees with `reference.mjs` byte for byte on all 21 cases of seeds 1, 2 and 3 (`item.test.mjs`). A test edits one step inside the
   .ga and shows the output changes, and that an unknown tool or an unsupported join type is refused rather than guessed.

| control | verdict | shipped | derived strict / exact / diff6 (of 20) |
| --- | --- | --- | --- |
| reference | **PASS** | strict | 20 / 20 / 20 |
| original (shipped tables + .ga emulator) | **PASS** | strict | 20 / 20 / 20 |
| empty (`{cases:{}}`) | fail | fail | 0 / 0 / 0 |
| do-nothing (right headers, no rows) | fail | fail | 0 / 0 / 0 |
| echo-input | fail | fail | 0 / 0 / 0 |
| shipped-case-only (hard-coded answer) | fail | strict | 0 / 0 / 0 |
| shuffled-rows | fail | fail | 0 / 0 / 0 |
| one-corrupted-cell | fail | fail | 0 / 0 / 20 |
| mutation: AF test `<=` instead of `<` (the plan's "> instead of >=") | fail | strict | 0 / 0 / 20 |
| mutation: DP_ALT term dropped (the plan's "recalculation dropped") | fail | fail | 0 / 0 / 3 |
| mutation: collapse keeps only the first sample | fail | strict | 0 / 0 / 0 |
| mutation: AF and AFcaller swapped | fail | fail | 0 / 0 / 0 |
| mutation: POS sorted as text | fail | fail | 0 / 0 / 1 |
| mutation: ignore the input's FILTER, recompute it | fail | fail | 0 / 0 / 0 |
| mutation: one row per effect (no highest-impact collapse) | fail | strict | 10 / 10 / 10 |
| mutation: combined report not sorted | fail | strict | 0 / 0 / 0 |
| mutation: DP test `<=` instead of `<` | fail | strict | 15 / 15 / 15 |
| mutation: step 4 prefilter (`DP >= 1`) skipped, division guarded (v2) | fail | strict | 0 / 0 / 20 |
| mutation: by_variant_report grouped by POS instead of POS:REF>ALT (v2) | fail | strict | 0 / 0 / 20 |
| mutation: combined_variant_report statistics per variant instead of per POS (v2) | fail | strict | 0 / 0 / 12 |
| dedupe-filter-label (a plausible "improvement") | fail | fail | 15 / 15 / 15 |
| CRLF endings and no header | fail | fail | 0 / 0 / 20 |

Further pass and fail checks with a second, independently written solution (`independent-solve.mjs`, by the verifier) are in `item.test.mjs`
("an independently written solution passes ..."): the faithful version and a "keep the highest-impact effect" reading pass; label printed as
`min_af_0.10`, prefilter skipped, by-POS grouping, per-position counts fixed at 1, min/max or sample counts over PASS rows only, combined report with
PASS rows only, and combined report sorted POS-first all fail.

What the matrix shows: eight faults are invisible on the shipped job and are caught only by derived cases (the single shipped sample cannot expose
multi-sample, boundary or multi-effect behaviour); the shipped criterion `lines_diff 6` accepts a corrupted cell, a table with its header missing and the
AF-boundary fault on all 20 derived cases, which is why the primary criterion is stricter. `dedupe-filter-label` fails on purpose: the doubled label is
observable behaviour of the original (457 + 10 shipped rows carry it) and the oracle treats the published tables as the specification, so a T3
"cleanup" that changes them is a different job. Sweep: the reference passes and every bad control fails for 20 seeds at difficulty 3 and for seed 3 at
difficulties 1, 2, 4 and 5 (`item.test.mjs`); the original control passes for seeds 1 to 5 at difficulty 3.

Limits: generate and oracle each under 2 s and 200 MB at difficulty 5, measured cold in a fresh process by the test (here: generate 24 ms; oracle 0.5 s; heap 48 MB, RSS 160 MB).

## Unverified semantics (what the shipped data cannot confirm)

The reference and the emulator share one reading of the tools, so their agreement catches coding errors, not a misreading. Confirmed by the shipped tables
(single sample, 595 records, no multi-effect record): the flag test and its append/duplicate behaviour, `DP >= 1` prefilter outcome, AF printed as a Java float
(`1.000000` -> `1.0`), empty FUNCLASS printed as `NONE`, `AFrecalc` Python float formatting, datamash `%.14g` min/max, `GroupBy(...)` header handling,
join column order, both sorts. **Not** confirmed, and therefore labelled `derived`:

1. **Multi-effect records.** Modelled as: one row per effect in EFF order (vcfEffOnePerLine), consecutive identical records collapsed with commas
   (datamash, no sort), the regex of step 11 keeping the first value of each effect column. No shipped record has two effects. 10 of 20 derived cases
   contain them; a reading error here would fail those cases for every faithful solver. Since v2 the generated effect lists are in SnpEff's order
   (impact HIGH > MODERATE > LOW > MODIFIER, stable inside one impact). Evidence: SnpEff documents this order for ANN; for the classic EFF format, all
   321 multi-effect records in the seven SnpEff-annotated IWC SARS-CoV-2 test VCFs under `/opt/corpus/galaxy/iwc/workflows/sars-cov-2-variant-calling/`
   are in it, but none of them mixes impacts, so the order across impacts is a documentation claim, not an observation.
2. **More than one sample.** The Collapse Collection tool, joins across samples, `unique(Sample)` and the per-position statistics are modelled from the
   tool wrappers. Collections are generated in ascending id order, with ids of identical shape (`filtered variants ERR<7 digits>`), so C-locale and
   locale-aware sorting, and stable and last-resort tie-breaking inside datamash, all give the same result. Other collection orders are not covered.
3. **Ties.** The original leaves the order of rows with equal sort keys to GNU sort; the oracle accepts any order inside a tie (the reference breaks
   ties on the whole line). Not verifiable offline.
4. **Records outside the shipped shapes**: `DP` missing (DP 0 is covered since v2: the original drops it at step 4), FILTER `.`,
   multi-allelic ALT in one record (`A,G`; two records at one POS are covered since v2), adjacent duplicate records (step 10 merges them; the reference
   does so too since the verification, but no case contains one), AF below 0.001 (Java would print scientific notation), DP so large that `AFrecalc` is below 1e-4 (Python would print `5e-05`). The
   formatting helpers implement the Python rules, but no case exercises them. All 990 001 six-decimal AF values in [0.01, 1] print identically under shortest
   float32 and shortest double, so AF input type does not matter for generated data.
5. **Pass rule tolerance.** 18 of 20 lets a fault that affects at most two derived cases pass. The boundary mutants above fail 5 to 20 cases; a subtler
   fault might not. See "Known limits" for one that does (rounding at exact binary ties).
6. The `collapse_dataset` header label `Sample` is read from the shipped tables, not from the tool.

## Observations about the original (inputs to T3)

* The workflow description promises "an overview plot of variants and their allele-frequencies"; the .ga has no plot step. It publishes
  `variants_for_plotting` (step 30) for a downstream plot. A T2 solver reading the description will not find the plot's data layout in the examples.
* The flag step only ever **adds** a label. Input already flagged at the default thresholds (as the shipped VCF is) cannot be loosened by lowering the
  parameters, and the same label is appended a second time on every re-flagged record. Both are visible in the shipped tables.
* `DP4[2]+DP4[3]` against `AF*DP` is a read-count test, while the DP_ALT test uses the caller's AF times DP minus 0.5; the two can disagree (shipped row POS 803:
  caller AF 0.888889, recalculated 1.0). The README of the workflow says nothing about either.
* 35 steps (4 inputs and 31 tools: 6 datamash, 5 find-and-replace, 4 joins, 3 Compute, 3 Cut, 2 SnpSift filters, 2 sorts, 2 compose-text, 1 each of extract, filter, collapse, split) for what one pass over the rows computes; a Galaxy server is required.
  T3's target (8 nodes, 0 model calls, 2 s) is a design choice, not a measured optimum.
* The shipped criterion `lines_diff: 6` tolerates a corrupted data row in a 596-line table (see the `one-corrupted-cell` row above).

## Run

```
node --test experiments/replicate/items/galaxy-iwc-variation-reporting-generic-variation-analysis-reporting/item.test.mjs   # 27 tests, 55 to 105 s depending on machine load
node experiments/replicate/items/galaxy-iwc-variation-reporting-generic-variation-analysis-reporting/run-controls.mjs 1 test 3
node experiments/replicate/items/galaxy-iwc-variation-reporting-generic-variation-analysis-reporting/freeze.mjs          # compare with the frozen battery
```

## Freezing

`fixtures/frozen-battery.json` hashes the canonical battery (seed 1, split test, difficulty 3): every case's inputs, every expected table and the three
task texts. The suite fails on any drift. Changing the generator, the reference or the prompts requires `node freeze.mjs --write`, a note in this file and
a new family `version`; results from before the change are then a different experiment.

Version history: **v1** (builder, 2026-10-08) battery sha256 `7be1411810b6db0ad34b62941a3456de3a41078675a3c4e614273de450b24eca`; **v2** (adversarial verification, 2026-10-08) battery sha256
`bd2cf296a67c9d2996d7fef77067b91d65eb4ca1025dcf973b9db59218a91c8b`. v2 changed the derived cases and worked examples (SnpEff-ordered effect lists,
zero-dp and multi-allelic probes, stratified AF) and the T2 prompt wording; the shipped case and the reference's output on every v1 input are unchanged.
No solver had been run on v1.

## Plugging into `experiments/lib/runner.mjs`

The task object has the shape `beds.mjs` renders (`prompt`, `inputs`, `files`; `solverView` and `inlineRender` work on it) and the module exports every
name `loadFamily` checks. It does not load through `loadFamily` or `runExperiment`, which resolve families only under `beds/<id>/index.mjs` or `beds/sealed/`;
`experiments/lib` was frozen for this task, so no loader hook was added. A three-line registry lookup in `loadFamily` (family id starting `replicate-` ->
`experiments/replicate/items/<safe-id>/index.mjs`) is all that is missing.

## Adversarial verification (2026-10-08)

A second agent tried to break the oracle in both directions, fixed what it could inside this folder and re-froze the battery as family v2. Raw outputs
of the attack runs are in `/var/tmp/foundry-work/replicate/verify-galaxy-vr/` (scratch, not committed). All checks below are development evidence.

**Correct solutions the v1 oracle wrongly failed (over-specification).** The verifier wrote its own implementation from the .ga (`independent-solve.mjs`);
it passed v1 on 20 of 20 seeds, so the oracle is not tied to the reference's incidental choices. One correct reading did fail: keeping the
**highest-impact** effect of a multi-effect record (what step 11's label `highest_impact_effects` and the description say) instead of the **first**
listed one (what the regex does) failed 10 of 20 derived cases on every seed (0 of 20 seeds passed). On SnpEff output the two are the same job, because
SnpEff lists effects highest impact first; v1's derived records listed randomly chosen effects in random order, which no SnpEff run produces. Fixed: derived
and example effect lists are now in SnpEff order (stable inside one impact). The highest-impact reading now passes 20 of 20 seeds; "keep the first" still
is the only right answer among equal-impact effects, which is the case in every real multi-effect record found in the corpus.

**Wrong solutions the v1 oracle passed.**

| wrong solution (variant of `independent-solve.mjs`) | v1: seeds passed of 20 | v2 | fix |
| --- | --- | --- | --- |
| skips step 4 (`DP >= 1`) | 20 (no case had DP < 1) | 0; fails 20 of 20 derived | DP=0 probe in every case and example; mutation `no-dp-prefilter` |
| groups by_variant_report by POS instead of POS:REF>ALT | 20 (only 1 case in 7 of 20 seeds had a passing multi-allelic site) | 0 | multi-allelic probe; mutation `variant-key-pos` |
| countunique(change) and countunique(FUNCLASS) per position fixed at 1 | 20 | 0 | same probe; mutation `combined-stats-by-variant` |
| AF threshold printed as `min_af_0.10` (two decimals) | 1 (seed 5: only 2 cases used AF 0.1 or 0.2) | 0 | AF stratified, each value in 3 shifted cases |
| AFrecalc rounded with `Math.round(x*1e6)/1e6` instead of Python's `round` | 20 | 20 | not fixed, see Known limits 1 |

Also checked and correctly failed (v1 and v2): min/max AF or sample count over PASS rows only, combined report with PASS rows only, combined report
sorted by POS before Sample, hard-coded shipped answer, every v1 bad control.

**Other checks.** Fixtures: sha256 of the .ga, test outline, README, CHANGELOG and the five test-data files equal the corpus copies under
`/opt/corpus/galaxy/iwc/workflows/variant-calling/variation-reporting/` and `PROVENANCE.md`. Leakage: T2 gets no workflow definition, no shipped table row,
no evaluation sample; worked examples come from their own random stream; candidates receive `inputs` only (`runCandidate`, `runCommandCandidate`).
Determinism: no `Math.random` or clock in the generator or oracle; no mocks exist because the job makes no external call. Network: no network
API is imported; the full suite also passes inside a network namespace with no route (`unshare -rn`, `fetch` fails with `EAI_AGAIN`). The new
reference equals the v1 reference on all 105 v1 inputs of seeds 1 to 5, for the faithful run and every v1 mutation. The .ga emulator agrees with the
reference byte for byte on 240 v2 inputs (seeds 1 to 5, both splits, battery plus examples). One reference fix outside the battery: adjacent duplicate
records are merged at step 10 like the emulator does (test added; no case contains one, so no expected table changed). The builder's note that
`git status` showed this folder's `reference.mjs` as modified did not reproduce: before these edits the folder matched the WIP snapshot commits.

## Known limits

1. **The 18-of-20 tolerance lets rare faults through.** Rounding `AFrecalc` with `Math.round(x*1e6)/1e6` differs from the original's Python `round`
   only at exact binary ties (1/128: original `0.007812`, naive `0.007813`). That happens in at most one derived case per seed (seeds 2 and 3 of 20), so
   this solution passes every seed. Any fault confined to at most two derived cases passes the same way; `score`, `details.failedCases` and the
   per-case detail from `diagnose` expose it. The rule is the plan's (SELECTION.md) and was kept; a tie probe in every case would make the rule bite, but
   it would also turn an incidental Python formatting choice into a required behaviour, which this verification did not want to decide alone.
2. **The original never ran.** The truth for derived cases is `reference.mjs`, cross-checked by an emulator of the .ga that shares its reading of the
   tools. Multi-effect handling, multi-sample collapse and joins, datamash sort and tie behaviour, and collection order are inferred from the tool
   wrappers ("Unverified semantics"). A misreading would fail every faithful solver on the affected cases.
3. **The effect order across impacts is a documentation claim.** The 321 real multi-effect records found in the corpus all share one impact, so no file
   here shows SnpEff ordering effects of different impacts. If SnpEff's classic EFF output is not impact-sorted, v2 no longer tells "first effect"
   apart from "highest-impact effect" on mixed-impact records (v1 did, on unrealistic input).
4. **Semantics no case exercises:** DP missing, FILTER `.`, multi-allelic ALT inside one record (`A,G`), adjacent duplicate records, AF below 0.001,
   `AFrecalc` below 1e-4, unsorted VCF records, collections not in ascending id order or with differently shaped sample ids.
5. **The probes are synthetic.** The DP=0 record (`DP=0;AF=0.000000;DP4=0,0,0,0`) is not something lofreq with `--min-cov 5` emits; it is there
   because the original's step 4 exists to remove it. The two records of the multi-allelic site each have DP4 summing to DP, and their effects are
   drawn from other variants.
6. **Candidate isolation is the runner's job.** This folder holds the reference, the oracle and the shipped tables, and the shipped job is public in
   the IWC repository (1 of 21 cases). A solver that can read `experiments/replicate/` or the web can copy truth. `runCommandCandidate` passes only
   `PATH` in the environment but does not sandbox the filesystem or the network; run candidates in an isolated task directory (AGENTS.md).
7. **T3 is judged on fidelity.** A T3 "cleanup" that stops the doubled FILTER label (`dedupe-filter-label`) fails by design, as the T3 prompt states.
   Grading T3 on the author's evident intent would need a second oracle mode with its own controls.
8. **Galaxy's shipped criterion is weak.** `lines_diff: 6` (`diff6`, reported, never judged) accepts the prefilter, POS-grouping and AF-boundary
   faults and a corrupted cell on all 20 derived cases.
9. **Licence evidence is the .ga's `license: MIT` field only.** The corpus checkout of the IWC repository has no LICENSE file and no copyright line, so
   no MIT notice text travels with the copies, and the test data is assumed to be under the same terms. Adequate for in-repo research use; check
   upstream before redistributing outside this repository.
10. **Not loadable by `experiments/lib/runner.mjs`** (see the section above), **not sealed**, and **no real T1, T2 or T3 solver has been run**.
