# need-stage: single-stage tasks with a workflow-like surface

**Routing anchor for the need router (experiments/need-router), not a Tier-A bed.**
**Kind:** oneshot. **Role:** `need-anchor`. **Domain:** one stage of a W-bed back-office or research rung on one item.
**Version:** 1.0.0.

Everything is fictional and generated: the group (Hollin Group), its customers, suppliers, billing systems, labs,
compounds and documents all come from the W-bed generators (`beds/wbed/`), which build them from syllable and name
pools. No benchmark data is copied. No model was called to build or test this bed ($0).

## Intended class (a HYPOTHESIS, not a fact)

The family is meant to be a **negative class** and a **shortcut breaker** for the need router: each task *looks* like
a step of a multi-stage workflow (the rung's own rules text, document dialects, stage vocabulary and output records),
but asks for **one stage on one item**. The hypothesis is:

- `r2-route` and `r3-classify`: **one direct model call should suffice** (one document or one discrepancy, a closed
  label set, about 1.2-2.5K input tokens).
- `r1-normalise`: **one call should suffice**; the output is long at difficulty 5 (67-106 records), so a cheap model may
  need a plain agent loop or a second pass, but no constructed workflow.
- `r6-worker`: **one call, or at most a plain agent over the slice's files, should suffice** (14-49 files, about 4-11K tokens);
  no plan, fan-out or reducer is needed because there is one candidate.

Nothing here has been measured on a model. The router's paired labels (direct call vs. Haiku agent vs. Opus agent vs.
construct-before vs. JIT vs. reuse) are what would confirm or refute the hypothesis, per kind and per difficulty. Nobody
should assume one call suffices at difficulty 5, or for a cheap model, before those labels exist.

### Mixed family vs. per-kind families (read before featurising or labelling)

`need-stage` **mixes four kinds whose class hypotheses differ**, dealt by seed. The router harness featurises and labels
per family id and calls `generate({seed, split, difficulty})` without `stage` (`experiments/lib/beds.mjs` `makeTasks`;
`experiments/need-router/features.mjs` `familyFeatures` takes dev seeds 601-603 at d3 by default). For `need-stage`
those three seeds are `r3-classify`, `r2-route` and `r6-worker`: the default feature vector is a median over three kinds
and **never samples `r1-normalise`, so it does not represent the family**. Router features and labels for `need-stage`
are only meaningful when split post hoc by kind (`stageOf(seed, split)`, or `task.knobs.stage` / the label row's
`kind` for tasks made with the `stage` override, as the preregistered `wbed-stage` job does with `stageKinds`). A
per-job label over the job's 12 tasks blends 3 tasks of each kind.

So each kind is also published as its own **homogeneous family**, loadable by the existing harness without any change
to it:

| Family id | Module | Kind | Class hypothesis |
|---|---|---|---|
| `need-stage/r1-normalise` | `beds/need-stage/r1-normalise/index.mjs` | `r1-normalise` | one call; long output at d5, so maybe a plain agent loop |
| `need-stage/r2-route` | `beds/need-stage/r2-route/index.mjs` | `r2-route` | one direct call |
| `need-stage/r3-classify` | `beds/need-stage/r3-classify/index.mjs` | `r3-classify` | one direct call |
| `need-stage/r6-worker` | `beds/need-stage/r6-worker/index.mjs` | `r6-worker` | one call or at most a plain agent over the slice |

`loadFamily('need-stage/<kind>')` resolves `beds/need-stage/<kind>/index.mjs` (the id is a path under `beds/`). Each
module re-exports `kindFamily(kind)` from `index.mjs`: the contract interface (`family` with `parent: 'need-stage'` and
`stage`, `outputSchema` = the kind's strict schema, `generate`, `oracle`, `referenceSolve`, `badControls`) plus
`deployableCheck`, `outputSchemaOf`, `describeTask` and `surfaceBaseline`. A per-kind task is the need-stage task with
`stage` fixed (same prompt, inputs, files, budget and truth), with id `need-stage/<kind>/<split>/d<n>/<seed>`, `family`
set to the per-kind id and `knobs: {stage}`; its oracle fixes the kind and ignores `task.knobs`; its `generate` refuses
another `stage`. `family.kindFamilies` on `need-stage` lists the four ids. Use these ids for router features and labels.
Two practical notes for whoever wires them into a run: the ids contain a slash (task keys become
`need-stage/<kind>:dev:d3:s601`, so work directories nest one level deeper), and seed-ledger ranges are keyed by bed
name, so a job on a per-kind id should set `ledgerBed: 'need-stage'` to share need-stage's seed accounting (the same
seed gives the same case under both ids). Neither the harness nor the ledger nor the preregistration is changed here.

The contract's "a 20-line script must not solve it" rule is waived where a stage is direct-call solvable. The R2 keyword
router and an R3 counts-and-cut-off rule (`surfaceBaseline`) solve every difficulty-1 item of their kind by construction
(see "Difficulty"); that is expected for an anchor and is not evidence about model behaviour.

### Why it breaks shortcuts

The full rungs (`wbed-r1` linear pipeline, `wbed-r2` judged branch, `wbed-r3` fan-out/fan-in, `wbed-r6` planned swarm)
are the bed's positive-class neighbours: same world, same surface, multi-stage structure. A need-stage task and the rung
task it was cut from (`describeTask(task).rungTask`: same seed, split and rung difficulty) differ in **structure** while
sharing vocabulary, rules text and document formats, so a router keyed on surface words ("reconcile", "route", "audit",
"retraction") misfires. Length is pulled apart from structure too: an `r6-worker` task at difficulty 5 (about 10K tokens,
one stage) is longer than a whole `wbed-r2` inbox at rung difficulty 2 (about 5K tokens, judged branch over 30
documents), and an `r1-normalise` list at difficulty 5 (100 records) is shorter in input but longer in output than an
`r3-classify` item at the same level.

## What one task is

The kind is dealt by seed: seeds are grouped in blocks of four consecutive integers, each block a seeded permutation of
the four kinds (so every 40 consecutive seeds contain each kind 9-11 times, and the kind of a seed does not depend on the
difficulty). `generate({seed, split, difficulty, stage})` accepts an optional `stage` override; a non-default task carries
`task.knobs = {stage}` and the id suffix `/<stage>`, and the oracle honours it.

| Kind | Rung (stage) | The one item | Inputs (rung text, byte-identical) | Output |
|---|---|---|---|---|
| `r1-normalise` | `wbed-r1` `normalise` (invoices) | one billing system's invoice list | `invoice_list` (the rung's list text), `ledger_notes` (the notes header and the system's paragraph), `ledger_spec` (the spec header, sections 3 and 5 with the FX quotes) | `{"invoices":[{"invoice","row","date","usd_cents","live"}]}`, one record per invoice |
| `r2-route` | `wbed-r2` `route` | one e-mail of the inbox | `document` (the rung's `=== DOC n ===` text), `parties`, `notes` (the routing rules, verbatim) | `{"doc","kind"}`, kind one of the nine routes incl. `review` |
| `r3-classify` | `wbed-r3` `classify` | one discrepancy, as the rung's `match` stage hands it over | `difference` (`ref, type, amount_minor, stmt_count, ledger_count, date`), `supplier` (its line), `statement` (its file, with the cover note), `ap_notes` (all), `audit_spec` (header, sections 2 and 3, the supplier system's statement format) | `{"reason"}`, one of the six codes |
| `r6-worker` | `wbed-r6` `worker` | one plan candidate compound | `question`, `properties`, `register` (the rung's), `candidate` `{code}`, `corpus`; `files`: the candidate's declared slice (`budget.mjs` `workerSlice`: every notice plus every research document and review that mentions it), byte-identical `corpus/Dnnn.txt` files | `{"in_scope","cells":[{"property","value","source_doc_id"}],"void_doc_ids"}` |

Each prompt says which step of which process this is, that only this step is asked for, which inputs are the rung's
rules, and the output form. R1's `live` is the rung's normalise field: status not void (section 3 (a)) and dated on or
before the close (3 (b)); 3 (c), the customer row, belongs to a later stage and the prompt says it is ignored. The R6
prompt carries the rung's question and rules 1-8 verbatim and replaces rule 9 (the table) with the worker's output.

### The stage truth and where it comes from

The bed imports the rung modules read-only (`beds/wbed/r1|r2|r3|r6/index.mjs` for their world-identity verifiers, then
the world builders and stage functions). Truths are computed here and cross-checked against the rung's own exported
`referenceTrace` in the tests:

- `r1-normalise`: per invoice of the list, the ISO date, US cents at the task's quote (`usdOf`) and status-and-date
  liveness, computed from the world's invoices; equals `referenceTrace(rungTask).normalise.invoices` for that system.
- `r2-route`: the document's route; equals `referenceTrace(rungTask).route.routing` for that document.
- `r3-classify`: the rung's reason rule (`reasonOf`) on the one difference; equals the rung's `classify` (and `reduce`)
  entry for that reference, and the `difference` input equals the rung's `match` output.
- `r6-worker`: the rung's exact worker run **on the slice alone** (its void set is what the slice shows); equals the
  rung's full-corpus worker item for that candidate, so the slice is sufficient. An in-scope candidate's cells are the
  rung's final table rows for the compound.

## Difficulty knob

`difficulty` 1..5 sets (a) the rung difficulty of the world (`RUNG_DIFFICULTY`: 1 and 2 use rung d2, then 3, 4, 5) and
(b) the item's ambiguity, scored from the rung's own planted cases and knobs; the item is drawn (seeded) from the items
whose score matches the level, else the nearest score:

| Kind | Ambiguity score of an item | Level -> score wanted |
|---|---|---|
| `r1-normalise` | +1 each: numeric day/month dates (BRIGHTDESK, ATLAS, TALLY), ATLAS order drawn per task (rung d3+), ATLAS print-server switch (d4+), a per-task status word with stated meaning (d4+), the new TALLY system (d4+) | 1: 0, 2: 1, 3: 2, 4: 3, 5: 4-5 |
| `r2-route` | +1 keyword misleads (decoy template), +1 hedged, +1 foreign language (d4+), +1 injection or bank_change; review (undecidable) = 3 | 1: 0, 2: 1, 3: 2, 4-5: 2-3 |
| `r3-classify` | 0 TIMING/DUPLICATE (counts and cut-off), 1 one-sided before the cut-off (credit with or without an agreeing note, unmatched invoice/payment), 2 invoice difference with or without a price note, one-sided just before the cut-off, 3 payment difference with or without a conversion note (d3+), 4 the memo-means-price supplier | 1: 0, 2: 1, 3: 2, 4: 3, 5: 3-4 |
| `r6-worker` | in scope: its cells' planted traps (+1 abbreviation or code-only naming, +2 former lab name); near misses: 1 only quoted or planned, 2 tested before the date or only in a retracted document | 1: 0 (in scope), 2: 1, 3: 2, 4: scope side drawn first (seeded, half out of scope), then 3 in scope or 2 out of scope (T1/T3), 5: 4-6 (in scope by design) |

Every item must also have at least one planted near miss (below); items without one are skipped. Measured on dev seeds
601-640 (labels per kind and level, about 10 tasks each): R1 lists are VERITAS/LEDGR at d1, BRIGHTDESK/ATLAS at d2,
ATLAS (and TALLY) from d3; R2 routes are decidable plain documents at d1, decoys and injections at d2-d3, review,
foreign and injection documents at d4-d5; R3 reasons are TIMING/DUPLICATE at d1, MISSING_CREDIT/UNEXPLAINED at d2,
PRICE/UNEXPLAINED at d3, FX/UNEXPLAINED (and PRICE) at d4-d5; R6 candidates are in scope at d1 and d5 (by design) and
about half out of scope at d2-d4 (with the `stage` override, 40 seeds per split: d2 23/18 in scope dev/test, d3 20/18,
d4 24/23; the level-4 out-of-scope items are T1 and T3 near misses). The R2 keyword router solves 10/10 dev items at d1, 3/10 at d2 and 0/10 at d3-d5; the R3
counts-and-cut-off rule solves 10/10 at d1 and 5-6/10 at d2-d5 (UNEXPLAINED is its default).

### Expected input size (tokens) per difficulty

Tokens are `ceil(bytes / 4)` of prompt + `JSON.stringify(inputs)` + every file (the `task.budget.inputTokensEstimate`
formula; not a tokenizer). Median (min-max) on dev seeds 601-640, 40 tasks per level, about 10 per kind:

| Difficulty | All kinds | r1-normalise | r2-route | r3-classify | r6-worker | Item size |
|---|---|---|---|---|---|---|
| 1 | 1291 (1011-6777) | 1349 (1011-2070) | 1242 (1209-1270) | 1263 (1151-1461) | 6084 (5072-6777) | R1 10-43 invoices, R6 18-31 files |
| 2 | 1251 (837-6598) | 1120 (837-1303) | 1244 (1232-1267) | 1232 (1135-1497) | 6000 (3835-6598) | R1 13-34 invoices, R6 14-29 files |
| 3 | 1462 (1086-8426) | 1506 (1086-1672) | 1341 (1321-1358) | 1435 (1314-1587) | 6366 (4856-8426) | R1 22-54 invoices, R6 20-42 files |
| 4 | 1706 (968-9656) | 1623 (968-1999) | 1469 (1459-1505) | 1756 (1563-2332) | 7512 (5597-9656) | R1 14-68 invoices, R6 23-47 files |
| 5 | 2146 (1561-10844) | 2203 (1990-2674) | 1578 (1561-1597) | 2047 (1856-2458) | 10314 (9077-10844) | R1 67-106 invoices, R6 37-49 files |

Level 3 is far below the contract's 6-15K-token target except for `r6-worker`; that target does not apply to an anchor
whose point is one item. Output size: R1 needs about 30 tokens per invoice (up to about 3.4K at d5), R6 about 60 + 40 per
requested property, R2 and R3 under 20. The test pins these ranges with slack.

## Oracle

The oracle recomputes the case from `(seed, split, difficulty, knobs.stage)` (never from the task's text), validates the
output against the task kind's schema (`stageSchemas[kind]`, closed at the top level; `outputSchema` is the family-level
union envelope; `outputSchemaOf(task)` returns the strict one) and rejects anything that is not plain JSON data
(functions, proxies).

**Harnesses must not use the envelope as a schema gate.** It has no `required` (it is the union of four shapes), so `{}`
and another kind's shape are valid against it. For a schema-valid / deployable signal use `deployableCheck(task, out)`
(exported; `experiments/need-router/label-run.mjs` calls it when a bed exports it: true when the output satisfies the
task kind's own schema, no truth read), or `outputSchemaOf(task)`, or a per-kind family, whose `outputSchema` is the
strict schema. Deployable means schema-valid, not right: the planted near misses are deployable and fail the oracle.
Pass rules:

- `r1-normalise`: exactly one record per invoice of the list (invoice numbers compared by the rung's reference rule:
  case, spaces, hyphens and slashes ignored), every field exact (`row`, ISO `date`, integer `usd_cents`, boolean `live`),
  no extra or duplicate record; any order. Score = exact records / (records + extra + duplicates).
- `r2-route`: `doc` is the document's number and `kind` its route. Score 1 or 0.
- `r3-classify`: `reason` equals the code; an optional `ref` echo is ignored. Score 1 or 0.
- `r6-worker`: `in_scope` exact; in scope, exactly one cell per requested property with `round(value * 10^dec)` equal to
  the truth at the property's precision and `source_doc_id` equal (case and spaces ignored); out of scope, no cells;
  `void_doc_ids` equal as a set. Score averages scope, cells and void set.

`details` carry counts and flags only, never the true values.

## Controls

Bad controls (each fails on every dev seed 601-640 at every difficulty; tested):

- `empty`: `{}` (R1: `{"invoices":[]}`).
- `shuffled-or-corrupted`: R1 US cents rotated by one invoice; R2 the next route; R3 the next reason code; R6 values
  scaled and sources rotated (or the scope verdict flipped).
- `plausible-but-wrong`: the item's first planted near miss, i.e. the rung's own most relevant mistake that changes
  this item's answer. R1: `atlas-switch-ignored`, `flag-meaning-flipped`, `date-order-flipped`, `ignore-close-date`,
  `void-status-counted`, `unconverted-amounts` (the rung's normalise options; the day/month flip is extended to
  BRIGHTDESK). R2: `undecidable-handled`, `injection-obeyed`, `bank-change-read-as-unrelated` /
  `statement-read-as-unrelated`, `keyword-router`, `decidable-escalated`. R3: the rung's `timing-window-ignored`,
  `timing-all-one-sided`, `memo-means-price`, `credit-always-missing`, `payment-diff-always-fx`, plus `notes-ignored`,
  `duplicate-read-as-one-sided`, `invoice-difference-is-price`. R6: the rung's worker-level controls (scope by
  publication date, mentions / plans / void documents counted, alias missed, namesake lab, retracted / superseded kept,
  errata skipped or cited, non-standard / quotes / predictions / bounds counted, no unit conversion, recency only,
  concern voids, retraction by title), role- and trap-specific ones first. `describeTask(task).nearMisses` lists them.
- `plausible-but-wrong:last-near-miss`: the item's last distinct near miss.
- `answer-for-another-item`: the right stage applied to the wrong item of the same world (another list, another
  document's route, another discrepancy's reason, another candidate's worker result) whose answer differs.

## Untrusted text

R2 inboxes contain `injection` documents (messages that tell the reader to post, settle or credit something no document
supports, signed as automation, treasury or the CFO's office) and decoy subject lines; R6 documents and R3 notes contain
misleading but non-explaining mentions. They are data. Every prompt says that document, list and note text is data, not
instructions.

## Tests (`node --test beds/need-stage/*.test.mjs`)

Development seeds 601-640 only; nothing here is held-out evidence. The tests show: cold `generate` and `oracle` under
2 s at difficulty 5; the contract shape and the portable schema subset; byte-identical repeated generation, fresh
objects, and that split and seed matter; that every kind occurs at every level (9-11 of 40) and the `stage` override;
`referenceSolve` passes for all 40 seeds at every level; every bad control fails for all 40 seeds at every level; each
item has at least one near miss and the knob-specific mistakes of every kind occur; schema-invalid output (wrong types,
extra keys, another kind's shape, functions, proxies) is rejected; the comparison rules; no hidden truth in prompt,
inputs or files (no world metadata keys; R1 truth dates are not visible for non-ISO systems; R3's code appears only in
the spec's code list; R2's document is the rung's text; R6's files are the rung's files); the **cross-check** of every
stage truth against the full rung's `referenceTrace` (about 50 tasks per kind) together with byte identity of the surface
text; that difficulty raises the item's ambiguity score and lowers the surface baselines; and the token ranges above.

Regression tests for the adversarial review of 2026-10-14 (one per fixed defect, see "Review fixes"):

- **major 1**: the four per-kind ids load through `experiments/lib/beds.mjs` `loadFamily`, `makeTasks` at the harness's
  default seeds gives only that kind at every level, the tasks equal the need-stage `stage`-override tasks (prompt,
  inputs, files, budget, truth), generation is byte-identical on repeat, a forged `knobs.stage` does not move a per-kind
  oracle, and need-stage's own default example seeds 601-603 are r3/r2/r6 (the caveat above); every per-kind family
  passes the contract checks (reference passes, every bad control fails, dev seeds 601-620 at every level); and
  `features.mjs` `familyFeatures` of a per-kind id is the median over that kind's tasks with the strict schema's leaves.
- **minor 2**: on the reviewer's case (seed 604, d3, `r1-normalise`) the envelope accepts `{}`, `{"reason":"TIMING"}`,
  `{"doc":1,"kind":"invoice"}` and `{"in_scope":false,"cells":[],"void_doc_ids":[]}` under `src/validate.mjs`
  `compileDataSchema`, and `deployableCheck` rejects all four; for every kind it accepts the reference and the near misses
  and rejects `{}`, `null`, extra keys and every other kind's shape; the per-kind `outputSchema` rejects `{}` in the
  harness compiler.
- **minor 3**: `r6-worker` at level 4 is out of scope on 12-28 of 40 seeds in each split (measured 16 dev, 17 test),
  out-of-scope items are T-roles with no cells, the constant `in_scope:true` answer fails them; level 5 stays in scope.

## Files

- `index.mjs`: contract interface, kind dealing, case cache, controls, `deployableCheck`, `describeTask`,
  `surfaceBaseline`, and `kindFamily(kind)` (the per-kind families).
- `r1-normalise/index.mjs`, `r2-route/index.mjs`, `r3-classify/index.mjs`, `r6-worker/index.mjs`: the per-kind families
  `need-stage/<kind>` (each re-exports `kindFamily(kind)`).
- `stage-r1.mjs`, `stage-r2.mjs`, `stage-r3.mjs`, `stage-r6.mjs`: one module per kind (item choice, rules text,
  truth, near misses, comparison).
- `common.mjs`: schema check (the W-bed / records validator, imported unchanged), seeded item choice, near-miss bookkeeping.
- `need-stage.test.mjs`: the tests above.

## Limits and unknowns

- No model was run. The class hypothesis above is untested; difficulty is an ambiguity knob from the rung's planted
  cases, not a measured hardness.
- R4 (consolidation) and R5 are not used; the four kinds asked for (R1, R2, R3, R6) were all derivable, so no
  replacement kind was needed.
- For `r2-route` the cross-check shares a code path with the rung (both read the world's document kind); for
  `r3-classify` both call the rung's `reasonOf`. The checks show the item, its rules text and its truth are the rung's,
  not that the rung's truth is right (that is the rung's own oracle health).
- `r6-worker` items at level 5 are in scope by design (the level's difficulty is the 4-6 traps planted on the cells),
  so a constant `in_scope:true` gets the level-5 scope verdict right; it does not pass, because the cells and the void
  set must also be exact. Levels 2-4 are about half out of scope. `r1-normalise` items from level 3 are mostly ATLAS
  lists; R3 has UNEXPLAINED as a frequent label at every level from 2 (the rung's own default).
- The per-kind ids have no README of their own and no seed-ledger or preregistration entry; this README covers them.

## Review fixes (2026-10-14)

An adversarial review found one major and two minor defects; all three are fixed, each with a regression test above.
`family.version` stays `1.0.0` as the bed brief requires, but **`r6-worker` tasks at difficulty 4 changed** (all of
them: the scope draw shifts the item stream), so their task hashes differ from earlier generations. No other kind or
level changed. Among the preregistered `wbed-stage` example tasks (dev 601-609, band d3-d5, `stageKinds`) only seed 608
(d4, `r6-worker`) changed: it was an in-scope candidate of about 7.6K tokens and is now an out-of-scope one of about
5.9K, so that job's largest example is now about 7.2K tokens (seed 604) instead of the recorded 7,575 (the agent-O
budget tier, which switches at 30K, is unchanged).

1. **Major, blended features and labels.** The kinds are mixed in one family id, so a per-family feature vector and
   label blend kinds whose hypotheses differ, and the harness's default example seeds never sample `r1-normalise`.
   Fix: the homogeneous per-kind families `need-stage/<kind>` (loadable by the existing `loadFamily`, no change outside
   this directory), `family.kindFamilies`, and the section "Mixed family vs. per-kind families" saying that
   need-stage's own features and labels are only meaningful split by kind and that its default `familyFeatures` does
   not represent it.
2. **Minor, envelope schema as the deployable gate.** `outputSchema` is a union envelope without `required`, so the
   label harness counted `{}` and other kinds' shapes as schema-valid and deployable. Fix: `deployableCheck(task, out)`
   (the kind's own schema), exported by need-stage and by every per-kind family; the per-kind families' `outputSchema`
   is the strict schema; the Oracle section says harnesses must not gate on the envelope.
3. **Minor, R6 level 4 always in scope.** `ROLES[4]` listed T1-T4, but they score 1-2 against `WANT[4] = [3]`, so the
   pick never reached them. Fix: level 4 draws its scope side first (seeded, half out of scope), then picks by score
   within the side (in scope 3, out of scope 2, T1/T3); the dead level-4 entries are gone from `ROLES` and `WANT`.
- Importing this bed imports the four W-bed rungs, which install their world verifiers on import (as their own index
  modules always do); nothing in those beds is modified.
