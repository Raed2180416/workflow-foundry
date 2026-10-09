# FLOW-V3 slice 1: `flow.call`, spans, library registry, call host

*2026-10-09. $0: no model was called; every test runs on stub gateways or scripted model ports. Companion to
[FLOW-V3.md](FLOW-V3.md) (the design; its §4 is "Minimal first slice" and its §5 is "Migration") and
[W-BED.md](W-BED.md) §3.4 (R4) and §5 (curriculum). Engine E1 (`ENGINE-FREEZE.md`) is untouched: this slice adds new
files only. No existing file under `src/`, `experiments/`, `policy/`, `schemas/`, `bin/` or `skills/` was edited, and
no existing test changed. `flow-v2.mjs` keeps sha256 `5dde4666…5223`.*

## 1. What landed

| file | what |
|---|---|
| `experiments/jit/flow-v3.mjs` (sha256 `cf02ff45…ee03` at this commit) | `flow-v2.mjs` byte for byte in every v2 primitive, plus `flow.call` and the scope/span bookkeeping. One self-contained file, because `runCompiled` copies a single SDK file to `tools/flow.mjs`. |
| `experiments/jit/call-host.mjs` | `createRegistry` (per-arm, append-only `registry.jsonl`), `createCallHost` (the host side of `call`: checks, budget carving, memo/journal, nested `runCompiled`, host event log), `classifyReuse`, `libraryHashOf`, `callKeyOf`, `withCallModel`. |
| `experiments/jit/test/flow-v3-compat.test.mjs` | 21 tests: 20 flow-v2 fixture scenarios (from `flow.test.mjs` and `flow-override.test.mjs`: every primitive, every exit path, samples, budget and 402, flags/autoFlag, the 5,000-event cap, the override hook) run under v2 and v3; stdout, exit code, `deopt.json`, `trace.jsonl` (minus `at`/`ms`) and stderr must match, and no event may carry `span`/`parent`. Plus export parity and SDK/host digest agreement. A mutation check (always emitting `childCalls`) fails all 20. |
| `experiments/jit/test/call-host.test.mjs` | 9 tests, stub mode: registry, host options, nested two levels with carving and roll-up, depth refusal, idempotent repeat and journal replay, outside-profile refusal with the curriculum fields, typed-return mismatch and callee deopt/crash, the refusal table, the port wrapper. |
| `experiments/jit/test/flow-v3-call.test.mjs` | 7 tests. Four run the SDK as a plain process against the real gateway (`startServices` + `Ledger`) with stub callees. Three run in the B1 sandbox throughout: the root through `runCompiled`, each callee as its own nested `runCompiled` (root → A → B), plus a callee guard deopt with fallback, a `maxDepth: 1` refusal and a typed-return mismatch. |

Suite: `node --test experiments/jit/test/*.test.mjs` gives **247 tests, 246 pass, 1 todo, 0 fail**. That is the 210
existing tests (209 pass + 1 todo, unchanged) plus 37 new ones. The sandboxed tests skip without user namespaces, as the
existing ones do.

### 1.1 SDK (`flow-v3.mjs`)

```js
const out = await flow.call(hash | { hash }, input, {
  name: 'close',          // span name, required (alias: label, as the slice brief names it)
  budgetUsd: 0.25,        // the child's reservation: strictly below this run's remaining budget
  timeoutMs: 120000,
  onDeopt: 'propagate',   // | 'value': return { deopt: {kind, name, detail}, status } to the caller's code
  onRefuse: 'deopt',      // | 'value': return { refused, detail }
});
```

- **Transport.** The request is `callModel({ model: 'flow:call', prompt: JSON.stringify({v: 1, op: 'call', callee, input,
  name, span, parent, budgetUsd, timeoutMs, key}) })`. That is the existing `POST /model` through the unchanged
  `tools/model.mjs`, so the solver never spawns anything. The answer is `{status: ok|deopt|refused, output | deopt |
  refused, key, span, path, depth, calleeVersion, childTrace, childTraceSha256, memo?, spentUsd, reservedUsd}`, and its
  `costUsd` is the child's whole spend. The SDK charges that through `calls.jsonl` exactly as it charges a judge call.
- **Events.** First `call-start {name, span, parent, callee, inputDigest, budgetUsd, depth, key}`, then exactly one of:
  - `call-end {ok: true, outDigest, spentUsd, reservedUsd, calleeVersion, childTrace, childTraceSha256, memo?, ms}`;
  - `call-deopt {ok: false, status, deopt: {kind, name}, detail, …same fields}`;
  - `call-refused {ok: false, refused, detail, by?: 'sdk', …}`.
- **Spans.** The span id is `call:${name}#${ordinal}`, with the ordinal per name in this process, fixed before the first
  await so it is deterministic inside `map`. `parent` is the enclosing span, `'root'` at top level. For a child run the
  host writes `tools/flow-scope.json` `{span, parent, path, depth}`. Every event of that child then carries
  `span`/`parent` of its scope, and its own `call-*` events name their own span with the scope as parent.
- **Deopts.** A refusal or a child deopt deopts the caller with kind `call` (exit 75, `deopt.json` shape unchanged, detail
  `{callee, refused | status + child}`) unless `onRefuse`/`onDeopt` is `'value'`. A gateway 402 on the request deopts with
  kind `budget`, as a judge does.
- **Totals.** The final `done`/`deopt`/`crash` event gains `childCalls` only when the run made a call. `calls` counts the
  call request's `calls.jsonl` line, as it counts every gateway request.
- **Exports added.** `CALL_MODEL`, `ROOT_SPAN`, `CALL_PROTOCOL`, `inputDigestOf`, `callKeyOf`. Every v2 export is
  unchanged, and the compat test checks `canonical`, `requestOf`, `requestDigest` and `DEOPT_EXIT` against v2.

### 1.2 Host (`call-host.mjs`)

- **Registry.** Each row is `{op: 'register', entry}` or `{op: 'revoke', hash, reason, at}`. An entry is `{hash, solvePath,
  flowVersion (2|3), contract: {input, output, taskTemplate}, profile, evidence, effects, minBudgetUsd?, registeredAt}`
  and has the shape of FLOW-V3 §1.2. `hash = 'sha256:' + sha256(solve bytes ‖ 0x00 ‖ canonical(contract))`.
  `contract.output` is required. `version` counts the registrations of one hash: a new profile or new evidence for the
  same bytes and contract is a new version, not a new hash. `list()` is the compiler index (hash, contract, profile size,
  evidence, revoked) and holds no solver bytes.
- **`createCallHost({ registry, modelPort, ledger, maxDepth = 3, workRoot, mode: 'sandbox'|'stub', allowedModels,
  maxChildren = 1000, budgetFloorUsd = 0.001, journal, arm, taskKey })`.** `maxDepth` must be 1..8.
  `host.port({ budgetUsd, ledger, selfHash })` is the root scope's model port and is passed to `runCompiled` as
  `modelPort`. It answers `flow:call` requests and passes every other request through to the real port, booking the
  cost under the scope.
- **Checks, in order.** bad-request → `unknown-hash` → `revoked` → `recursion` (callee on the ancestor chain, root's
  `selfHash` included) → `depth` (child depth > maxDepth) → `tree-size` → `effects` (only `'none'`) → `input-schema`
  (`contract.input`, repo validator) → `outside-profile` (`checkProfile(entry.profile, {prompt: taskTemplate, inputs:
  input})`) → memo by key → `BUDGET_TOO_SMALL` (below `entry.minBudgetUsd ?? budgetFloorUsd`) →
  `budget-exceeds-parent` (not strictly below `remaining = budget − spent − held by children − held by model calls`,
  and also `≤ ledger.remaining()` when a gateway Ledger is passed).
- **Run.** Sandbox mode calls `runCompiled({ solvePath, task: {prompt: taskTemplate, inputs: input}, modelPort:
  <child port>, perTaskUsd: carved budget, workdir: <workRoot>/calls/<span path>, outputSchema: contract.output,
  flowPath: FLOW_V3 | FLOW_V2, allowedModels: withCallModel(allowedModels) })`, imported unmodified. The child's
  gateway Ledger cap is the carved budget. Its result maps as follows: `ok` → `call-end`; `invalid` → `call-deopt` kind
  `output-schema` (the typed return); `deopt` → `call-deopt` with the child's `{kind, name, detail}`; `crash`/`timeout`
  → `call-deopt` kind `crash`/`timeout`. The reservation is released when the child ends, and its spend is booked to the
  caller's scope (`host.spans()`). It is also charged by the caller's gateway Ledger, through `costUsd`.
- **Idempotency.** `key = sha256(canonical({callee, inputDigest, parentPath}))`, with `inputDigest = sha256(canonical
  (input))` and `parentPath` the host's span path (`root/call:a#0`). Only `ok` results are memoised. A repeat is
  served at $0 with `memo: 'repeat'`. `host.journalRows()` fed to a new host as `journal` serves them with
  `memo: 'replay'`. SDK and host compute the same key, and the tests assert it.
- **Host event log** (`host.events`, `writeEvents(file)`). Each row holds `{kind, arm, taskKey, key, name, callee,
  calleeVersion, calleeEvidence, span, parent, path, depth, inputDigest, inputFile | input, budgetUsd, outcome, refused?,
  refusedDetail?, applicability: {checked, novel, score, n, reasons}, deopt?, childStatus?, outDigest?, outputFile |
  output?, childTrace?, childTraceSha256?, spentUsd, reservedUsd, memo, childSpent, ms}`. Inputs and outputs are stored
  content-addressed under `workRoot` (`inputs/<digest>.json`, `outputs/<digest16>.json`), so the curriculum's later
  oracle pass can score `call-end` outputs and re-run refused inputs offline. `classifyReuse(event, {oraclePass,
  calleeWouldPass})` returns one of:
  - `correct` or `wrong` (a `call-end`, scored by the oracle);
  - `missed` or `refused-correctly` (an `outside-profile` refusal, after the offline re-run);
  - `refused-other`, `deopted`.
  Missed reuse that never reaches the host (a solver re-deriving what the library holds) is not in this log. It is read
  from the solver's span tree against the library index.

## 2. Deviations from FLOW-V3.md, and why

1. **No new gateway route (§0, §4 "host `call` endpoint", §5.5).** `experiments/lib/services.mjs` is engine code under
   the E1 freeze. The call request therefore rides `POST /model` under the reserved model id `flow:call`, and the host
   intercepts it in the model port the gateway already calls. This has three consequences, each fixed by an
   integration edit in §3:
   - (a) The gateway's `allowedModels` must contain `flow:call` (`withCallModel`).
   - (b) The gateway reserves $0 for the request, so the child's reservation is held by the host. If the root's gateway
     Ledger is passed, the host also holds it on that Ledger, so the gateway 402s concurrent calls natively. Below the
     root, `runCompiled`'s Ledger is internal, and the port wrapper refuses a model call that does not fit next to a
     child in flight. It does so with code `GATEWAY_BUDGET`, which the gateway returns as **400, not 402**: a judge in
     that state escalates and then deopts `judge` instead of `budget`. The overshoot this guards against is bounded by
     one child reservation.
   - (c) `ModelPort`'s journal does not see call requests. The call journal is `host.journalRows()`.
2. **Three terminal event kinds (§2.1).** The design writes one `call-end` with optional `refused`/`deopt`. The slice
   brief names `call-end`/`call-deopt`/`call-refused`, and per-kind counts are what the reuse metrics read. Each
   terminal event carries the full `call-end` field set plus `ok`.
3. **`onDeopt: 'value'` added; `'interpret-child'` not built.** The brief needs "the parent can fall back", which the
   design only offers through `interpret-child` (local deopt, §1.5), and that needs a model-run interpreter in the host.
   `'value'` hands the deopt to the caller's code. `'interpret-child'` is rejected by the SDK with a message naming
   slice 2.
4. **Typed-return mismatch is a deopt, not a crash (§2.1 step 9).** It is reported as `call-deopt` with deopt kind
   `output-schema` (`childStatus: 'invalid'`) and propagates as kind `call`. That is the same exit path a crash takes
   (kind `crash`), with a precise label.
5. **New refusal names.**
   - `budget-exceeds-parent`: the §1.3 "strictly smaller" rule, which the design leaves unnamed.
   - `bad-request`: a malformed request.
   - `gateway-budget` (SDK, on a 402).
   - `by: 'sdk'`: a refusal from the SDK's own soft-budget pre-check, which works the way `judge` checks `budgetUsd`.
     Such a refusal never reaches the host log, so it appears only in the parent trace.
6. **Order (§2.1).** The memo is consulted before the budget checks (the design reserves first, then computes the key).
   A hit costs $0 and needs no reservation.
7. **Depth semantics.** A call is refused when the child would run at depth > `maxDepth`. With the default 3, the root
   (0) can reach a great-grandchild (3). This reads "depth ≥ maxCallDepth" as the caller's depth.
8. **Tree size** counts children per host, and there is one host per root task.
9. **Spans in children (§1.1).** "Events emitted inside a call scope" are the child's events in the child's own trace
   file. Ordinals restart per process, so a span id is unique only within its trace. The global identity is the host
   path (`root/call:a#0/call:b#0`). It is in every host event and in the key, but not in the child's own events.
10. **flow-v3 is a copy, not an `export … from './flow-v2.mjs'`.** The brief says "re-export every flow-v2 primitive
    unchanged". FLOW-V3 §5.1 already says "a copy". A re-export would need two SDK files in `tools/`, and
    `runCompiled` copies one. The guarantee is behavioural and enforced by the compat test.
11. **Unprofiled entries are callable.** `applicability.checked: false`, so a stream can choose to refuse them. The
    design assumes every entry has a profile from accepted traces.
12. **Not in slice 1:** module-level shadows, the per-call-site random shadow floor, effectful callees (refused),
    `agent`/`wide`/`plan`, the `localDeopt` field, child isolation beyond separate workdirs. Child workdirs are flat
    under `workRoot/calls/`, never inside a caller's workdir, so a caller's sandbox cannot read them.

## 3. Integration still needed (after R0's last trial; each is an engine change for the freeze rule)

All of these move the `experiments/jit` tree id and/or the kit hash. They go into a new freeze record (E2) for the
W-BED round, never into E1.

1. **`experiments/jit/prompts.mjs`.**
   - `PROMPT_VERSIONS` gains 5, and `FLOW_FILES` gains `5: 'flow-v3.mjs'`.
   - `sdk()` adds the `flow.call` block (§4) when the version is ≥ 5 and the arm has a library.
   - `method()` adds item 9 (§4).
   - `cases()` lists `library/index.json`.
   - Arms at promptVersion ≤ 4 keep their normalized config and arm hashes.
2. **`experiments/jit/compile.mjs`.**
   - `flowToolOf` maps every non-v1 version to `FLOW_TOOL_V2` today (line 26). It needs `FLOW_TOOL_V3` for version 5.
   - The builder workdir gets `library/index.json` (`registry.list()`).
   - `hostCheck` (line 146) and the builder's own gateway (line 196) take a call host's port as `modelPort` and
     `withCallModel(models)` as `allowedModels`. `hostCheck` runs all cases through one gateway session, so it needs
     either one root scope per case or a host-level "root per gateway session" with the check cap as the budget.
3. **`experiments/jit/run-compiled.mjs`.**
   - Export `FLOW_V3`.
   - Accept an optional `ledger` (or return its own on `meta`), so the root gateway Ledger can be handed to the call
     host. The host then holds child reservations natively, which fixes deviation 1(b) at the root.
   - Accept `flowScope` and write `tools/flow-scope.json` itself.
   - Add `tools/flow-scope.json` to the stale-file list (line 157). Without this, a reused root workdir could carry a
     scope file into a top-level run, which would then emit spans.
   - `meta.childCalls` from the final totals.
4. **`experiments/lib/services.mjs`.** Either a `/call` route, or special handling of `model === 'flow:call'`: exempt
   it from `allowedModels`, `ledger.hold(body.budgetUsd)` for the child's reservation before calling the port, release
   it after, and return 402 when the reservation does not fit. This replaces deviation 1(a)–(b).
5. **`experiments/jit/stream.mjs`.**
   - Per arm, a registry at `<armDir>/library/`. CUR keeps it across rungs and ISO wipes it per rung (W-BED §5).
   - On acceptance, register the version: solve bytes, contract from the bed's `stages`/`outputSchema`, `profile =
     learnProfile(accepted traces)`, evidence from `durability.mjs`.
   - Per task, `createCallHost({ registry, modelPort: this.port, workRoot: <task workdir>/calls-root, allowedModels:
     this.arm.models, arm: this.arm.slug, taskKey })`. Pass `host.port({ budgetUsd: perTaskUsd })` instead of
     `this.port` in `compiled()` (line 726), with `allowedModels: withCallModel(this.arm.models)`.
   - Append `host.events` to `<armDir>/calls.jsonl`. Add `childCalls`/`callSpentUsd` to the row.
   - Treat `deoptKind: 'call'` like the other kinds; the row already records the kind.
   - Export `host.journalRows()` beside the model journal for replay.
   - `flowPath` (line 758) already follows `flowFileOf`.
6. **`experiments/jit/check-traces.mjs` / `acceptance.mjs`.** No change is needed for answers. Diffs that cite a
   child's decision should read the child trace named in `call-end.childTrace`.
7. **Tests to add with those edits.** Pin the `flow-v3.mjs` sha256 (as `compile.test.mjs:292` pins v2), plus a
   prompt-version-5 compile on the stand-in builder and a stream row with a `call` deopt.

## 4. How the Haiku compiler is told about `flow.call` (promptVersion 5 draft; not wired)

Added to `sdk()` after the `flow.map` line, only when `library/index.json` is non-empty:

```text
  const sub = await flow.call('sha256:…', subInput, { name: 'subsidiary-close', budgetUsd: 0.25 });
                                          // runs a library solver by hash (library/index.json) on subInput and returns
                                          // its typed output; the host checks the input against the solver's contract
                                          // and profile, and refuses what it was not proven on
  const r = await flow.call(hash, subInput, { name, budgetUsd, onRefuse: 'value', onDeopt: 'value' });
  if (r.refused || r.deopt) { /* your own code or flow.judge for this part */ }
```

Added to `method()`:

```text
9. library/index.json lists solvers already accepted for earlier tasks: each has a hash, an input schema, an output
   schema, the task text it solves (taskTemplate) and how much evidence it has. When part of this task is exactly
   such a subtask, call it with flow.call(hash, input, { name, budgetUsd }) instead of re-deriving it: build input to
   match its input schema, and use its output as typed by its output schema. Copy hashes exactly from the index; never
   invent one. Give each call a budget well below your own (budgets are carved from yours; the host refuses a call
   whose budget is not strictly smaller than what remains). If a call may be refused for your inputs (a format the
   index's profile summary does not cover), pass onRefuse: 'value' and handle that part yourself; otherwise let it
   deopt. Do not call a library solver for work your own code does in a few lines.
```

The `cases()` input list gains one line: `library/index.json: the library (hash, contract, profile summary, evidence);
read-only.` The builder never sees solver bytes, another rung's oracle, or traces of library entries.
