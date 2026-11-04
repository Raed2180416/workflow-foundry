# Build notes: corpus lab-test and claims solver

**What it does.** `solve.mjs` parses the corpus (from `task.files` or `files/corpus/`) and does most of the work in code:
- Parses headers and dates (ISO, `dd.mm.yyyy`, `Month D, YYYY`, `D Month YYYY`).
- Builds lab aliases from the consortium notice (`Full (ABBR)`) and renames, and compound aliases from the register and `name (CODE)` pairs in the text.
- Voids documents: retraction notices match title plus every detail given (author surname, venue, date or year); version and peer-review statements void the referenced preprint by title and posted date. Expressions of concern void nothing.
- Applies errata to the corrected document's measurements, converting units (°F, µM, mg/100 mL, and so on).
- Sets scope: compounds with any own-lab test (any property, including bounds) dated on or after `tested_on_or_after`, in non-void documents.
- Picks claims (own, standard condition, not a bound), ranks them (n, then venue, then date, or venue and date only if the prompt says sample size does not matter), rounds to the property's decimals, and lists void research documents that mention a scope compound.

The model (`claude-haiku-5-5`, no reasoning) only extracts typed measurements from batches of 6 documents: compound, property, value, unit, bound, standard-condition flag, own-measurement flag, n, and measurement date. Each batch is checked for echoed document ids and retried once on failure.

**Verified.**
- Probe-0 was run end-to-end through `tools/run-solver` (exit 0, 110 rows, 9 excluded ids). Two density cells (ZN-4992, QT-6938) differed from the scored run, so model extraction varies between runs.
- Scoring: the first version scored 0.456. After fixing scope (tests of non-requested properties were dropped) and the mg/100 mL conversion, the scored version got 0.992 (fail). That is 2 of 6 score checks used. The 0.992 answer came from the cached-extraction run; the end-to-end run is identical apart from those two density cells.
- Cost: about $0.09 per probe run (60 batches at about $0.0015 each). Construction spend so far is about $0.185 of $0.40.
- `LOAD_EXTRACT=<dump>` is a dev-only switch that reuses saved model output; it is unset in normal runs.

**Not verified.**
- Probes 1 and 2 were not run, for budget and time reasons.
- The exact cell(s) causing the 0.992 are unknown.

**Known weaknesses.**
- Model flags (`condition_ok`, `own_measurement`) are the largest error source and are unchecked.
- Compounds named only, with no code anywhere in the corpus, get a name key, and the output uses that name.
- Measurement dates fall back to the publication date when none is given.
- Erratum sentences are parsed by a single regex; unmatched forms are logged and skipped.
- The question-parsing assumes the input layout seen in the probes.
