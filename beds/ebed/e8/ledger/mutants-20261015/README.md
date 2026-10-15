# E8 oracle mutants, evidence of 2026-10-15 (second revision)

Development and diagnostic evidence for `../MUTANTS.md` ($0, no model calls). Everything the ledger's 304 verdicts rest
on is here, except the corpus journals (about 400 MB), which `harness/corpus.mjs` rebuilds and `data/corpus-index.json`
fingerprints.

**Computed on** (git blob hashes, `git hash-object`): `transition.mjs` 86f211c1a441, `golden.mjs` 6b0e82d26d2c,
`test/unit-checks.mjs` 4585dfb33e16, `spec/SPEC-E.md` 18140b39d002, `tools/mutate.mjs` cf03dda42361. The measured
`tools/mutate.mjs` run started at commit 96e665a (an autosave snapshot of the working tree with these files).

## Files

| file | what |
|---|---|
| `harness/gen.mjs` | regenerates `tools/mutate.mjs`'s mutants of a transition (its operator set, read from `mutate.mjs`) into a directory, with `manifest.json` |
| `harness/gmatrix.mjs` | runs every golden and every unit check on every mutant: the golden × mutant matrix |
| `harness/corpus.mjs` | builds the 7-world corpus: both reference runs, every control, the specificity and `b1lh-e8` solvers (out of process, sandbox arm) |
| `harness/gdiff.mjs` | the corpus differential: every case of every journal graded by `gradeCase` under the original and the mutant |
| `harness/gwit.mjs`, `harness/consistent.mjs` | the witness search on golden inputs, with the host-consistency checks (carriers, the systems' refusals, no held-up report on an order with a customer cancel) |
| `harness/manual.mjs`, `harness/manual241.mjs` | hand-built witnesses (k77, k123, k241) |
| `harness/classify.mjs`, `harness/reasons.mjs`, `harness/table.mjs` | the verdict per mutant (MUTANTS.md §0), the one-line reasons, the ledger table |
| `data/manifest.json` | the 304 mutants (k, line, edit) of the current `transition.mjs` |
| `data/golden-matrix.jsonl` | per mutant: the goldens and the unit checks it fails (with the first failing message) |
| `data/wit-search-1.jsonl`, `data/wit-search-2.jsonl` | witness search results for every golden-failed mutant (`orig` and `mut` verdicts, the rows added) |
| `data/manual-witnesses.txt` | output of the hand-built witnesses on the current mutants |
| `data/gd-part1..4.jsonl` | corpus differential results for every mutant no golden fails (and k14, k221) |
| `data/classes.json` | the verdict and evidence per mutant |
| `data/corpus-index.json` | the corpus: per world, file hash, journals and their row counts, completed cases |
| `data/specificity-short.json` | the short specificity run after this revision (seeds 1241–1242 × d3, d5): 1,701/1,701 |
| `data/mutate-measured.json` | the measured `tools/mutate.mjs` run: killed, by kind, survivors with their edits |
| `data/mutate-measured.log` | its console output: 240/304 (golden 184, corpus 53, error 3), 64 survivors, exactly the ledger's equivalents |

The corpus was built during the first revision. Its reference journals do not depend on this revision's oracle changes:
regenerated for 1012:2 and 1009:3, both reference runs are identical row for row apart from the spec digest (SPEC-E's
text changed), because the reference policy emits only required lids and this revision adds permitted patterns and an
unreachable cut cause.

## Commands (from the repository root; `$W` is any scratch directory)

```sh
node beds/ebed/e8/ledger/mutants-20261015/harness/gen.mjs beds/ebed/e8/transition.mjs $W/new
node beds/ebed/e8/ledger/mutants-20261015/harness/corpus.mjs 1009:3:60,1010:5:60,1011:4:60,1012:2:60,2002:4:80,1013:5:60,1015:3:80 $W/corpus
node beds/ebed/e8/ledger/mutants-20261015/harness/gmatrix.mjs $W/new > $W/golden-matrix.jsonl
node beds/ebed/e8/ledger/mutants-20261015/harness/gwit.mjs $W/new <k,...> > $W/wit-search-1.jsonl      # golden-failed mutants
node beds/ebed/e8/ledger/mutants-20261015/harness/manual.mjs $W/new; node beds/ebed/e8/ledger/mutants-20261015/harness/manual241.mjs $W/new
node beds/ebed/e8/ledger/mutants-20261015/harness/gdiff.mjs $W/new <k,...> $W/corpus/<each>.json 3 > $W/gd-part1.jsonl   # mutants no golden fails
node beds/ebed/e8/ledger/mutants-20261015/harness/classify.mjs $W > $W/classes.json
node beds/ebed/e8/ledger/mutants-20261015/harness/table.mjs $W                     # needs $W/new/manifest.json
node beds/ebed/e8/tools/mutate.mjs --json $W/mutate-measured.json                     # the measured score
```

Wall time on this container (4 cores): mutants and golden matrix seconds; witness search about 4 min; the corpus
differential about 40 min per process for 40 mutants (three in parallel); `tools/mutate.mjs` about an hour.
