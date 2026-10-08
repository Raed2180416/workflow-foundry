# Kev judge data factory: contracts and shared library

*Development evidence only. Nothing here trains, serves or calls a model. Design:
[`research/kev-20261007/JUDGE-PROGRAM.md`](../../research/kev-20261007/JUDGE-PROGRAM.md) (revision 2);
worker plan: [`JUDGE-BUILD-PLAN.json`](../../research/kev-20261007/JUDGE-BUILD-PLAN.json).*

This directory is the data factory for fine-tuning Kev-0.8B as the judge behind Foundry's typed
judgment ports. The `contracts-lib` group owns everything listed below. It is the frozen interface
that every other group imports: the port contracts, the shared library, the build skeleton, the Kev
exporter, the bed pin and frozen copy, the port-kit interface and the test harness. Bed groups
(`records`, `incident`, ...) add `ports/<group>.mjs`, `taps/<bed>.mjs`, `solve/<port>.mjs`,
`judges/<bed>.mjs` and `test/<group>.test.mjs`. Nothing else in this directory is theirs to edit.

**Relocation (2026-10-07 22:50).** The plan puts port kits under `src/judges/`. Any file added under
`src/` changes the frozen construction-kit hash of the C0 and P1 experiments, so until those
experiments finish the kits live in **`experiments/kev-data/judges/`**: `kit.mjs` (the interface,
owned here) and `<bed>.mjs` (one per bed group). They move to `src/judges/` afterwards with no change
to the interface. Do not write under `src/`.

| Path | What |
|---|---|
| `spec/ports.json` | 42 port contracts + 3 ledger-only contracts (§1), hashed into every build |
| `lib/contracts.mjs` | load, hash and validate the spec; route models against `policy/models.json` |
| `lib/render.mjs` | the question wire form (re-exports `toSystemOneQuestion` from `src/judgment.mjs`) |
| `lib/hash.mjs` | `worldHash`, `stateHash`, `spanHash`, `skeleton()`, skeleton buckets, record ids |
| `lib/tokens.mjs` | real Qwen3.5 token counts and Kev's own `fits()` through `/opt/kev-venv` (`python -I`), batched |
| `lib/balance.mjs` | 3:1 caps, within-entity balance, deployment-rate draws, importance weights, option positions |
| `lib/leakage.mjs` | forbidden state keys, the span-skeleton registry, the held-out wording guard |
| `lib/registry.mjs` | reserved worlds (dev 1-400, test 7000-7039 and 7040-7199) |
| `lib/counterfactual.mjs` | one-sentence re-render through an opaque line provider; leak repair |
| `lib/probe.mjs` | bag-of-words logistic probe (unigrams + bigrams, plain JS) |
| `lib/pin.mjs` | bed pin over the allow-list and the frozen copy |
| `lib/coverage.mjs` | the §1.5 coverage script (100 inventory decisions: 47/18/35) |
| `lib/harness.mjs` | test helpers for every group's test file |
| `build.mjs` | §3.1 slice table, record checks, build driver, build verifier |
| `export-kev.mjs` | factory records -> Kev JSONL + meta sidecar |
| `judges/kit.mjs` | port-kit interface: `buildState(task, slots)`, `questions(port, slots)` |
| `test/contracts-lib.test.mjs` | this group's acceptance tests |

## Running the tests

```sh
node --test experiments/kev-data/test/contracts-lib.test.mjs     # this group, runs alone
node --test experiments/kev-data/test/*.test.mjs                 # every group
```

Node 24's `node --test` does not take a directory argument (`node --test experiments/kev-data/test/`
fails with `Cannot find module`), so pass the files or a glob. The contracts-lib file takes about
35-95 s. The Python batch (Kev import, tokenizer load and every count) took 5.7 s warm and 69.5 s
cold in the 2026-10-08 runs; the seeded-defect test runs five child `node --test` processes on
mutant copies (about 2.5 s).

Environment variables (all optional): `KEV_DATA_SCRATCH` (scratch root for temp dirs, default
`os.tmpdir()`), `KEV_DATA_KEEP_TMP=1` (keep them), `KEV_DATA_PYTHON` (default
`/opt/kev-venv/bin/python`), `KEV_DATA_KEV_ROOT` (default `/home/user/jaredpalmer/kev`, must be at
`5e42a7a0`), `KEV_DATA_HF_HOME` (default `/opt/hf-cache`; always offline).

Tests read beds only from a frozen copy in a scratch directory, and only train-range dev seeds
(401-440). They never read a test seed (>= 5000) or `beds/sealed/`.

## `spec/ports.json`

```js
import { loadSpec, validateSpec } from './lib/contracts.mjs';
const { spec, hash, contracts } = loadSpec();   // contracts = {...spec.ports, ...spec.ledgerOnly}
validateSpec(spec);                              // { ok, errors: ['R2: missing wording Q3', ...] }
```

Top level: `schema`, `program`, `conventions` (wire form, limits, forbidden state keys, deployment
rates, authority, budget, unknowable and variant vocabularies), `route` (unknown port -> hosted model;
Kev -> weak model `claude-haiku-5-5`, class M, owner decision O1 -> `claude-sonnet-5-5`, class L ->
terminal route; both ids are checked against `policy/models.json`), `bedPin` (the pin at which the
bed-derived option sets and the I2 tag inventory were last checked), `ports` (R1-R5, I1-I3, S1-S5,
K1-K3, Q1-Q6, X1-X8, F1-F3, C1-C9) and `ledgerOnly` (L1 `verifier_score`, L2 `candidate_choice`,
L3 `reuse_route`).

A port contract:

| Field | Meaning |
|---|---|
| `id`, `name`, `group`, `decisions`, `relatedDecisions` | port id, snake_case name, inventory decisions it maps (§1.5) and decisions it touches |
| `wave` (1/2/3), `waveNote`, `status` | wave 1 = R1-R4, I1, I2, S2, Q4, X1, X3, X5, X8, F1; C3-C6 are out of plan until O5 |
| `authority` | `gating` (may act once promoted) or `advisory` (rank, order, annotate, alarm only) |
| `use` | `{kind: V/R/G, consumer, route, terminal: {kind, detail}}` |
| `wordings` | `Q0` canonical, `Q1`-`Q3` training paraphrases; held-out wordings are never here |
| `slots` | `{name: {source, values?, maxChars?}}`; filled from trusted code knowledge only |
| `options` or `optionSource` | fixed `{name: description}`, or variable options `{kind, pattern, min, max, describedBy}` |
| `optionsFrom`, `ordered` | the bed constant fixed options were copied from; ordered scale (C6, L1) |
| `criteria` | always `[]` (the program names none), so the instructions are the wording itself |
| `companion` | S1 only: `S1_present`, a yes/no question in the same record instead of a "none" option |
| `state.keys` | `{key: {event, source}}`: field provenance at the time of decision; nested keys as `a.b` |
| `allowedKnowledge` | `[{knowledge, basis}]` (§1.0) |
| `deploymentRate`, `balanceWithin` | `bed-natural`, `balanced-within-entity` (with the entity) or `uniform` |
| `budget` | `{typical, max, evidence: M/E, hardCap: 8192, windowed?}` in real Qwen3.5 tokens |
| `families`, `holdouts`, `heldoutWordings` | train and held-out families, template/skeleton axes, 10/10/20 held-out wordings (wave 1) |
| `labelSource`, `labelMap` | where labels come from (never an LLM) and the truth -> option map |
| `unknowable`, `causal`, `epsilon` | `soft-target`, `label:not_stated` or `n/a`; causal gates; risk budget (X5 0.02) |
| `specGaps` | every place the contract had to fill or reconcile the program text (see below) |

Ledger-only contracts carry `Q0`, options, state keys with provenance and `ledgerOnly: true,
training: 'none', gate: 'none'`. The build and the exporter refuse any question for them.

## Library APIs

### `lib/render.mjs`: the wire form

```js
import { renderQuestion, labelledQuestion, uniformTarget, questionId, questionContract, renderState } from './lib/render.mjs';
renderQuestion(contract, { wording: 'Q0', wordingText, slots, options, optionDescriptions, optionOrder })
  // -> { type: 'choice', instructions, criteria: {option: description} }, via toSystemOneQuestion
labelledQuestion(contract, { label, target, ...renderOpts })   // + label (an offered option), optional soft target
uniformTarget(options)                                          // {option: 1/k}, for training unknowables
questionId('R1') === 'R1'; questionId('R1', 'cal-07') === 'R1~cal-07'
questionContract(qid, contracts)    // {port, reportId, contract, companion} for 'R1', 'R1~x' or 'S1_present'
```

`renderQuestion` is `questionFromContract` from `judges/kit.mjs`, the same function the runtime
uses, and it calls `toSystemOneQuestion` from `src/judgment.mjs` (re-exported as
`toSystemOneQuestion`). Pass `wordingText` for a held-out wording. `optionOrder` must be a
permutation of the options (use `lib/balance.mjs optionOrder`). Also exported: `fillWording`,
`slotNames`, `contractOptions`, `LIMITS`, `portOfQuestionId`, `wordingPattern(template)` (matches any
slot filling), `normalizeWs`, `questionOf(instructions)`, and `renderState(state)`, a JS copy of Kev's
`kev/api.py render` for probes and byte estimates (exact except Python float formatting: carry
non-integer numbers as strings).

### `lib/hash.mjs`

`canonical(value)` (byte-identical to `beds/lib/canonical.mjs`), `sha256`, `tagged`, `hashOf`,
`worldHash(task)` (prompt, inputs, files; never seed, split or id), `stateHash(state)`,
`spanHash(text)` (NFC, whitespace-normalised), `skeletonText(text, {names, markers})` and
`skeleton(text, opts)` (quoted strings, names, markers, dates and times, hex runs and digits masked,
lowercased), `skeletonPercent(hash)`, `skeletonBucket(hash)` (`test-ood` 0-20%, `dev-ood` 20-30%,
`calib-ood` 30-40%, `train` 40-100%), `sentences(text)`, `recordId(record)`.

### `lib/tokens.mjs`

```js
import { countTokens, measureRecords, validateKevFile, kevBatch, jobMaxState } from './lib/tokens.mjs';
countTokens(['text', ...])                       // real tokens, kev.model.user_tokens, pinned tokenizer
measureRecords(records, { maxState: 8192 })      // per record {ok, fits, stateTokens, packedTokens, error}
validateKevFile(path, { maxState })              // kev.data.load_records + materialize + fits per line
kevBatch([{op: 'count', texts}, {op: 'measure', records, maxState}, {op: 'load_file', path, maxState}])
jobMaxState(stateTokens)                         // the build's p99.9, clamped to [384, 8192]
```

Each call is one Python process (about 5.7 s warm), so batch a whole file per call. The tokenizer is
`Qwen/Qwen3.5-0.8B-Base@dc7cdfe2`, Kev is `5e42a7a0` (checked by `checkKevPin()`), the environment is
minimal and offline. `measure` uses Kev's own `fits(materialize(r), tok, **training_context(maxState))`,
the factory's admission rule (§2.3 rule 6). `bytes4(text)` is the old estimate, kept for ratios.
Measured on train-range fixtures (3 worlds, 2026-10-08): real/bytes-4 = 2.00 for incident log lines,
1.95 for records export table rows, 1.054 for records notes prose.

### `lib/balance.mjs`

`capRatio(rows, {label, key, maxRatio: 3})`, `balanceWithin(rows, {group, label, labels, key})`
(a group missing a label is reported in `missing`, never padded: add counterfactual rows),
`sampleAtRate(rows, {label, rates, n, key})` (shortfalls reported), `allocate(n, rates)`,
`importanceWeights(rows, {label, target})`, `positionHistogram(questions)`,
`checkPositionUniform(hist, {tolerance: 0.05})`, `optionOrder(options, recordKey, {salt: 'kev-data'})`,
`counts`, `DEPLOYMENT_RATES`. Every draw is ordered by a salted hash of the row key: no
`Math.random`, so rebuilds keep the same rows.

### `lib/leakage.mjs`

```js
import { checkStateKeys, SpanRegistry, WordingGuard, leaksInto } from './lib/leakage.mjs';
checkStateKeys({ kind: 'x' })        // { ok: false, hits: [{path: 'kind', key: 'kind'}] }; source_kind passes
const reg = new SpanRegistry();
reg.add(heldOutSentence, { slice: 'heldout' | 'calib-ood' | 'dev-ood' | 'test-ood', source, port, kind, names, markers });
reg.scanState(state, { names, markers, slice })   // hits [{path, sentence, hash, entry}] that leak into `slice`
reg.toJSON() / SpanRegistry.fromJSON(obj)         // hashes only, never text (heldout/registry.json)
const guard = new WordingGuard([{ port, id, slice, text }]);
guard.check(instructions, slice)     // held-out wordings of other slices this question renders
```

`slice: 'heldout'` is test-OOD-only material (held-out bed templates, held-out family spans, held-out
entity lists). Train, calib-in and dev-select are checked against every entry; each OOD slice against
the other slices' entries (`leaksInto`). Also: `FORBIDDEN_STATE_KEYS`, `findForbiddenKeys`,
`stringLeaves`, `findUnrenderedIds(state, ids)`, `TRAIN_LIKE`, `OOD_SLICES`.

### `lib/registry.mjs`

`RESERVATIONS` (probe-pilot dev 1-400, real-reserve test 7000-7039, e2e-reserve test 7040-7199,
every bed and difficulty), `worldKey({bed, split, difficulty, seed})` -> `records:dev:d3:s101`,
`parseWorldKey`, `reservationOf`, `isReserved`, `reservedViolation(world, slice)`,
`assertNoReserved(worlds, slice)` (throws `RESERVED_WORLD`). A reserved world is allowed only in the
slice its reservation names (`real-reserve`, `e2e-reserve`).

### `lib/counterfactual.mjs`

```js
rerender(state, { path: 'source_note', sentence, request, provider, avoid, skeletonOpts })
  // -> { ok, state, counterfactual: {swapped, from, to, path, sentence} } | { ok: false, reason }
repairLeaks(state, { registry, slice, provider, request: hit => ({...}), skeletonOpts })
listProvider({ key: [{ text, from }] })   // a provider over explicit lists (request.key, request.index)
replaceSentence(text, sentence, replacement)
```

A provider is `provider({...request, attempt, avoid, sentence}) -> {text, from} | null`. This module
never opens pools: the caller passes lines (bed pools from the frozen copy, train-pool lines, or, at
assembly time only, OOD lines). A sentence that occurs zero or several times is not repairable; the
caller drops and counts the record.

### `lib/probe.mjs`

`trainProbe(examples, {l2, iterations, bigrams, labels})` on `[{text, label}]`,
`predict(model, text)` -> `{label, probabilities}`, `evaluate(model, examples)` -> `{accuracy,
balancedAccuracy, perLabel, hits}`, `topFeatures(model, label, k)`, `tokenize`, `features`.
Deterministic (full-batch AdaGrad). The partial-input battery is this probe fitted on the decisive
span, the context, the metadata or the format alone.

### `lib/pin.mjs`: bed pin and frozen copy

```js
import { bedPin, worktreeDiff, freezeBeds, frozenBeds } from './lib/pin.mjs';
const frozen = freezeBeds(repoRoot);   // -> .foundry/kev-data/frozen/<pin hex>/ (+ FROZEN.json)
const beds = frozenBeds(frozen);       // { pin, commit, dir, path(rel), import(rel), read(rel) }
const { buildWorld } = await beds.import('beds/records/world.mjs');
```

The pin is sha256 over (path, mode, sha256 of content) of every file git lists at the commit under
the allow-list: the nine dev beds (`records`, `incident`, `synth`, `kinetics`, `runbook`, `gameqa`,
`gridquest`, `codefix`, `ownerci`), `beds/lib` and `beds/CONTRACT.md`. Every git call passes only
allow-listed literal pathspecs; `beds/sealed/` is never listed, hashed or opened. The frozen copy is
`git archive` of the pinned commit, verified file by file. It records the working-tree diff hash it was
made under, and a later run whose diff hash differs is refused (`BED_DRIFT`). `beds.path()` refuses
anything outside the allow-list (`BED_PATH`). Bed modules are imported only through `beds.import`.
The build also refuses a generator that resolves a module in the live `beds/` tree
(`LIVE_BED_IMPORT`). Port kits must not import beds at all (the runtime has no frozen copy): they
work on the task they are given.

### `lib/coverage.mjs`

`node experiments/kev-data/lib/coverage.mjs` prints the summary (exit 1 on any error). `coverage()`
checks that every id D:A0-D:H6 of `02-decision-inventory.md` appears exactly once in §1.5, totals
47 mapped / 18 deferred / 35 excluded, that the §1.3 and §1.4 tables agree with the map, that every
mapped decision belongs to a frozen port and every port decision is mapped to that port, and that
every port §1.5 names lists the decision (as a decision or a related decision).

## `build.mjs`: slices, record checks, the build

`node experiments/kev-data/build.mjs --slices` prints the §3.1 table:

| Slice | Bed split | Seeds | Wordings | Use |
|---|---|---|---|---|
| reserved | dev | 1-400 | - | probe and pilot worlds; never trained or calibrated |
| train | dev | 401-3999 | Q0-Q3 | training; hard-negative mining (skeleton buckets 40-100%) |
| calib-in | dev | 4000-4199 | Q0-Q3 | in-family calibration gap (report only) |
| calib-ood | dev | 4200-4499 | calib-OOD held-out | temperature, per-option biases, thresholds (skeleton 30-40%) |
| dev-select | dev | 4500-4699 | Q0-Q3 | in-family diagnostics, transfer gap at selection |
| dev-ood | dev | 4700-4999 | dev-OOD held-out | learning curve, config and checkpoint selection (skeleton 20-30%) |
| test-in | test | 5000-5999 | Q0-Q3 | read once: recall |
| test-ood | test | 6000-6999 | test-OOD held-out | read once (skeleton 0-20%, held-out families, adversarial, long, unknowable, causal) |
| real-reserve | test | 7000-7039 (d3-d5) | Q0-Q3 | X8-real axis; X8 end-to-end |
| e2e-reserve | test | 7040-7199 | Q0-Q3 | X5 end-to-end gate (§8.3) |

Exports: `SLICES`, `RESERVED`, `SLICE_IDS`, `sliceDef`, `SLICE_PRIORITY` (evaluation slices claim a
state first), `TEST_SLICES`, `LABEL_SOURCES` (`generator`, `simulator`, `oracle`, `replay`, `journal`,
`composer`, `authored-brief`, `hand-label`: never an LLM), `MAX_QUESTIONS` (6), `FACTORY_VERSION`,
`seedsFor(slice, list | {first, count})`, `checkRecord`, `buildKev`, `verifyBuildDir`, `loadHeldout`,
`liveBedImports`.

**Generator interface** (`ports/<group>.mjs`, §2.2 plus a build context):

```js
export const group = 'records-notes';
export const ports = ['R1', 'R2', 'R3', 'R4', 'X5:records', 'X8:records', 'X1:records'];
export async function* records(slice, seeds, opts, ctx) {
  // ctx = { beds, pin, spec, contracts, slice: sliceDef(slice), heldoutDir, poolsDir }
  const { buildWorld } = await ctx.beds.import('beds/records/world.mjs');
  for (const seed of seeds) {
    yield { state, questions: { R1: labelledQuestion(ctx.contracts.R1, { wording, slots, label, optionOrder }) },
            meta: { family: 'records', bed: 'records', seed, difficulty, variant: 'clean', labelSource: 'generator',
                    formId, surface, counterfactual, pairId, wordingId, needsWorldKnowledge, masks: { names, markers } } };
  }
}
```

It must be pure: no `Math.random`, no clock, no network; the same (slice, seeds, opts, factory
version, bed pin) gives the same records in the same order. `meta.variant` is one of `clean`,
`injection`, `distractor`, `slot-swap`, `unknowable`, `long`, `flip`, `invariance`, `paraphrase`.
`meta.masks` are the names and markers the span registry masks for this state. `meta.worlds` lists
other worlds a record draws on (`records:dev:d3:s412`).

`checkRecord(record, {slice, contracts, variants, pin, wordings, registry})` returns `{record,
errors}`. It checks: record shape; forbidden state keys and JudgmentPort data limits; `meta.family`,
`variant` and `labelSource`; reserved worlds and seed ranges for the record's world and `meta.worlds`;
contract options and descriptions; the label (and soft target) among the offered options; the
wording (a rendering of Q0-Q3 through `toSystemOneQuestion`, or of the slice's own held-out wordings
in OOD slices); held-out wordings of other slices; registered spans; at most 6 questions (train,
calib, dev) or one question per port per state (test slices and reserves, except `paraphrase` and pair
records). It fills `meta.split`, `ports`, `stateHash`, `worldKeys`, `reserved` and `bedPin`.

`buildKev({root, outRoot, generators, slices, seeds, opts, spec, wordings, registry, measure,
maxState, expectPin, enforcePositions, heldoutDir, poolsDir})` freezes the beds, runs the generators
in evaluation-first slice order, fails on any record error (never a silent drop), drops exact
duplicates and states claimed by an earlier slice (counted), measures every record with Kev's
`fits()` in one Python process (misfits dropped and counted), and writes
`<outRoot>/<buildId>/kev/<slice>.jsonl`, `<slice>.meta.jsonl`, `manifest.json` (counts, labels,
option positions, real-token p50/p90/max per port, drops, pins, digests) and `timing.json` (the only
non-deterministic file). `buildId` hashes the factory version, spec hash, bed pin, generator sources,
config and held-out digests. `verifyBuildDir(dir)` re-checks digests, sidecars, record checks and
cross-slice state overlap. CLI: `--config <file.json>` (`{generators, slices, seeds, opts, heldoutDir,
poolsDir, ...}`) and `--verify <dir>`.

## `export-kev.mjs`

A factory record `{state, questions: {qid: {type, instructions, criteria, label, target?}}, meta}`
becomes a Kev line `{state, questions: {qid: {..., src: 'kevdata_<port>'}}, _meta: {id, source?}}`
and a sidecar line `{id, meta}` in `<file>.meta.jsonl`, in the same order and keyed by `_meta.id`
(`recordId`, a hash of state, questions and meta). `_meta.source = "unknowable"` marks unknowables of
soft-target ports in every slice; a training one must carry its target. X5's unknowable is the
labelled class `not_stated` and keeps the default source. Exports: `toKevRecord`, `exportKev(records,
{file, contracts, slice, guard})`, `readKevFile(file)` (round trip with id checks), `metaFileOf`,
`softTargetPort`, `fileDigest`, `SRC_PREFIX`, `UNKNOWABLE_SOURCE`. CLI:
`node experiments/kev-data/export-kev.mjs <records.jsonl> <out.jsonl> --slice <slice>`.

## `judges/kit.mjs`: the port-kit interface

```js
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';
const { contracts } = loadSpec();
export const kit = definePortKit({
  bed: 'records',
  contracts: { R1: contracts.R1, R2: contracts.R2 },
  buildState(task, { system }) { return { system, source_note: paragraphFor(task, system) }; },
});
kit.buildState(task, { system: 'ATLAS' })   // checked: JSON object, no forbidden key, JudgmentPort data limits
kit.questions('R1', { system: 'ATLAS' })    // { R1: {type: 'choice', instructions, criteria} } (Q0 unless opts.wording)
```

The factory and the runtime import the same kit, so training states and served states come from one
function (W2: `buildState(task)` equals the factory state byte for byte). Also exported:
`questionFromContract`, `contractOptions`, `fillWording`, `slotNames`, `assertPortState`,
`findForbiddenKeys`, `FORBIDDEN_STATE_KEYS`, `LIMITS`, `KIT_INTERFACE_VERSION` (1).

## `lib/harness.mjs`: helpers for group test files

`frozenRepoBeds()` (a frozen copy of this repository's beds in a scratch outRoot, so a test run never
trips `BED_DRIFT` for a real build), `tempDir()`, `tempBedRepo(files)`, `writeFiles`, `commitAll`,
`git`, `accessSpy()` (records every fs path and child-process argument list), `mutantCopy(mutations)`,
`runTests(file, {pattern, env})`, `seededDefect({file, pattern, mutants, env})` (the unmutated copy
must pass, each mutant must fail), `checkRecords(records, {slice})` (the build's record checks).
A group's seeded-defect test sets `KEV_DATA_MUTANT_RUN=1` for its child runs and skips itself there.

## Spec ambiguities resolved here

Each is also recorded in the contract's `specGaps`.

- **Criteria.** The program names no criteria for any port, so every contract freezes `criteria: []`
  and the instructions are the wording itself.
- **I2 tag table.** The program's explicit table has 24 rows "emitted in dev worlds [M crit-G]". On dev
  seeds 401-500 × d3-d5 the incident bed emits 26 tags at both VERSION 4.0.0 and 4.1.0: also
  `collateral` (996 lines in 300 worlds at 4.1.0) and `shadow` (4,498). The 24 rows are frozen as
  written; the two extra tags are recorded in `labelMap.unmapped` with a proposal each (collateral ->
  relay, as the bed's own `truth.depIds`; shadow -> excluded, like echo), **not applied**, and a build
  fails closed on them until the `incident` group maps them. The incident acceptance test "exactly
  the 24 tags" cannot pass as written. `bedVersion` moved from 4.0.0 to 4.1.0 after re-measuring at
  the current pin; the drift test re-checks the version and the tag set at every run.
- **Unstated states and descriptions.** S4, Q2, X6 and F3 states, Q3 state key names, K1, K3 and C4
  option descriptions, C1 requirement descriptions, and L1-L3 Q0, options and state keys are authored
  here; R5 options are the bed's 18 countries (the program says "≤ 40"); C4's display label is
  `node_label` because `label` is a forbidden key.
- **Budgets.** Where §1.1 and §1.2 disagree (R2, R5) the §1.1 table value is frozen.
- **Decisions.** X5 relates to D:A2-D:A5 and X4 to D:A10, as §1.5 maps them; "Q1 (notice kind) by
  code" in D:A10 names the decision's own question, not port Q1.
- **Unknowables in export.** Only soft-target ports' unknowables get `_meta.source = "unknowable"`;
  X5's unknowable is a scored class.
- **Span checks.** Train, calib-in and dev-select are checked against every registered span; each
  OOD slice against the other OOD slices' spans and against nothing of its own; test-in and the
  reserves are not span-checked (rule 7 names neither) but are wording-checked.
- **State limits.** A port state obeys the serving JudgmentPort's `checkData` limits (2 MiB, depth
  40), so the factory never admits a state the runtime would refuse.
