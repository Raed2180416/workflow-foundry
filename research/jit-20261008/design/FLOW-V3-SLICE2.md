# FLOW-V3 slice 2: per-call prompts, local deopt, a tolerant input profile, the budget tree, resume, phases and the stream wiring (2a); agent nodes, the wide operator, per-item failure policy and file-aware profiles (2b)

*2026-10-14, cloud container (branch `claude/intelligent-hamilton-vg1f9a`). $0: no model was called; every test runs on
stub gateways, scripted model ports, stub subagents or stand-in builders. `beds/sealed/` was not read. Brief:
[`briefs/flow-v3-slice2-brief.md`](../briefs/flow-v3-slice2-brief.md). §1–§8 are slice 2a (items 1–4 plus 1b, 1c and the
flow-v3-compat order flake), written at the 2a commit `5d5acc8` and kept as they were except where marked. §9–§16 are slice 2b
(items 5–7, 3b, 6b and the R5 engine needs at the end of the brief). Design: [FLOW-V3.md](FLOW-V3.md); slice 1:
[FLOW-V3-SLICE1.md](FLOW-V3-SLICE1.md). Tags: **[M]** measured or read in this repo, **[I]** inference.*

Engine freeze: nothing under `src/`, `policy/`, `schemas/`, `bin/`, `skills/` changed in either half of slice 2. Every change
is under `experiments/jit/` and `experiments/lib/`, so the JIT tree ids move; the E2 candidate after slice 2b is §13.
`flow-v2.mjs` keeps sha256 `5dde4666…5223`, and the arm hashes of `dev-records-1`, `dev-kinetics-1` and `r0-records` are
unchanged (`stream.test.mjs` `V1_HASHES` green after 2b) [M]. *Correction (2b):* the 2a text said the kit hash is
`a572eeee1ac237aa` and does not move. `kitHash()` at HEAD is `852ebdf05588de97`: the E1c `src/` commit `756d6de` (before 2a)
moved it (ENGINE-FREEZE E1c). Slice 2 did not [M].

**Launch precondition (deviation, recorded as the orchestrator asked).** The brief says to launch only after the R0
records pair has finished. R0's paid streams now run from a separate frozen worktree (`/var/tmp/foundry-work/kit-e1`), so
editing `experiments/jit/` in the main tree cannot move the kit or the engine under a running stream. This slice was built
in the main tree while R0 runs elsewhere.

**Where the code landed.** Most of slice 2a's files were committed, while this work was in progress, inside the
orchestrator's snapshot `9070b0c` ("WIP snapshot of running agents (unreviewed)"). The `flow-v3 slice 2a:` commit on top of
it completes the slice (the last stream and SDK edits, the resume wiring, the flow-v3 pin and this document). The file list
in §8 covers both.

## 1. What landed

| file | change |
|---|---|
| `experiments/jit/flow-v3.mjs` | `flow.call` options `prompt`, `onRefuse: 'deopt' \| 'interpret' \| 'skip'`, `onDeopt: 'propagate' \| 'interpret' \| 'skip'` (`'value'` stays as an alias of `'skip'`, `'interpret-child'` of `'interpret'`); `promptDigest` in the key; event kind `interpret-child`; `profileWarning` on `call-end`; the `BUDGET_TREE` pre-check; `flow.phase(name, fn)`; totals `interpretedChildren`, `phases`. A v2-only solver's output is unchanged (compat test). |
| `experiments/jit/call-host.mjs` | per-call prompt; per-entry `checkOptions` and `novelMode`; host `profileCheck`, `novelMode`, `interpreter`, `interpretFloorUsd`; local deopt (`interpret-child`); `BUDGET_TREE`; `gatewayHoldUsd`; `host.totals()`; `classifyReuse` for `interpret-child`; children get their scope through `runCompiled({ flowScope })`. |
| `experiments/jit/profile.mjs` | opt-in v2 observation (`PARAMS_V2`: JSON-lines fields, tolerant line shapes) and check options (`lineFormat: 'tolerant'`, `vocabMinUnseen`); `TOLERANT_CHECK`; `checkOptionsOf`, `profileSupports`, `looseLineShape`. Default profiles and checks are byte-identical (§2.1). |
| `experiments/jit/run-compiled.mjs` | `FLOW_V3`, `SCOPE_FILE`; options `ledger`, `flowScope`, `resume`; stale `tools/flow-scope.json` removed; `meta.childCalls`, `meta.resume`; `createResumePort`. |
| `experiments/lib/services.mjs` | `flow:call` requests: exempt from `allowedModels`, the child's reservation held on the session Ledger when it fits, `gatewayHoldUsd` passed to the port, 402 only when the session budget is spent. Every other request is handled exactly as before. `FLOW_CALL_MODEL`. |
| `experiments/jit/prompts.mjs` | prompt version 5 (`FLOW_FILES[5] = 'flow-v3.mjs'`); with a library: the `library/index.json` input line, the `flow.call` SDK lines and method item 9. Without a library the v5 text is the v4 text byte for byte. |
| `experiments/jit/compile.mjs` | `FLOW_TOOL_V3`, `flowToolOf(5)`; `compile({ library, interpreter, callHost })`: `library/index.json` in the builder workdir, the builder's gateway and the host check (and `hostCheck({ library })`) go through a call host; the record gains `library`. |
| `experiments/jit/stream.mjs` | config `library` (validation, the budget rule, hashed only when set); per-arm registry at `<armDir>/library/` (ISO wipe, CUR seed); registration of adopted accepted versions; a call host, Ledger and `withCallModel` per compiled run; `calls.jsonl`, `calls-journal.jsonl`; row `calls`; export of both and of the library; deopt kind `call` in trace selection and refusal kinds; resume on the environment-fault retry. |
| `experiments/jit/test/*` | five new files (§5); `flow-v3-compat.test.mjs` flake fix; three existing assertions that pinned the prompt-version list (§6 item 1). |

### 1.1 `flow.call(hash, input, { prompt, name, budgetUsd, onRefuse })` (brief item 1)

- **Per-call prompt.** The child task is `{ prompt: opts.prompt ?? entry.contract.taskTemplate, inputs: input }`, so an R1
  pack inside R4 reaches the R1 solver with its own prompt (W-BED-R4-NOTES §10 item 1). The prompt is part of the profile
  check (prompt sentences) and of the idempotency key: `key = sha256(canonical({callee, inputDigest, parentPath,
  promptDigest}))` with `promptDigest = sha256(prompt)`; without a prompt the key is slice 1's (canonical JSON drops the
  undefined field), so slice 1 journals still replay.
- **`name` in every host event** (it already was; R4's `scoreReuse` reads `childId`, so the stream writes `childId: name`
  on every `calls.jsonl` row), plus `promptDigest` when a prompt was given.
- **`onRefuse: 'interpret'`** is FLOW-V3 §1.5 local deopt. When the host refuses for applicability (`outside-profile` or
  `revoked`), it reserves the call's `budgetUsd` from the caller (the same strictly-below rule), runs its `interpreter` on
  the child task with the callee's `contract.output` as the answer schema, validates the answer, and returns it with status
  `interpreted`. The host event and the parent's trace event are kind `interpret-child` (`localDeopt: true`, `refused`,
  `interpreted: {ok, by, traceId, costUsd}`); the host event's `outcome` stays `refused`, so R4's `scoreReuse` and
  `classifyReuse` count the reuse decision, not the fallback. The parent continues with the typed answer. A refusal the
  host cannot interpret (no interpreter, budget below `interpretFloorUsd` = $0.10 or not below what remains, or any other
  refusal reason) comes back as the refusal with `detail.interpret` saying why, and the SDK deopts the caller with kind
  `call`. A wrong-typed or missing interpreter answer is a deopt of kind `interpret-child`.
- **`onDeopt: 'interpret'`** (not in the brief's sentence, but FLOW-V3 §1.5 attaches local deopt to child deopts): a child
  that deopts, crashes, times out or returns outside `contract.output` is interpreted with what it left of the reservation,
  inside the same reservation; the answer names the deopt it `replaced`.
- **`onRefuse: 'skip'`**: the host's typed refusal object `{refused, detail}` is returned to the caller's code
  (`onDeopt: 'skip'` returns `{deopt, status}`). Slice 1's `'value'` is kept as an alias.
- **Stream side.** A library arm's interpreter is the arm's own (`jit:<interpreter>/…`), in an arm- and role-neutral
  session directory (`sessionIdOf(…, 'child', …)`); its trace is kept in the arm's `traces/` with `role: 'child'` and an
  `interpret-child` event, and it does not join the arm's own compile pool. Its cost reaches the row through the compiled
  run (the gateway charges the call's `costUsd`), so it is not spent twice.

### 1.2 Run-level resume (item 1b)

`createResumePort({ prior, live })` records every request of a run in arrival order, keyed by (salt-free request digest,
occurrence of that digest). With a prior run's rows it returns completed results at $0 (`resumed: true`; a `flow:call`
answer gets `memo: 'resume'`), until the first request the prior run does not have (its prompt differs, or it is new) or
failed; that request and every request after it go live (`divergedAt`). This is on top of the call host's per-call memo.
`runCompiled({ resume: true | rows })` wraps its model port with it and returns `meta.resume = {rows, stats}`. The stream
uses it for library arms: every compiled run records, and the retry after an environment fault resumes from the first
attempt's rows (the `compiled` event says `resumed: n`). Solvers are deterministic given their answers (no `Date` or
`Math.random`; PRNG only), so a resumed prefix replays the same control flow [I].

### 1.3 Phases as span events (item 1c)

`await flow.phase(name, fn)` emits `phase-start` and `phase-end {ok, spentUsd, calls, ms, error?}` with span
`phase:<name>#<n>` (ordinal per name, fixed before the first await) and `parent` (the enclosing phase, else the call
scope, else `root`). Every event emitted inside `fn`, across awaits and inside `map`, carries `phase: <span>`
(`AsyncLocalStorage`), so a run's progress is followable as Managed Agents' `workflow_run.phase_started/ended`. A throw ends
the phase `ok: false` and is rethrown; a deopt ends the run as usual (no `phase-end`). `spentUsd` is the run's spend while
the phase was open, so concurrent phases count each other's spend. The compile prompt does not mention phases (§6 item 9).

### 1.4 The flow-v3-compat order flake

`judges inside map, concurrently` compared stderr in order, and the per-call `[model]` lines arrive in completion order.
For scenarios marked unordered, the `[model]` lines are now compared as a sorted list and every other stderr line in
order. Six repeated runs passed [M].

## 2. The input profile (brief item 2)

### 2.1 What changed

Everything is opt-in. `learnProfile(tasks)` and `checkProfile(profile, task)` with no options are byte-identical to slice
1 (the R4 bed test still logs 5/18 and 13/24; `profile.test.mjs` 13/13). `experiments/library/` and `eval-profiles.mjs`
use the defaults and are unaffected (library suite green).

- **`learnProfile(tasks, PARAMS_V2)`** records `params.observe = {jsonLines, looseLines}` and adds observations only:
  - *JSON-lines fields*: a string whose lines are mostly JSON objects is also walked field by field at
    `<path>⟨jl⟩.<key>`, with every per-path feature except enum values (values inside line text are not enum-checked,
    as for delimited lines).
  - *Tolerant line shapes* (`looseLineShape`), stored as `lineSigsLoose` / `lineFamsLoose` beside the v1 maps:
    delimiters inside double quotes and thousands separators (`1,053,317`, `53,423.00`) do not cut fields; a `key=`
    label that holds a digit (`dated 18 August 2024:`) is a value field; a field with digits keeps its shape (letters `A`,
    digit runs `9`) instead of the coarse `A9`, and a date-like token keeps its digit-group lengths (`2024/10/25` →
    `####/##/##`, `25/10/2024` → `##/##/####`); a value of one or two lines is observed as lines when every line is a
    delimited record (a KOBO list with one invoice).
- **Check options** (per registry entry `checkOptions`, over the host's `profileCheck`): `ignore` (as before),
  `lineFormat: 'tolerant'` (the loose maps with a **line-weighted** rate: the share of the value's lines whose signature is
  unseen, so one odd line in an 85-line export moves it little and a re-rendered column moves every line; a one-line
  record list at a line path is checked as a line, not by shape), `vocabMinUnseen: n` (n unseen words before vocabulary
  novelty counts). `TOLERANT_CHECK = {ignore: SIZE_FEATURES, lineFormat: 'tolerant', vocabMinUnseen: 2}`. A tolerant
  check of a v1 profile throws, and `registry.register` refuses that combination.
- **`novelMode: 'refuse' | 'warn'`** (entry over host): `warn` writes a `profile-warn` host event, runs the call and
  returns the warning, which the SDK puts on `call-end` as `profileWarning`.

### 2.2 Measured: R4 false refusals and planted refusals (dev evidence)

Protocol of W-BED-R4-NOTES §6: the R1 profile is learned on the R1 stream shape (R1 dev 301–316 at d3, 317–324 at d4) and
checked on the R1 packs of R4 parents at d2–d5 (child difficulty clamped to 3–4). "in-dN" are unplanted (in-profile) packs
at child difficulty N; "planted" are the CYYDDD packs; "on system" means a reason names the planted system's path. The
options were chosen while looking at parents 341–346, so those numbers are development evidence; parents 301–324 were
measured once with the same options as a second dev set (also dev split; not held-out) [M].

| parents | profile + check | in-d3 false refusals | in-d4 false refusals | planted refused (on system) |
|---|---|---|---|---|
| 341–346 | v1, defaults (**before**) | **5/18** | **13/24** | 24/24 (24) |
| 341–346 | v2 + `TOLERANT_CHECK` (**after**) | **0/18** | **0/24** | **24/24 (24)** |
| 301–324 | v1, defaults | 14/72 | 61/96 | 96/96 (96) |
| 301–324 | v2 + `TOLERANT_CHECK` | 0/72 | 0/96 | 96/96 (96) |

Target (≤ 1/20 at each difficulty, planted 24/24) is met on both sets. The 341–346 rows are pinned in
`profile-tolerant.test.mjs`.

**Ablation** (v2 profile; which parts matter) [M]:

| check options | 341–346 in-d3 / in-d4 | 301–324 in-d3 / in-d4 | planted |
|---|---|---|---|
| `ignore: SIZE_FEATURES` | 4/18, 11/24 | 14/72, 56/96 | all |
| + `lineFormat: 'tolerant'` | 0/18, 8/24 | 0/72, 47/96 | all |
| size + `vocabMinUnseen: 2` (exact lines) | 4/18, 4/24 | 14/72, 21/96 | all |
| tolerant + `vocabMinUnseen: 2`, size checked | 1/18, 4/24 | 0/72, 12/96 | all |
| all three (`TOLERANT_CHECK`) | 0/18, 0/24 | 0/72, 0/96 | all |

The residual false alarms that each part removes, read from the reasons: size (ATLAS/VERITAS/TALLY line counts and
lengths above the stream's range); line formats (VENDEX lines whose date sat inside a `key:` label, a TALLY line cut by a
JPY thousands separator, a one-line KOBO list checked as a short string, one odd line in a long customer export); single
rare status words in record lists (`held`, `batch`, `parked`, `routed`, `paused`, `queued`).

**VERITAS (the R4 blind spot).** Re-dating every VERITAS `issued` value of the 42 in-profile packs with VERITAS
(parents 341–346) in CYYDDD: v2 + `TOLERANT_CHECK` refuses 42/42, each naming `inputs.invoices.VERITAS⟨jl⟩.issued`; v1
(size ignored) refuses 15/42, exactly the 15 packs it refuses without the plant, so the plant itself is invisible to it
(pinned in the test) [M]. VERITAS can now be a plantable system for the bed (a bed change, not made here).

**Synthetic drift diagnostic** (dev; the same 42 in-profile packs, one format drift each; not pinned) [M]:

| drift | v1 defaults | v1, size ignored | v2 + `TOLERANT_CHECK` |
|---|---|---|---|
| VERITAS `issued` in CYYDDD | 18/42 | 15/42 | 42/42 |
| VERITAS `amount` as a JSON number | 42/42 | 42/42 | 42/42 |
| BRIGHTDESK dates ISO | 42/42 | 42/42 | 42/42 |
| LEDGR amounts `EUR 4,487.18` instead of `4.487,18 EUR` | 18/42 | 15/42 | 42/42 |
| KOBO dates DD/MM/YYYY instead of YYYY/MM/DD | 16/38 | 14/38 | 38/38 |
| ATLAS dates `20241009` instead of `10/09/2024` | 18/42 | 15/42 | 42/42 |

v1's 18/42 on the shape-preserving drifts is its false-alarm rate, not detection. The finer field shapes and the
date-group lengths were added after the first tolerant version passed the target but went blind to the last three drifts
(0/42, 0/38, 0/42); they did not cost any false refusal on either set.

**Limits [I].** These are dev seeds of one family, and the options were tuned on them. A profile still sees shape, not
meaning: a drift that keeps every field's shape (a day/month swap inside `##/##/####`, a currency that changes what an
amount means) passes, and is left to the callee's guards, invariants and shadows. `vocabMinUnseen: 2` also lets a single
new status word through, which a compiled callee might mishandle; that is a deliberate trade for the R4 reuse measurement,
and `novelMode: 'warn'` exists for streams that want the evidence without the refusal. The held-out test of the options is
the W-bed round itself (the R4 held-out rungs).

## 3. The budget tree (brief item 3)

- **Rule.** A child's reservation must be strictly below the caller's remaining budget, where remaining already holds back
  the reservations of the caller's children in flight: Σ reservations in flight + this reservation < budget − spent (−
  model calls in flight below the root). The SDK checks it before sending (as `judge` checks its soft budget) and the
  host checks it again with its own accounting.
- **Refusal.** When the call would fit if the siblings in flight were done, it is refused `BUDGET_TREE` with
  `{budgetUsd, remainingUsd, shortfallUsd, inFlight, reservedInFlightUsd, parentBudgetUsd, parentSpentUsd}`; when it would
  not fit even alone, it is refused `budget-exceeds-parent` with slice 1's detail. Example (tested): `map` of three $0.40
  calls under a $1 budget at concurrency 3 runs two and refuses the third `BUDGET_TREE`, shortfall $0.20; at concurrency 1
  all three run.
- **Gateway.** `services.mjs` now holds a `flow:call` reservation on the session Ledger while the child runs, when it fits
  strictly below what remains, and passes `gatewayHoldUsd` to the port; the host then does not hold it again and counts
  that hold back into `remaining`. A judge that does not fit next to children in flight waits at the gateway, as judges
  already wait for each other. This removes slice 1's deviation 1(a)–(b) (the root Ledger now holds natively; the
  `allowedModels` exemption replaces `withCallModel`, which is kept for older callers).
- **Stream rule**, validated in `normalizeConfig` for configs that declare `library`:
  `perTaskUsd ≥ concurrency × childBudgetUsd + parentMarginUsd` with `parentMarginUsd > 0` (the margin keeps the
  inequality strict for `concurrency` children reserved at once). Example: `perTaskUsd` 1 with 4 × $0.30 + $0.10 is refused
  with the numbers in the message; `perTaskUsd` 1.3 passes. The rule bounds reservations, not spend: a parent's own judges
  must fit in `parentMarginUsd` while children are in flight, or they wait.

## 4. Stream wiring (brief item 4; FLOW-V3-SLICE1 §3 items 1–5)

1. **`prompts.mjs`.** `PROMPT_VERSIONS` gains 5 and `FLOW_FILES[5] = 'flow-v3.mjs'`. With `opts.library` (the index size)
   > 0 the text gains, as inserted lines only: the `library/index.json` input line, two `flow.call` lines in the SDK sketch
   (with `prompt:` and `onRefuse: 'skip'`), and method item 9 (when to call, copy hashes exactly, name calls after the part,
   K concurrent calls need K × budgetUsd below the parent's budget, `onRefuse: 'interpret'` at ≥ $0.10 or `'skip'`). Without
   a library the v5 text is the v4 text byte for byte (tested); v1–v4 texts are unchanged (their frozen hashes pass).
2. **`compile.mjs`.** `FLOW_TOOL_V3` for version 5. `compile({ library })` needs version 5, writes `library/index.json`
   (`registry.list()`: hash, contract, profile size, evidence, `minBudgetUsd`; no solver bytes), and puts a call host in
   front of the builder's gateway (one root scope, the builder's gateway cap as its budget) and of the host check (one root
   scope per check, the check cap). `interpreter` and `callHost` options pass through, so `onRefuse: 'interpret'` works in
   the check as in execution. The record gains `library: {entries, indexSha256, builderCalls, checkCalls}`. Tested with a
   stand-in builder in the sandbox: the builder's own run and the three host-check cases call the library solver through
   the host, the compile is accepted, the check spend is exactly the three leaf judges.
3. **`run-compiled.mjs`.** `FLOW_V3` export; `ledger` (a caller-made Ledger with `capUsd = perTaskUsd`, so the stream
   hands the root Ledger to the host); `flowScope` (written as `tools/flow-scope.json`; only with flow-v3); the scope file is
   always cleared first; `meta.childCalls`; `resume`.
4. **`services.mjs`.** `flow:call` handling (§3).
5. **`stream.mjs`.** `config.library = {mode: 'cur' | 'iso', childBudgetUsd, concurrency, parentMarginUsd, from?,
   maxDepth = 3, check = TOLERANT_CHECK, novelMode = 'refuse', interpretFloorUsd = 0.10, register = true}`; defaults are
   written into the normalized config, so spelling them out moves no hash; set, it defines a new JIT arm (agent arms
   unchanged; tested). Per arm, the registry lives at `<armDir>/library/`: `iso` wipes it when the arm starts fresh (no
   recorded row), `cur` keeps it and seeds a fresh one from `from` (`'<prev experiment>/{slug}/library'`, relative to the
   run root). An adopted version that passed acceptance is registered: solve bytes copied to `library/solvers/`, contract
   `{input: null, output: the bed's outputSchema, taskTemplate: the newest trace's prompt}`, profile =
   `learnProfile(its compile traces, PARAMS_V2)`, `checkOptions`, `novelMode`, evidence `{familyId, experiment, arm,
   version, adoptedAt, traces, exactRate, accepted}`. Every compiled run gets a call host (the arm's interpreter for local
   deopt, the version's own hash on the ancestor chain), a gateway Ledger and `withCallModel(models)`; host events go to
   `calls.jsonl` with `childId`, the call journal to `calls-journal.jsonl`, and the row gains `calls = {childCalls,
   callSpentUsd, ends, refused, deopts, interpreted, warnings}`. Deopt kind `call` joins trace selection and the v2.2 refusal
   kinds. The export carries `calls.jsonl`, `calls-journal.jsonl` and `library/`.

**Dry run over wbed-r4** (`stream-library.test.mjs`, sandboxed, stub gateway, fake interpreter and builder, $0): a CUR arm
seeded with an R1 library entry (a stand-in R1 solver making one $0.02 judge; a PARAMS_V2 profile of R1 dev 301–324;
`TOLERANT_CHECK`) runs R4 dev 341 (warmup) and 342 at d3. The compiled parent (flow-v3, in the sandbox) maps over the two
R1 packs with `flow.call(R1, pack.inputs, {name, prompt, onRefuse: 'interpret'})` inside a phase. The in-profile pack runs
the R1 solver in its own sandbox (`call-end`, $0.02); the planted pack is refused outside its profile on the planted
system and interpreted locally (`interpret-child`, $0.05, the pack's own prompt, the call's $0.30 budget, the arm's
interpreter). The row's compiled cost is exactly $0.07 = the two `calls.jsonl` rows = the host total, and the parent's
output carries both answers [M].

## 5. Tests

| file | tests | what |
|---|---|---|
| `profile-tolerant.test.mjs` (new) | 6 | defaults unchanged; `looseLineShape` cases; JSON-lines fields; line-weighted rate, one-line lists, `vocabMinUnseen`; the R4 measurement (before/after, pinned); VERITAS |
| `call-host-slice2.test.mjs` (new) | 7 | per-call prompt and key; check options and `novelMode`; `onRefuse: 'interpret'` and the cases it cannot honour; revoked; `onDeopt: 'interpret'`; `BUDGET_TREE`; `gatewayHoldUsd` |
| `flow-v3-slice2.test.mjs` (new) | 8 | the SDK over the real gateway: prompt, `interpret`, `skip`, unhonoured interpret, `BUDGET_TREE` under `map`, the gateway's `flow:call` hold and 402, `flow.phase`; `createResumePort`; sandboxed resume through `runCompiled`; sandboxed `flowScope`, Ledger, `meta.childCalls` |
| `slice2-wiring.test.mjs` (new) | 3 | prompt v5 texts; `compile.mjs` v5 files and the flow-v3 sha pin; a sandboxed v5 compile with a library on a stand-in builder |
| `stream-library.test.mjs` (new) | 5 | `library` config, rule and hashes; ISO, registration, call host per run, deopt kind `call`, export; CUR seeding; resume on retry; the wbed-r4 dry run |
| `flow-v3-compat.test.mjs` | (21) | the order flake fixed (§1.4) |

Suite: `node --test --test-concurrency=2 experiments/jit/test/*.test.mjs` gives **276 tests, 275 pass, 1 todo, 0 fail**
(slice 1 left 247: 246 pass + 1 todo; 29 new). `experiments/lib/*.test.mjs` with `experiments/library/test/*.test.mjs`:
97/97. `beds/wbed/r4/r4.test.mjs`: 24/24 (its default-profile measurement still logs 5/18 and 13/24) [M]. The
sandboxed tests skip without user namespaces, as before.

## 6. Deviations from the brief and from FLOW-V3, and why

1. **Three existing assertions edited.** `compile.test.mjs` (2 places), `prompts.test.mjs` and `stream.test.mjs` asserted
   that prompt version 5 is unknown. Item 4 adds version 5, so they now assert that 6 is unknown and that the list is
   1–5. No other existing assertion changed.
2. **Commit trailer** per the orchestrator (`Co-Authored-By: Claude Opus 5.5`, `Claude-Session: …`), replacing the
   brief's.
3. **`'skip'` and `'value'`; `onDeopt: 'interpret'`.** The brief names `onRefuse: 'deopt' | 'interpret' | 'skip'`; slice 1
   shipped `'value'`, kept as an alias. FLOW-V3 §1.5 attaches local deopt to child deopts (`onDeopt: 'interpret-child'`);
   both are built.
4. **Only applicability refusals are interpretable** (`outside-profile`, `revoked`). The rest (unknown hash, recursion,
   depth, tree size, effects, input schema, budget) are structural or budget limits that an interpreter must not paper
   over; under `onRefuse: 'interpret'` they deopt the caller.
5. **Two budget refusal names.** `BUDGET_TREE` (siblings in flight hold the difference; names the shortfall) and slice 1's
   `budget-exceeds-parent` (too big even alone; detail unchanged, so slice 1's tests and logs keep their meaning).
6. **The gateway does not 402 a reservation that does not fit** (FLOW-V3-SLICE1 §3 item 4 said it should). A 402 ends the
   caller with a `budget` deopt before the host can give the typed `BUDGET_TREE` refusal of item 3, which the caller can
   handle with `onRefuse`. The gateway 402s only when the session budget is spent.
7. **The profile changes are opt-in** (`PARAMS_V2`, `TOLERANT_CHECK`), not new defaults: `experiments/library/` and
   `eval-profiles.mjs` read the defaults, and recorded numbers (W-BED-R4-NOTES, the profile evaluations) must stay
   reproducible. The stream's `library` option defaults to the tolerant check with a PARAMS_V2 profile.
8. **Finer line-field shapes** (§2.2) go beyond the brief's "line-format tolerance": tolerance alone met the target but
   lost three synthetic drifts; the finer shapes restored them at no measured false-refusal cost.
9. **Not in the compile prompt:** `flow.phase` (observability, not a construction choice; the builder is not told about
   it) and `novelMode`.
10. **Registration (brief item 4, SLICE1 §3 item 5).** `contract.input` is null (beds export no input schema; the profile is
    the applicability fence), and `taskTemplate` is the newest compile trace's prompt (callers pass their own `prompt`).
    *Evidence "from durability.mjs" is not built:* registration happens at adoption, before any post-adoption run exists to
    be durable; re-registering with durability evidence (a new entry version) is left to the curriculum driver.
11. **The interpreted child's trace does not reach the callee's recompile queue** (FLOW-V3 §1.5). The callee belongs to
    another rung's arm, usually a finished experiment; the trace is kept in the calling arm (`role: 'child'`, with the
    callee hash) for a later recompile of the callee. Not built here.
12. **Interpretation during compile costs money.** With `onRefuse: 'interpret'` in a parent solver, the builder's runs and
    the host check interpret refused packs too (R4: about one per case). The check cap (`checkUsd`) bounds it; sizing it is
    a PREREG decision [I].
13. **Resume order under concurrency.** "The first call whose prompt differs and everything after" is in arrival order at
    the gateway; under `map`, a request that is logically later may arrive earlier and be served from the prior run. Such a
    request has the same digest, hence the same input, so its recorded answer is still its answer; effects do not exist yet
    (`effects: 'none'`). Resume is wired into the stream only for library arms' environment-fault retries.
14. **Child workdirs and scope.** `call-host.mjs` no longer writes `tools/flow-scope.json` itself; `runCompiled({
    flowScope })` does, after clearing a stale one (FLOW-V3-SLICE1 §3 item 3).

## 7. Not in slice 2a (at the 2a commit; built in 2b: §9–§12)

Slice 2b (brief items 5–7 and the R5 additions): `flow.agent` with the host-run verify predicate, retries carrying the
failure reason, harvest and sub-compile, isolation D10, the R5 engine items (verify reads the dump, `files` in the input
profile, per-format compiled decoders with the agent as fallback, no shipped `decoder.mjs` in a compiled callee, the agent
reservation in the task budget, the `decode-dump` trace step); `flow.wide` with per-item judgment, concurrency cap, typed
coverage and prefix sharing (6b); `map`/`wide` `onItemError` and `stallMs` (3b). Then slice 3 (`flow.plan`).

## 8. E2 freeze candidate after slice 2a (superseded by §13)

| item | value |
|---|---|
| `experiments/jit` tree | `3933aba34ec51c680f6d48a7ea2baa8bd40f96b9` |
| `experiments/lib` tree | `dd3653b08c7fa59919630ad551cd8a614b733fb6` |
| `flow-v3.mjs` sha256 | `a67bcbb6c49660f178a685ad939d1e1024af6b2b5a8108862cde4b96009f81c8` (pinned in `slice2-wiring.test.mjs`) |
| `flow-v2.mjs` sha256 | `5dde46668c10c338074ee4a1ec1115632f18ddca4773a71024b4b6ee18fb5223` (unchanged) |
| kit hash | `a572eeee1ac237aa` (unchanged: no kit path changed) |
| arm hashes | dev-records-1, dev-kinetics-1, r0-records: unchanged (ENGINE-FREEZE tables) |

Changed files (snapshot `9070b0c` and the slice 2a commit together): `experiments/jit/flow-v3.mjs`, `call-host.mjs`,
`profile.mjs`, `run-compiled.mjs`, `prompts.mjs`, `compile.mjs`, `stream.mjs`; `experiments/lib/services.mjs`; tests
`experiments/jit/test/profile-tolerant.test.mjs`, `call-host-slice2.test.mjs`, `flow-v3-slice2.test.mjs`,
`slice2-wiring.test.mjs`, `stream-library.test.mjs` (new), `flow-v3-compat.test.mjs`, `compile.test.mjs`,
`prompts.test.mjs`, `stream.test.mjs` (edited); this document. Other agents' concurrent commits to `experiments/` would
move these tree ids again; the round's freeze record should be stamped from the commit it runs on.

# Slice 2b

| file | change |
|---|---|
| `experiments/jit/flow-v3.mjs` | `flow.agent(name, spec, opts)`; `flow.wide(name, spec)`; `flow.map(..., { onItemError, reduce })`; `flow.call(..., { verify })`; item contexts (`wide`/`item` tags, per-item spend, `item-deopt`); totals `agentNodes`, `wides`; exported helpers `verdictOf`, `itemPolicyOf`, `resolveAgentFiles`, `schemaErrors`. A solver that uses none of them gets the slice 2a (and so the flow-v2) trace: `flow-v3-compat` green, and `map` without the new options is flow-v2's code in place (its crash stack is unchanged). |
| `experiments/jit/call-host.mjs` | the `op: 'agent'` request (`handleAgent`) with `createCallHost({ agent })`; budget helpers shared by calls and agent nodes; `CALL_EVENT_KINDS` (totals count calls only; `agents` totals only when a run had a node); registry entries record `codeExec` and a call to such an entry is refused `executes-code`; `host.harvests()`. |
| `experiments/jit/agent-node.mjs` (new) | `agentNodeRunner` (one Claude Code session per attempt, `runClaudeCode` with the node's prompt, files, tools and an abort signal), `agentPrompt`, `codeExecutionOf`, `fileRoleOf`, `filesClusterOf`, `harvestedTracesOf`, `subCompileGroups`, limits and refusal codes. |
| `experiments/jit/profile.mjs` | opt-in `PARAMS_V3` (`observe.files`: file maps by role, `file-roles`), `STRUCTURE_CHECK`, `CONTENT_FEATURES`, `fileRoleKey`. Default, v1 and v2 profiles and checks are byte-identical (profile tests and the R4 pins green). |
| `experiments/jit/eval-dump-profiles.mjs` (new) | the R5 decoder-profile measurement of §12. |
| `experiments/jit/stream.mjs` | `config.library.agent` and `.wide`; the arm's agent runner (`agentHostOpts`, `deps.agentNode`); harvest copied to `<armDir>/harvest/` and exported; the budget rule with the agent reservation. |
| `experiments/jit/prompts.mjs` | prompt version 5 with a library: opt-in method items 10 (`flow.agent`) and 11 (`flow.wide`) and two SDK lines (inserted lines only). |
| `experiments/jit/compile.mjs` | `compile({ agentBudgetUsd, wide, outputSchema })` (opt-in; the record gains them only when set). |
| `experiments/jit/run-compiled.mjs` | `meta.usage` (tokens and the prompt-cache read share) when the port reports usage. |
| `experiments/lib/services.mjs` | `Ledger.usage` and `cacheReadShare()` (from the port's `usage`; absent until a call reports usage). |
| tests | `agent-node.test.mjs` (13), `wide.test.mjs` (7), `slice2b-wiring.test.mjs` (4), all new; `slice2-wiring.test.mjs` (the flow-v3 sha pin moved to the 2b bytes). |

## 9. `flow.agent` (brief item 5; W-BED-R5-NOTES items 10, 11, 14–17)

**SDK.** `flow.agent(name, { instructions, files, inputs, returns }, { verify, budgetUsd, minutes | timeoutMs, retries = 1,
stallMs, harvest = true, model, tools, onRefuse, onFail })`. A missing `verify` or `returns` throws at construction (FLOW-V3's
`no-verify`, `no-returns`). `files` maps an agent path to a task file, a task directory (`'dump/': 'dump/S3/'`, a leading
`files/` allowed) or `{ text }`; the SDK resolves the handles from the task it read and sends the texts. Each attempt is one
host request over the gateway (`flow:call` model, `op: 'agent'`), reserved like a call (the slice 2a budget tree; the
gateway holds it on the session Ledger). On a typed answer the SDK runs `verify(out, ctx)` **in the parent's process** with
`ctx = { files, text, inputs, attempt, name }`; `null`/`true`/`[]` is ok, a string, a list, `false` or `{ ok, reasons }` is a
failure (R5's `verifyPredicate` returns `null` or a reason and plugs in unchanged). A failed verify, a void result or no
typed answer reruns the node (at most `retries`, default 1, ceiling 2) with **`retryReason`** = the reasons, under what the
node's budget has left; after the last attempt the run deopts with kind `agent` (`{status, reasons, attempts, spentUsd}`),
or returns `{failed, reasons, attempts}` with `onFail: 'skip'`. Events: `agent-start {attempt, budgetUsd, files,
filesDigest, instructionsDigest, retryReason?}`, `agent-end {attempt, ok, status, verify, costUsd, turns,
transcriptSha256, scripts, nestedModelAttempts, hiddenPathAttempts, key, outDigest}`, or `agent-refused` (span
`agent:<name>#<n>`, one span per node, attempts by field).

**Host** (`call-host.mjs`, order of checks): `bad-request`, `no-returns` (also a `returns` the untrusted-schema compiler
rejects: no regular expressions or formats from a solver), `no-agent-runner`, `depth` (only scopes at depth ≤
`agent.maxDepth`, default 1, own nodes: a child may, a grandchild may not), `model-not-in-policy`, `tool-not-allowed`
(subset of Bash/Read/Write/Edit/Glob/Grep, at most 5; never Task/Agent), `bad-files` (paths, ≤ 400 files, ≤ 4 MB),
`third-party-text` (D10, below), the memo, `per-run-limit` (16), the budget (`BUDGET_TOO_SMALL` below $0.10, then
`BUDGET_TREE` / `budget-exceeds-parent`). At most 2 nodes run at once; later ones **wait** holding their reservation. The
runner's result is **void** on a nested model use or a hidden-path attempt (FLOW-V3 §2.2 steps 1–2), **failed** on no
answer, a stall that used up its restarts, or an answer outside `returns`, else **ok**. Key = sha256 over (name, parent
path, files, instructions, returns, inputs, attempt, retry reason): a repeat is served at $0, a journal row replays at $0, a
retry is a new key. Host events `agent-end` (`outcome ok | void | failed`) and `agent-refused` carry the node's value
inline (`output`, item 17: the decode hand-off a bed scores, under the node's name; the stream writes it to `calls.jsonl`
with `childId: 'decode-dump'`).

**Isolation (D10, item 16).** The node gets exactly the files and inputs the parent passed: in the R5 test, the dump
directory and the subsidiary id, nothing of the other packs (asserted). The runner materializes them under `files/` in a
fresh workdir; in a stream that workdir is an interpreter-family session directory named by `sessionIdOf(..., 'agent',
...)`, so the model-visible path names neither arm nor role (asserted). `agent.textLabel` is the stream's declaration of the
run's text; `'third-party'` refuses every node. The label is declared per stream, not detected [I: correct for the W-bed,
whose text is generated].

**The runner** (`agent-node.mjs agentNodeRunner`): one `runClaudeCode` session with the node's prompt (instructions, the
file list, the retry reason, the `answer.json` contract with `returns`), only the node's files, the tool list and an abort
signal. It returns the answer, cost (a killed session at its bound), turns, the transcript's sha256, the scripts the node
wrote (interpret.mjs `allScripts`: the workdir minus what the host put there, `files/` never, plus programs written
elsewhere), the nested-model scan and the hidden-path scan.

**Harvest (item 13).** An ok node's scripts, task and answer are saved as one record (`harvest/<key>.json`; the stream copies
them to `<armDir>/harvest/` and exports them). `harvestedTracesOf({hostEvents, solverTraces})` keeps only attempts whose
parent verify passed (the solver trace's `agent-end ok` with the same key) and returns compile traces (task = the node's
instructions and `{files, inputs}`, answer, scripts); `subCompileGroups` groups them per (node, returns, file roles) with the
callee contract `{output: returns}`; `compile({ outputSchema })` compiles against that schema. The sandboxed test runs a
retry and gets 2 harvested attempts and 1 compile trace.

**Same verify at the call site (item 13c).** `flow.call(hash, input, { verify })` runs the same predicate on the callee's
output (either path); a failure is a child deopt of kind `verify` (`call-deopt status: 'verify-failed'`), which `onDeopt:
'skip'` hands back. Tested on R5: a decoder stub of the task's format serves it; a decoder of another format is refused by
its profile (§12); a decoder that misreads amounts fails the verify; both fall back to the agent node, whose answer is
verified the same way.

**Code from inputs (item 14).** The registry scans each solver (`codeExecutionOf`: `child_process`, `worker_threads`, `vm`,
`eval`, the `Function` constructor, `createRequire`, a dynamic import of anything but a literal `./tools/` path, an import of
a `files/` path, `process.binding`). A call to an entry with findings is refused `executes-code` (not interpretable). The
agent node may run a shipped `decoder.mjs`: that is the agent sandbox, on synthetic text.

**Budget (item 15).** `config.library.agent.budgetUsd` joins the stream rule: `perTaskUsd ≥ concurrency × childBudgetUsd +
agent.budgetUsd + parentMarginUsd`.

**Stall (3b).** `stallMs` (per node, else `agent.stallMs`; default off): the host aborts a node whose runner reported no
progress for `stallMs` and restarts it (`agent.stallRestarts`, default 1, at most 5) under what the reservation has left;
events say `stalled`, `restarts`. The real runner's progress is workdir activity (file count, bytes, newest mtime), because
`runClaudeCode` (src/, frozen) keeps the CLI's event stream until the session ends. So a node that reads and thinks without
writing for `stallMs` counts as stalled [I: set `stallMs` well above a thinking turn].

## 10. `flow.wide` (brief item 6; 6b)

`flow.wide(name, { items | plan, itemSchema, check, maxFanout = 32 (≤ 64), worker, itemCheck, reduce, quorum = 1, verify,
budgetUsd, concurrency = 8, itemFloorUsd, onItemError, prefixShare = true, prefixHoldMs = 5000 })`.

- **Work list.** `items` (code), or `plan` (one `flow.judge` whose value is `{items}` or a list). Bounded (`maxFanout`) and
  typed (`itemSchema`, checked by the SDK's small structural validator); `check(list)` returns issues. A planned list with
  issues is asked again once with them in the prompt; still bad, the run deopts kind `wide` with `fanout`, `item-schema` or
  `check-failed`. A given list is not re-planned.
- **Workers.** A function `(item, i)`, `{ judge }` (prompt/system may be functions of the item; the check gets the item: the
  per-item judgment), `{ call }` (a library callee per item, with its own verify), or `{ agent }` (at most 2 at a time).
  `itemCheck(result, item, i)` judges each result in code; a failure fails the item.
- **Budget.** The operator's `budgetUsd` must be below what the run has left (the SDK rule). An item starts only while the
  operator's spend plus an estimate for the items in flight and this one fits (estimate = `itemFloorUsd` or the mean cost of
  finished items); the rest are `skipped`. `n × itemFloorUsd > budgetUsd` refuses `BUDGET_TOO_SMALL` up front.
- **Coverage, reduce, verify.** `reduce(results, coverage)` (code) gets `null` for items not done and `{n, done, failed,
  skipped, retried, items[]}`; `done / n < quorum` deopts `quorum`; `verify(value)` (code) failing deopts `verify`. A panel
  verifier (FLOW-V3 §2.3) is not built.
- **Events.** `wide-start`, `wide-plan {n, digest, issues, replanned}`, one `wide-item {i, status, attempts, costUsd, ms,
  heldMs?}` per item that ran, `wide-reduce`, `wide-verify`, `wide-end {ok, done, failed, skipped, spentUsd, prefix?}`.
  Every event inside an item carries `wide: <span>` and `item: <i>`, and its spend is booked to the item and the operator.
- **Prefix sharing (6b).** Judge workers with one prefix (first tier, system, schema, reasoning) form a group: the first
  item goes, and siblings that start before its first response wait for it (at most `prefixHoldMs`), so they can read one
  cached prompt prefix. `wide-end.prefix = {groups, held, heldMs}`. The judge call returns whole (no streaming), so "the
  first response begins" is approximated by "the first call returns" [I]. The cache-read share is measured where usage is
  reported: `Ledger.usage` / `cacheReadShare()` and `runCompiled().meta.usage`. With the stub ports used here there is no
  usage, so the share itself is not measured in this slice.

**Measured on R3** (`wide.test.mjs`, `wbed-r3` dev seed 301 at d5: 48 statements; a stub judge answers each statement from
the bed's reference trace, analyst side; $0) [M]:
- 48 items, one judgment each, at most 8 model calls in flight; the code reducer's answer passes R3's oracle; spend $0.48
  = 48 × $0.01, on the operator, the ledger and the items.
- With prefix sharing, exactly one call starts before the first response ends; afterwards the held siblings go.
- With `budgetUsd: 0.2` (and `quorum: 0.25`) the operator stops starting items at its budget (spent ≤ $0.20, the rest
  `skipped`); with the default quorum the run deopts `quorum`; `itemFloorUsd: 0.05` refuses `BUDGET_TOO_SMALL`
  (48 × $0.05 > $1); a $2 operator in a $2 run is refused `budget-exceeds-parent`.
- Call workers (6 library calls) and agent workers (3 nodes, `concurrency: 8` capped to 2) return typed results per item.

## 11. Per-item failure policy, stall and idempotency (3b)

- `onItemError: 'crash' | 'null' | 'retry(n)' | 'retry(n)+null'` (n 1..5) on `map` and `wide`. Default `crash` is today's
  fail-fast, including a deopt raised inside an item (it is the run's deopt, as in flow-v2). Under `null` or `retry(n)` a
  deopt inside an item (a judge that failed every tier, a guard, a refused call) fails **that item** (`item-deopt` event;
  coverage reason `deopt <kind>: <name>`) and the run goes on; a gateway budget deopt always ends the run. Nested items pass
  deopts to the nearest enclosing item that catches them.
- `null` needs a coverage reducer: `map(..., { onItemError: 'null' })` without `reduce` throws; with it `map` returns
  `reduce(results, coverage)`. On R3 with 5 of 48 statements whose judge fails every tier: `null` gives coverage 43/5/0
  and the reducer's answer (which R3's oracle still fails: a missing statement is missing); `crash` deopts the run kind
  `judge`; `retry(1)` with the failures on the first attempt only gives 48/0/0 and an oracle pass [M].
- **At-least-once contract.** A retried item runs its code again, and a stalled agent node is restarted: anything an item
  calls must be safe to call twice. Solvers have no effects and callees are `effects: 'none'` (the host refuses others),
  so this holds today; an effect primitive would need idempotency keys first (ROADMAP §2.1 sagas) [I].

## 12. Files in the input profile, and R5 dump decoders (item 12)

`PARAMS_V3` observes a file map by **role** as well as pooled: the task's `files` and, with this option, any object of
strings at a path ending in `files` (the input of a decoder callee: `inputs.files`). Each file is walked again at
`<path>⟨<role>⟩` (role = name with digit runs masked: `README.TXT`, `ar_9-9.csv`, `col9.txt`), its first line at
`⟨first⟩`, and the set of roles is a `file-roles` feature. `STRUCTURE_CHECK` ignores the content features (line formats,
vocabulary, classes, shapes, numbers, enums, prompt) and the size features, so it checks which files and paths occur.

**Measurement** (`eval-dump-profiles.mjs`; dev split only; 210 dumps: `wbed-r5` dev seeds 301–390 at d3 and d4, 301–330 at
d5; development evidence: STRUCTURE_CHECK was chosen after looking at these numbers). Per format, a decoder's profile is
learned on its first 6 dumps at d3 (d5 for the two d5-only formats) and checked on its other dumps at that difficulty
("held", a refusal is missed reuse), on its d4 dumps ("drift": README vagueness and record mix change at d4; a refusal is
drift detection), and on every dump of every other format, the d5 novel formats included ("others", a pass is wrong reuse).
Totals over the 7 formats with ≥ 8 learning-difficulty dumps [M]:

| profile + check | false refusals (held) | d4 drift refused | wrong passes (others) |
|---|---|---|---|
| v1, size ignored | 41/66 | 74/74 | 105/1288 |
| v2 + `TOLERANT_CHECK` | 33/66 | 74/74 | 105/1288 |
| v3 + `TOLERANT_CHECK` | 26/66 | 74/74 | **0/1288** |
| v3 + `STRUCTURE_CHECK` | **1/66** | 6/74 | **0/1288** |

With 4 learning dumps all 9 formats are scored: 42/84, 39/84, 28/84, **4/84** false refusals; 90/90, 90/90, 90/90, 6/90 drift
refused; 315/1680, 315/1680, **0/1680**, **0/1680** wrong passes [M].

- **The v1/v2 wrong passes are a path bug, not tolerance.** `inputs.files` (≤ 32 keys) is walked as an object, so file
  names become path segments; a name with a dot (`README.TXT`) does not parse as a segment, `parentOf` finds no parent and a
  new file is never reported as a new path. Every monthly-csv dump (new file names each month) passes every other format's
  profile (15 per format), and a monthly-csv profile passes every other format's dump. v3 walks file maps by role and
  fixes it.
- **Content checks refuse a format's own dumps.** The per-task content of several formats changes by construction
  (decoder-tool's ledger: 12/12 refused under v3 + tolerant; the code page's shuffled escape table; keyed-stanza status
  words; README prose). `STRUCTURE_CHECK` serves them and still refuses every other format, every d5 novel format included.
  The residue is jsonl-versions (1/4 held, 6/6 d4): its JSON-lines fields are paths, so a currency key every training dump's
  trailer had (`totals_minor.CHF`) is a missing path in the one refused held dump, and at d4 the trailer record carries the
  other schema version's keys (`count`, `hash_totals`, `row_total` are missing paths).
- **So the decoder fence is structure, and the check of the decode is the verify.** `STRUCTURE_CHECK` passes content drift
  inside a format by design; it is for callees whose output the caller verifies (`flow.call(..., { verify })`), and R5's
  trailer predicate is that verify (0/1,500 misses, W-BED-R5-NOTES §6). Without a call-site verify, use a content check and
  accept the missed reuse.
- `slice2b-wiring.test.mjs` pins the separation on a fixed set (keyed-stanzas learned; held stanzas served; monthly-csv,
  column-store, print-image and code-page refused under v3 + STRUCTURE_CHECK; the monthly-csv dump passes the v2 profile).

## 13. E2 freeze record after slice 2b

| item | value |
|---|---|
| commit holding the 2b code | `3393abe` (orchestrator WIP snapshot, autosave) and the snapshots before it (`b7387d9`, `db57be8`, `e7e3a3a`, `48ac5d1`); the `flow-v3 slice 2b:` commit adds this document |
| `experiments/jit` tree | `c497ad5306f65e2906837051b4cfe3ac222d14f1` |
| `experiments/lib` tree | `e6f75d0722198afe45344ac3e55706f1e5334280` |
| `flow-v3.mjs` sha256 | `161ac9355bd089b75fb6fcd5ff02ee03c26e6c552dc845b4fc88d4b791e535f6` (pinned in `slice2-wiring.test.mjs`; 2a's was `a67bcbb6…81c8`) |
| `flow-v2.mjs` sha256 | `5dde46668c10c338074ee4a1ec1115632f18ddca4773a71024b4b6ee18fb5223` (unchanged) |
| kit hash | `852ebdf05588de97` (E1c; not moved by slice 2) |
| arm hashes | dev-records-1, dev-kinetics-1, r0-records: unchanged (`stream.test.mjs` `V1_HASHES` green) |

Changed files in slice 2b (relative to the 2a commit `5d5acc8`): `experiments/jit/flow-v3.mjs`, `call-host.mjs`,
`agent-node.mjs` (new), `profile.mjs`, `eval-dump-profiles.mjs` (new), `stream.mjs`, `prompts.mjs`, `compile.mjs`,
`run-compiled.mjs`; `experiments/lib/services.mjs`; tests `experiments/jit/test/agent-node.test.mjs`, `wide.test.mjs`,
`slice2b-wiring.test.mjs` (new), `slice2-wiring.test.mjs` (pin); this document. With slice 2a's list (§8), that is the E2
change set. Other agents commit to `experiments/library/` (outside both trees) concurrently; the round's freeze record
should be stamped from the commit it runs on.

## 14. Tests (2b)

| file | tests | what |
|---|---|---|
| `agent-node.test.mjs` (new) | 13 | host: refusal table, 2 at a time, void/failed, stall and restart, harvest and sub-compile inputs, journal replay, `executes-code`, file roles and SDK file resolution; R5 end to end with a stub subagent (truth; wrong decode then corrected on the retry with the reason; nothing; wrong twice; void; refusals); decoder + agent fallback; the real runner with a stand-in CLI; sandboxed `runCompiled` with an agent node |
| `wide.test.mjs` (new) | 7 | R3 d5 (48): judgments, cap, reducer, oracle; prefix sharing and the ledger share; budget, quorum, floor; `onItemError` null/crash/retry with judge deopts in items; plan and replan; `map` policy; call and agent workers |
| `slice2b-wiring.test.mjs` (new) | 4 | `config.library.agent`/`wide`, the budget rule, hashes; the stream's agent path with fakes (arm-neutral session, trace, `calls.jsonl` value, harvest and export, row totals, compile options); prompt lines; the R5 profile separation |
| `slice2-wiring.test.mjs` | (3) | flow-v3 pin moved to the 2b bytes |

Suite: `node --test --test-concurrency=2 experiments/jit/test/*.test.mjs`: **300 tests, 299 pass, 1 todo, 0 fail** (2a left
276). The four new or timing-sensitive files passed 4 repeated runs. `experiments/lib/*.test.mjs` with
`experiments/library/test/*.test.mjs`: 124/124 (the library suite has grown since 2a). `beds/wbed/r4/r4.test.mjs`: 24/24 [M].

## 15. Deviations from the brief and from FLOW-V3, and what was not implementable as written

1. **Verify runs in the parent's process, not in the host.** The brief says "the verify predicate run by the host"; FLOW-V3
   §2.2 step 4 says the SDK runs it in the parent process. A verify is the solver's code: the host cannot run it without
   running solver code outside the sandbox. The SDK runs it on the host's typed answer, with the node's files in `ctx`, and
   only an ok verify returns the value. R5's `(rows, trailer) => null | reason` shape plugs in; `{ ok, reasons }` is
   accepted too.
2. **The runner is not `interpret()`.** `interpret()` builds the B0 arm's task prompt from the family and has no tool list or
   abort signal. `agentNodeRunner` calls `runClaudeCode` (same sandbox, same scans) with the node's own prompt, and reuses
   `interpret.mjs`'s harvest and path scans. `experiments/lib/arms/b0-agent.mjs` is unchanged (the B0 arm stays as frozen).
3. **Concurrency waits instead of refusing.** FLOW-V3 lists a `concurrency` refusal. A third node waits for a slot (holding
   its reservation): a refusal would make a `map` over nodes deopt depending on timing, which replay cannot reproduce.
4. **Files are sent as texts.** The SDK resolves the handles and the request carries `{path: text}`; the host does not see
   the task of a check-traces case or a child scope, so it could not resolve handles there. The D10 label is therefore a
   stream declaration (`agent.textLabel`), not a per-handle provenance check.
5. **The sub-compile is not triggered by the stream.** The harvest, the verified-trace filter, the per-format grouping, the
   callee contract and `compile({ outputSchema })` exist; when to run a sub-compile (how many verified attempts per format),
   with which builder and budget, and registering the result is a curriculum-driver decision left open.
6. **The trace step for the composed oracle.** The node's value is on its host event and in `calls.jsonl` under the node's
   name; building a bed's `trace.decode` from it is analyst tooling, not built.
7. **Prefix "first response begins" = first call returns** (§10), and the cache-read share is not measured here (stub ports
   report no usage).
8. **Stall progress is workdir activity** (§9), not the CLI's event stream (frozen `src/`).
9. **`wide` panel verify is not built**; a code `verify` is. `wide` with `call` workers checks each callee's output with the
   call's own `verify`.
10. **Agent workers in `wide` are capped at concurrency 2** (the host's limit), and at 16 items.
11. **`STRUCTURE_CHECK` is a dev-tuned preset** (chosen on the §12 numbers). The held-out test of it is the R5 round itself.
    `stream.mjs` still registers whole-task solvers with `PARAMS_V2` and the configured check; a decoder callee would be
    registered with `PARAMS_V3` and `STRUCTURE_CHECK` by whoever runs the sub-compile (item 5).
12. **Commit trailer** per the orchestrator, as in 2a. **Launch precondition** as in 2a: R0's streams run from the frozen
    worktree `/var/tmp/foundry-work/kit-e1`.

## 16. What slice 3 (`flow.plan`) still needs, and what 2b left open

- **`flow.plan`** (FLOW-V3 §2.4) is not started: the closed fragment vocabulary (call, judge by declared name, map), the host
  check in order (types and `$from` resolution; composition: ancestor chain, `maxNodes` 16, `maxPlansPerRun` 4; capability
  narrowing: no agent op unless the solver holds one, no hash outside the registry; the label rule for untrusted inputs;
  budget carving), hash-recorded fragments journaled and served under replay, `plan-proposed / plan-accepted /
  plan-refused` events, deopt kind `plan`. It can reuse slice 2's pieces: `callNode` and the budget tree for `call` nodes,
  `flow.judge` for judge nodes, `mapWithPolicy` for `map` nodes, the `agent` refusal table for the capability check, and
  the call host's journal for replay. Open risk unchanged: a plan proposed from untrusted data still chooses control flow
  (P9); W-bed R8 measures it.
- **From 2b:** the sub-compile trigger and decoder registration (§15 item 5); a panel verifier for `wide` and the R6
  comparison with `best_of_n` at equal tokens, which decides whether `wide` becomes a default; the measured cache-read share
  on a live port; a bed-side `trace.decode` built from the node's host event; the compile prompt's agent and wide lines have
  never met a builder (the first paid R5/R6 compile is their test).
