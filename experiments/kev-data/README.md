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
| `spec/ports.json` | 42 port contracts + 3 ledger-only contracts (§1), deep-frozen when loaded, hashed into every build |
| `lib/contracts.mjs` | load, hash and validate the spec; skeleton masks; families; fail-closed label lookup; route models against `policy/models.json` |
| `lib/conform.mjs` | the spec against the program text (§1.0, §1.1, §1.2, §3.4, §6.1) |
| `lib/bedsync.mjs` | bed-derived option sets and the I2 tag-table version, re-checked against a frozen copy |
| `lib/render.mjs` | the question wire form (re-exports `toSystemOneQuestion` from `src/judgment.mjs`) |
| `lib/hash.mjs` | `worldHash`, `stateHash`, `spanHash`, `skeleton()`, skeleton buckets, record ids |
| `lib/tokens.mjs` | real Qwen3.5 token counts and Kev's own `fits()` through `/opt/kev-venv` (`python -I`), batched |
| `lib/balance.mjs` | 3:1 caps, within-entity balance, deployment-rate draws, importance weights, option positions |
| `lib/leakage.mjs` | forbidden state keys, the span-skeleton registry (with its masks), the held-out wording guard |
| `lib/registry.mjs` | reserved worlds (dev 1-400, test 7000-7039 and 7040-7199) |
| `lib/counterfactual.mjs` | one-sentence re-render through an opaque line provider; leak repair |
| `lib/probe.mjs` | bag-of-words logistic probe (unigrams + bigrams, plain JS) |
| `lib/pin.mjs` | bed pin over the allow-list, the frozen copy, the drift record |
| `lib/coverage.mjs` | the §1.5 coverage script (100 inventory decisions: 47/18/35) |
| `lib/harness.mjs` | test helpers for every group's test file |
| `build.mjs` | §3.1 slice table, record checks, build driver, build verifier |
| `export-kev.mjs` | factory records -> Kev JSONL + meta sidecar |
| `judges/kit.mjs` | port-kit interface: `buildState(task, slots)`, `questions(port, slots)`, `request(port, task, slots)` |
| `test/contracts-lib.test.mjs` | this group's acceptance tests |

## Running the tests

```sh
node --test experiments/kev-data/test/contracts-lib.test.mjs     # this group, runs alone
node --test experiments/kev-data/test/*.test.mjs                 # every group
```

Node 24's `node --test` does not take a directory argument (`node --test experiments/kev-data/test/`
fails with `Cannot find module`), so pass the files or a glob. The contracts-lib file took 54-56 s warm
on 2026-10-08 (30 tests): the Python batches (Kev import, tokenizer load, every count) take about 6 s
each warm and about 70 s cold; the seeded-defect test runs 11 mutant copies through child
`node --test` processes (about 30 s); the strace check needs `strace` and is skipped (with a
diagnostic) where it is missing or cannot trace.

Environment variables (all optional): `KEV_DATA_SCRATCH` (scratch root for temp dirs, default
`os.tmpdir()`), `KEV_DATA_KEEP_TMP=1` (keep them), `KEV_DATA_PYTHON` (default
`/opt/kev-venv/bin/python`), `KEV_DATA_KEV_ROOT` (default `/home/user/jaredpalmer/kev`, must be at
`5e42a7a0`), `KEV_DATA_HF_HOME` (default `/opt/hf-cache`; always offline).

Tests read beds only from a frozen copy in a scratch directory and generate only train-range dev
worlds (seeds 401-500). They never generate or read a test-split world (seed >= 5000) or anything
under `beds/sealed/`; some record checks put test-range seed numbers in `meta` without building a
world.

## `spec/ports.json`

```js
import { loadSpec, validateSpec } from './lib/contracts.mjs';
const { spec, hash, contracts } = loadSpec();   // deep-frozen; contracts = {...spec.ports, ...spec.ledgerOnly}
validateSpec(spec);                              // { ok, errors: ['R2: missing wording Q3', ...] }
```

Top level: `schema`, `program`, `conventions` (wire form, limits, forbidden state keys, deployment
rates, authority, budget, unknowable and variant vocabularies, `families`, `skeletonMasks`, and
`specGaps`: the cross-cutting resolutions below), `route` (unknown port -> hosted model; Kev -> weak
model `claude-haiku-5-5`, class M, owner decision O1 -> `claude-sonnet-5-5`, class L -> terminal
route; both ids are checked against `policy/models.json`), `bedPin` (the pin at which the
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
| `wordings`, `wordingNote` | `Q0` canonical, `Q1`-`Q3` training paraphrases; held-out wordings are never here |
| `slots` | `{name: {source, values?, maxChars?, mask?}}`; filled from trusted code knowledge only. A filling must be one of `values` (or at most `maxChars`); `mask: 'name'` (the records systems) puts the values in every span skeleton's masks |
| `options` or `optionSource` | fixed `{name: description}`, or variable options `{kind, pattern, min, max, describedBy}` |
| `optionsFrom`, `ordered` | the bed constant fixed options were copied from (pinned to `bedPin`); ordered scale (C6, L1) |
| `criteria` | always `[]` (the program names none), so the instructions are the wording itself |
| `companion` | S1 only: `S1_present`, a yes/no question in the same record instead of a "none" option |
| `recordQuestions` | C1 12, C3 9, Q1 4: the port's own record form holds one question per slot value |
| `state.keys` | `{key: {event, source}}`: field provenance at the time of decision; nested keys as `a.b` |
| `allowedKnowledge` | `[{knowledge, basis}]` (§1.0) |
| `deploymentRate`, `balanceWithin` | `bed-natural` (S2, I2, X1, X8), `balanced-within-entity` (R1-R4, X5, with the entity) or `uniform` |
| `budget` | `{typical, max, evidence: M/E, hardCap: 8192, windowed?}` in real Qwen3.5 tokens (§1.1; only I1 and I2 are measured) |
| `families` | `{train, heldOut, notes?}`: identifiers (a bed, `bedtype:<bed>`, `codefix:<domain>`, or a named source such as `composer`, `corpus`, `external-deepset`); held-out families are test-OOD only (§3.4) |
| `holdouts`, `heldoutWordings` | template/skeleton axes; 10/10/20 held-out wordings per OOD slice (wave 1) |
| `labelSource`, `labelMap` | where labels come from (never an LLM) and the truth -> option map (`lib/contracts.mjs mapLabel`) |
| `unknowable`, `causal`, `epsilon` | `soft-target`, `label:not_stated` or `n/a`; causal gates; risk budget (X5 0.02, others 0.05) |
| `specGaps` | every place the contract departs from or fills in the program text |

Ledger-only contracts carry `Q0`, options, state keys with provenance and `ledgerOnly: true,
training: 'none', gate: 'none'`. The build and the exporter refuse any question for them.

## Library APIs

### `lib/contracts.mjs`

`loadSpec(file?)` (deep-frozen), `validateSpec(spec)`, `checkRouteAgainstPolicy(spec)`,
`contractMasks(contracts)` (`{names, markers}` from slots marked `mask`), `familyBed(family)` (the bed a
family is drawn from: `records`, `bedtype:records`, `records-real` and `codefix:billing` are; `composer`
is not), `FAMILY_ID`, `deepFreeze`, `PORT_IDS`, `LEDGER_IDS`, `WAVE1`, and the fail-closed label lookup:

```js
mapLabel(contracts.I2, 'dep', { bedVersion: gen.VERSION })   // { label: 'relay' }
mapLabel(contracts.I2, 'echo')                                // { excluded: '<reason>' }  (count it, drop the row)
mapLabel(contracts.I2, 'shadow')                              // throws LABEL_UNMAPPED (recorded as unmapped)
mapLabel(contracts.I2, 'dep', { bedVersion: '9.9.9' })        // throws LABEL_BED_VERSION
mapLabel(contracts.R3, 'recv')                                // { label: 'same' }
```

### `lib/conform.mjs`

`conformance({programText, spec})` -> `{deviations: [{port, field, kind: changed|authored, program,
spec}], checked}`: §1.2 wordings and option descriptions verbatim (and option names where listed),
§1.1 names, option counts, budgets, the `[M]` tag, waves and the wave-1 list, §1.0 deployment rates,
§3.4 families (bases and counts) and §6.1 epsilon. `node experiments/kev-data/lib/conform.mjs` prints
the deviations. The contracts-lib test holds the allow-list (35 recorded deviations: S5 Q3, C1 and C2
wordings, the authored C3-C6, C8 and C9 wordings and descriptions, K1 descriptions) and requires a
`specGaps` entry for each; anything else fails.

### `lib/bedsync.mjs`

`BED_DERIVED` (R5, I1, I2, S5, K3, Q5) and `checkBedDerived(contracts, beds, ports)` -> error strings:
the option names and descriptions copied from bed constants, and the bed version the I2 tag table is
pinned to, compared with the frozen copy. Every build runs it for the bed-derived ports it asks
(`BED_CONTRACT_DRIFT`); the contracts-lib test runs it for all of them at the current pin.

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
`toSystemOneQuestion`). Pass `wordingText` for a held-out wording. A slot filling outside the
contract's `values` (or over `maxChars`), or an undeclared slot, throws `PORT_SLOT`. `optionOrder`
must be a permutation of the options (use `lib/balance.mjs optionOrder`). Also exported: `fillWording`,
`slotNames`, `contractOptions`, `LIMITS`, `companionContract`, `contractFor`, `judgmentRequest`,
`portOfQuestionId`, `wordingPattern(template, slotSpecs?)` (any filling, or only the contract's slot
values when `slotSpecs` is given), `normalizeWs`, `questionOf(instructions)`, and `renderState(state)`,
a JS copy of Kev's `kev/api.py render` for probes and byte estimates (exact except Python float
formatting: carry non-integer numbers as strings).

### `lib/hash.mjs`

`canonical(value)` (byte-identical to `beds/lib/canonical.mjs`), `sha256`, `tagged`, `hashOf`,
`worldHash(task)` (prompt, inputs, files; never seed, split or id), `stateHash(state)`,
`spanHash(text)` (NFC, whitespace-normalised), `skeletonText(text, {names, markers})` and
`skeleton(text, opts)` (quoted strings, `{slot}` placeholders, names, markers, dates and times, hex
runs and digits masked, lowercased; placeholders, names and markers all mask to `<n>`, so a pool line
written with `{S}` has the skeleton of its filled form), `skeletonPercent(hash)`,
`skeletonBucket(hash)` (`test-ood` 0-20%, `dev-ood` 20-30%, `calib-ood` 30-40%, `train` 40-100%),
`sentences(text)`, `recordId(record)`.

### `lib/tokens.mjs`

```js
import { countTokens, measureRecords, measureForJob, validateKevFile, kevBatch, jobMaxState } from './lib/tokens.mjs';
countTokens(['text', ...])                       // real tokens, kev.model.user_tokens, pinned tokenizer
measureRecords(records, { maxState: 8192 })      // per record {ok, fits, stateTokens, packedTokens, error}
measureForJob(records, { maxState: 8192 })       // both admission passes in one process: {results, job: {maxState, results}}
validateKevFile(path, { maxState })              // kev.data.load_records + materialize + fits per line
kevBatch([{op: 'count', texts}, {op: 'measure', records, maxState}, {op: 'load_file', path, maxState}])
jobMaxState(stateTokens)                         // the build's p99.9 (JOB_QUANTILE), clamped to [384, 8192]
```

Each call is one Python process (about 6 s warm), so batch a whole file per call. The tokenizer is
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
`checkPositionUniform(hist, {tolerance: 0.05, minPerK})`, `optionOrder(options, recordKey, {salt: 'kev-data'})`,
`counts`, `DEPLOYMENT_RATES`. Every draw is ordered by a salted hash of the row key: no
`Math.random`, so rebuilds keep the same rows.

### `lib/leakage.mjs`

```js
import { checkStateKeys, SpanRegistry, WordingGuard, leaksInto, defaultMasks } from './lib/leakage.mjs';
checkStateKeys({ kind: 'x' })        // { ok: false, hits: [{path: 'kind', key: 'kind'}] }; source_kind passes
const reg = new SpanRegistry();      // masks default to defaultMasks(): the contracts' system names
reg.add(heldOutSentence, { slice: 'heldout' | 'calib-ood' | 'dev-ood' | 'test-ood', source, port, kind, names, markers });
reg.scanState(state, { names, markers, slice })   // hits [{path, sentence, hash, entry}] that leak into `slice`
reg.masks; reg.toJSON() / SpanRegistry.fromJSON(obj)   // hashes and masks, never text (heldout/registry.json)
const guard = new WordingGuard([{ port, id, slice, text }]);
guard.check(instructions, slice)     // held-out wordings of other slices this question renders
```

The registry's masks apply on both sides: `add()` and every scan union them with the call's names
and markers, so an entry and the state it leaks into are masked alike without any generator help.
Register slotted lines with their placeholders (`{S}`, `{token}`) or with their world's masks.
`slice: 'heldout'` is test-OOD-only material (held-out bed templates, held-out family spans, held-out
entity lists). Train, calib-in and dev-select are checked against every entry; each OOD slice against
the other slices' entries (`leaksInto`). Also: `FORBIDDEN_STATE_KEYS`, `findForbiddenKeys`,
`stringLeaves`, `findUnrenderedIds(state, ids)`, `coversMasks`, `TRAIN_LIKE`, `OOD_SLICES`.

### `lib/registry.mjs`

`RESERVATIONS` (probe-pilot dev 1-400, real-reserve test 7000-7039, e2e-reserve test 7040-7199,
every bed and difficulty), `BEDS`, `worldKey({bed, split, difficulty, seed})` -> `records:dev:d3:s101`,
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

### `lib/pin.mjs`: bed pin, frozen copy, drift record

```js
import { bedPin, worktreeDiff, freezeBeds, frozenBeds, checkDriftRecord } from './lib/pin.mjs';
const frozen = freezeBeds(repoRoot);   // -> .foundry/kev-data/frozen/<pin hex>/ (+ FROZEN.json)
const beds = frozenBeds(frozen);       // { pin, commit, dir, path(rel), import(rel), read(rel) }
const { buildWorld } = await beds.import('beds/records/world.mjs');
```

The pin is sha256 over (path, mode, sha256 of content) of every file git lists at the commit under
the allow-list: the nine dev beds (`records`, `incident`, `synth`, `kinetics`, `runbook`, `gameqa`,
`gridquest`, `codefix`, `ownerci`), `beds/lib` and `beds/CONTRACT.md`. Every git call passes only
allow-listed literal pathspecs; `beds/sealed/` is never listed, hashed or opened (the test checks
this with an fs spy and, where available, `strace -f` over git's own syscalls). Symlinks are never
followed: a link is hashed as its link text, and a link whose target leaves the allow-list (into
`beds/sealed/`, another bed, an absolute path) is refused (`BED_SYMLINK`); `beds.path()` resolves real
paths inside the copy only. The frozen copy is `git archive` of the pinned commit, verified file by
file. It records the working-tree diff hash it was made under, and a later run whose diff hash
differs is refused (`BED_DRIFT`). Every build also checks the repository-level drift record
`<root>/.foundry/kev-data/drift/<pin hex>.json` (the first build of a pin writes it), so a build with
a fresh `outRoot` cannot skip the check. `beds.path()` refuses anything outside the allow-list
(`BED_PATH`). Bed modules are imported only through `beds.import`. Port kits must not import beds at
all (the runtime has no frozen copy): they work on the task they are given.

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

In an OOD slice, a port with `heldoutWordings` uses only that slice's held-out wordings (a paraphrase
record may add Q0); a port without them (wave 2 and 3) uses Q0-Q3, and its OOD axes are families,
skeleton buckets and authored lines.

Exports: `SLICES`, `RESERVED`, `SLICE_IDS`, `sliceDef`, `SLICE_PRIORITY` (evaluation slices claim a
state and a world first), `TEST_SLICES`, `LABEL_SOURCES` (`generator`, `simulator`, `oracle`, `replay`,
`journal`, `composer`, `authored-brief`, `hand-label`: never an LLM), `MAX_QUESTIONS` (6),
`HELDOUT_FAMILY_SLICES` (`test-ood` and the reserves), `REGISTRY_SLICES`, `POSITION_MIN_N` (1000),
`FACTORY_VERSION`, `seedsFor(slice, list | {first, count})`, `checkRecord`, `buildKev`, `verifyBuildDir`,
`loadHeldout`, `liveBedImports`.

### Generator interface

```js
// ports/<group>.mjs
export const group = 'records-notes';
export const ports = ['R1', 'R2', 'R3', 'R4', 'X5:records', 'X8:records', 'X1:records'];
export async function* records(slice, seeds, opts, ctx) {
  // ctx = { beds, pin, spec, contracts, slice: sliceDef(slice), heldoutDir, poolsDir }   (spec and contracts deep-frozen)
  const { buildWorld } = await ctx.beds.import('beds/records/world.mjs');
  for (const seed of seeds) {
    yield { state, questions: { R1: labelledQuestion(ctx.contracts.R1, { wording, slots, label, optionOrder }) },
            meta: { family: 'records', bed: 'records', seed, difficulty, worldHash: worldHash(task), variant: 'clean',
                    labelSource: 'generator', formId, surface, counterfactual, pairId, wordingId, needsWorldKnowledge,
                    masks: { names, markers } } };
  }
}
```

It must be pure: no `Math.random`, no clock, no network; the same (slice, seeds, opts, factory
version, bed pin) gives the same records in the same order.

### Record meta: what `checkRecord` requires

| Field | Rule |
|---|---|
| `family` | an identifier listed in `families.train` or `families.heldOut` of every port the record asks; a held-out family only in `test-ood` and the reserves (`FAMILY`, `HELDOUT_FAMILY`). F2 records name their domain (`codefix:billing`); X5 bedtype pairs are `bedtype:<bed>` |
| `bed` | required when the family is drawn from a bed (`familyBed`); one of the nine dev beds and the family's own bed |
| `seed`, `difficulty`, `worldHash` | a bed record names its own world: `seed` and `difficulty` 1-5 (checked against the reserved registry and the slice's seed range), and `worldHash` (`lib/hash.mjs worldHash(task)`), by which worlds are deduplicated |
| `worlds` | other worlds the record draws on (`records:dev:d3:s412`), checked the same way. A bed record without a seed must list them |
| `variant` | `clean`, `injection`, `distractor`, `slot-swap`, `unknowable`, `long`, `flip`, `invariance` or `paraphrase` |
| `unknowable` | the question ids whose decisive sentence was replaced (default: the only question of an `unknowable` record; required when it asks several). Soft-target ports need a `target` in train; X5's is labelled `not_stated`; an evaluation record with soft-target unknowables carries only those questions (`MIXED_UNKNOWABLE`) |
| `labelSource` | one of `LABEL_SOURCES` (never an LLM) |
| `masks` | `{names, markers}` of the record's world, added to the registry's own masks when its state is scanned |
| `pairId`, `formId`, `surface`, `counterfactual`, `wordingId`, `needsWorldKnowledge` | carried to the sidecar (§2.2) |

`checkRecord(record, {slice, contracts, variants, pin, wordings, registry})` returns `{record,
errors}`. It checks: record shape; forbidden state keys and JudgmentPort data limits; the meta rules
above; contract options and descriptions; the label (and soft target) among the offered options;
slot fillings against the contract (`SLOT`); the wording (a rendering of Q0-Q3 through
`toSystemOneQuestion`, or of the slice's own held-out wordings, as above); held-out wordings of other
slices (`WORDING`); registered spans (`SPAN_LEAK`); at most 6 questions in train, calib and dev (the
port's `recordQuestions` when larger), and in test slices and reserves one question per port per state
(one per slot value for `recordQuestions` ports; paraphrase and pair records excepted). It fills
`meta.split`, `ports`, `stateHash`, `world`, `worldKeys`, `reserved`, `unknowable` and `bedPin`.

### `buildKev`

`buildKev({root, outRoot, generators, slices, seeds, opts, spec, wordings, registry, measure,
maxState, expectPin, enforcePositions, heldoutDir, poolsDir})`:

1. Refuses to start without held-out material (`HELDOUT_REQUIRED`): a `WordingGuard` for every build,
   a `SpanRegistry` for train, calib-in, dev-select and the OOD slices, whose masks cover the contracts'
   system names (`REGISTRY_MASKS`). An empty guard or registry is an explicit choice (`H.emptyHeldout()`
   in tests); the manifest records `n` and the digest of each.
2. Freezes the beds and checks the drift record (`BED_DRIFT`).
3. Scans every generator file, and the `files` an object generator lists, for imports of the live
   `beds/` tree, transitively through kits and helpers (`LIVE_BED_IMPORT`), and refuses new
   resolutions into it while generators run. An object generator without `files` is recorded as
   `scan: 'runtime'` (a module it imported before the build is invisible to both guards; the CLI takes
   files only).
4. Runs the generators in evaluation-first slice order, fails on any record error (never a silent
   drop), drops exact duplicates, states claimed by an earlier slice (`state-in-<slice>`) and worlds
   (by `worldHash`) claimed by another world key or slice (`world-in-<slice>`, `world-duplicate`), and
   counts each drop.
5. Re-checks the bed-derived contract parts of the ports it asks (`BED_CONTRACT_DRIFT`).
6. Measures every record with Kev's `fits()` at `maxState`, sets the job maxState to the admitted
   records' p99.9 (clamped to [384, maxState]), re-checks `fits()` at it (`measureForJob`: one Python
   process), and drops and counts misfits of either pass (`misfit`, `misfit-job-max-state`): every
   written record fits the job, and Kev drops none.
7. Enforces label positions within ±5 pp in every evaluation file for each option count with at least
   `POSITION_MIN_N` questions (`POSITION`); smaller counts are reported only.
8. Writes `<outRoot>/<buildId>/kev/<slice>.jsonl`, `<slice>.meta.jsonl`, `manifest.json` (counts,
   labels, option positions, real-token p50/p90/max per port, drops, pin, digests, `jobMaxState`;
   byte-identical for the same config and pin, whatever HEAD is) and `timing.json` (the only
   non-deterministic file: timings and `bedsCommit`, the HEAD the beds were archived from), then
   verifies the written build.

`buildId` hashes the factory version, spec hash, bed pin, generator sources, config and held-out
digests. `verifyBuildDir(dir)` re-checks digests, sidecars, record checks, cross-slice state overlap
and worlds under two keys or slices. CLI: `--config <file.json>` (`{generators, slices, seeds, opts,
heldoutDir, poolsDir, ...}`; `<heldoutDir>/wordings.jsonl` and `registry.json` must exist, otherwise
`HELDOUT_MISSING`) and `--verify <dir>`.

## `export-kev.mjs`

A factory record `{state, questions: {qid: {type, instructions, criteria, label, target?}}, meta}`
becomes a Kev line `{state, questions: {qid: {..., src: 'kevdata_<port>'}}, _meta: {id, source?}}`
and a sidecar line `{id, meta}` in `<file>.meta.jsonl`, in the same order and keyed by `_meta.id`
(`recordId`, a hash of state, questions and meta). The slice is required. `_meta.source =
"unknowable"` marks evaluation records (every slice but train) whose questions are soft-target
unknowables; a train file never carries it (Kev keeps `unknowable` an eval-only source), and a
training unknowable question carries its soft target instead. X5's unknowable is the labelled class
`not_stated` and keeps the default source. Exports: `toKevRecord`, `exportKev(records, {file,
contracts, slice, guard})`, `readKevFile(file)` (round trip with id checks), `unknowableQuestions`,
`metaFileOf`, `softTargetPort`, `fileDigest`, `SRC_PREFIX`, `UNKNOWABLE_SOURCE`, `TRAIN_SLICE`. CLI:
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
kit.questions('S1_present')                 // a bound port's companion question (S1 kits)
kit.request('R1', task, { system: 'ATLAS' }, { wording, optionOrder })
  // the JudgmentPort request {port, question, criteria, state, options, optionDescriptions}; its
  // toSystemOneQuestion form is byte-identical to kit.questions(...) with the same arguments
```

The factory and the runtime import the same kit, so training states and served states come from one
function (W2: `buildState(task)` equals the factory state byte for byte), and a runtime node that
sends `kit.request(...)` to a JudgmentPort serves exactly the question the factory trained on. Also
exported: `questionFromContract`, `judgmentRequest(contract, {state, slots, wording, wordingText,
options, optionDescriptions, optionOrder})`, `companionContract`, `contractFor`, `contractOptions`,
`fillWording(template, slots, slotSpecs?)`, `slotNames`, `assertPortState`, `findForbiddenKeys`,
`FORBIDDEN_STATE_KEYS`, `LIMITS`, `KIT_INTERFACE_VERSION` (1).

## `lib/harness.mjs`: helpers for group test files

`frozenRepoBeds()` (a frozen copy of this repository's beds in a scratch outRoot, so a test run never
trips `BED_DRIFT` for a real build), `emptyHeldout()` (explicit empty `{wordings, registry}` for a
test build that needs no held-out material), `tempDir()`, `tempBedRepo(files)`, `writeFiles`,
`commitAll`, `git`, `accessSpy()` (records every fs path and child-process argument list; it cannot
see the syscalls of git itself), `mutantCopy(mutations)`, `runTests(file, {pattern, env})`,
`seededDefect({file, pattern, mutants, env})` (the unmutated copy must pass, each mutant must fail),
`checkRecords(records, {slice, wordings, registry})` (the build's record checks). A group's
seeded-defect test sets `KEV_DATA_MUTANT_RUN=1` for its child runs and skips itself there; a mutant
copy has no beds, so select tests that use stub repositories only.

## Spec ambiguities resolved here

Port-level resolutions are recorded in the contract's `specGaps` (the conformance test requires an
entry for every deviation from the program text); cross-cutting ones in `conventions.specGaps`.

- **Criteria.** The program names no criteria for any port, so every contract freezes `criteria: []`
  and the instructions are the wording itself.
- **Wordings and descriptions.** S5 Q3 and C2 Q1-Q2 differ from the program (option enumeration and
  polarity); C1 writes `{requirement description}` as `{requirement}`; C3-C6 wordings, C8 and C9
  Q1-Q3, and the K1, K3, C3-C6, C8 and C9 option descriptions are authored here.
- **I2 tag table.** The program's explicit table has 24 rows. On dev seeds 401-500 × d3-d5 the incident
  bed emits 26 tags at VERSION 4.0.0 and 4.1.0 (also `collateral` and `shadow`) and 28 at 4.2.0 (also
  `rival`, 8,704 lines, and `blip-rival`, 2,413). The 24 rows are frozen as written; the four extra
  tags are in `labelMap.unmapped` with a proposal each, **not applied**, and a build fails closed on
  them until the `incident` group maps them. The incident acceptance test "exactly the 24 tags" cannot
  pass as written. `bedVersion` moved 4.0.0 -> 4.1.0 -> 4.2.0 after re-measuring at each pin; the drift
  test and every build that asks I2 re-check the version.
- **Families.** The program writes families as prose; they are identifiers here, with qualifiers in
  `families.notes`. §3.4 holds out "codefix: 2 domains" without naming them: `codefix:routing` and
  `codefix:ratelimit` (the last two of `DOMAINS`) are pre-registered for F2.
- **Record forms.** C1 (12), C3 (9) and Q1 (4) carry one question per slot value in a record, above
  rule 5's 6; in test slices they count one question per slot value, clustered by state.
- **OOD wordings.** Ports without held-out wordings use Q0-Q3 in OOD slices.
- **Unknowables in export.** Only evaluation files carry `_meta.source = "unknowable"` (§2.5); train
  files carry the soft target. Unknowables are marked per question (`meta.unknowable`).
- **State budget.** Rule 6's two sentences are reconciled by measuring `fits()` again at the job
  maxState (the p99.9) and dropping the misfits in the factory.
- **Unstated states and descriptions.** S4, Q2, X6 and F3 states, Q3 state key names, C1 requirement
  descriptions, and L1-L3 Q0, options and state keys are authored here; R5 options are the bed's 18
  countries (the program says "≤ 40"); C4's display label is `node_label` because `label` is a
  forbidden key.
- **Budgets.** Where §1.1 and §1.2 disagree (R2, R5) the §1.1 table value is frozen; only I1 and I2
  carry measured (`M`) budgets.
- **Decisions.** X5 relates to D:A2-D:A5 and X4 to D:A10, as §1.5 maps them; "Q1 (notice kind) by
  code" in D:A10 names the decision's own question, not port Q1.
- **Span checks.** Train, calib-in and dev-select are checked against every registered span; each
  OOD slice against the other OOD slices' spans and against nothing of its own; test-in and the
  reserves are not span-checked (rule 7 names neither) but are wording-checked.
- **State limits.** A port state obeys the serving JudgmentPort's `checkData` limits (2 MiB, depth
  40), so the factory never admits a state the runtime would refuse.

## Open items

- The incident group maps (or excludes) `collateral`, `shadow`, `rival` and `blip-rival` in the I2
  tag table; until then any I2 record whose line carries one of them cannot be labelled
  (`mapLabel` throws `LABEL_UNMAPPED`).
- The incident bed keeps moving (4.2.0 committed on 2026-10-08, further uncommitted edits). Each
  version bump fails the drift test and I2 builds closed until the inventory is re-measured and the
  table re-pinned (`spec/ports.json` `bedPin`, `optionsFrom`, `I2.labelMap.bedVersion`).
- An object generator without `files` is guarded at runtime only; production builds use generator
  files (the CLI takes nothing else).
- The held-out material does not exist yet (`heldout-author`); real builds are refused until
  `.foundry/kev-data/heldout/wordings.jsonl` and `registry.json` exist.
