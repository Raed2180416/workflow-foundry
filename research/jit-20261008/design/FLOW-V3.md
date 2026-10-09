# FLOW-V3: the primitives a compiled workflow needs to nest, own agents, fan out and expand

*Design, 2026-10-09. $0: nothing was run and no model was called. Companion to [W-BED.md](W-BED.md) (the bed that
needs these primitives) and [PRIOR-ART-SWARMS.md](PRIOR-ART-SWARMS.md) (what each primitive replaces elsewhere). Tags:
**[M]** read or measured in this repo (file cited); **[I]** inference; **[W]** public documentation (URL in
PRIOR-ART-SWARMS.md). Nothing here changes `flow.mjs` or `flow-v2.mjs`.*

## 0. Scope and the one rule that shapes everything

flow-v2 (`experiments/jit/flow-v2.mjs`, sha256 `5dde4666…5223`, pinned in `experiments/jit/test/compile.test.mjs:292`
and recorded in `ENGINE-FREEZE.md:116`) has seven primitives: `input`, `step`, `judge`, `guard`, `invariant`, `map`,
`flag`, plus `note`, `spent` and `done` [M]. A solver runs in a sandbox with no network. Its only way out is the model
gateway's unix socket in `tools/` (`experiments/jit/run-compiled.mjs` header, `experiments/lib/services.mjs`
`startServices`) [M].

flow-v3 adds four primitives, each a front end to an IR construct that ROADMAP §2.1 already specifies:

| flow-v3 | ROADMAP §2.1 construct | needed first by (W-BED rung) |
|---|---|---|
| `flow.call(ref, input, opts)` | `call` by hash | R4 |
| `flow.agent(name, spec, opts)` | `executor` (delegated full agent), mandatory downstream `verify` | R5 |
| `flow.wide(name, spec)` | search operator `wide`, with `panel` as its verifier | R6 |
| `flow.plan(name, proposal, opts)` | `plan/expand` | R6 (optional), held-out rung |

**The rule.** Every new primitive is a *request to the host*, sent over the same socket as `callModel`, never something
the solver does itself. The solver never spawns a process, an agent or a child solver. Three repo facts force this:

1. The executor sandbox voids any run whose transcript starts a nested Claude CLI or calls the Anthropic API
   (`nestedModelUses`, `src/executors/claude-code.mjs:125–139`); `stream.mjs:846–857` voids compile attempts with
   `nestedModelAttempts > 0` [M]. A solver that spawned its own agent would be indistinguishable from that violation.
2. The scan sees only Claude and Anthropic endpoints (`ISOLATION-PROBE-laptop.md:241, 368`) [M]. So "nested model use
   blocked up front, not detected after" (ROADMAP §2.1 executor) can only hold if the solver has no route to a model
   except the gateway.
3. Budgets are carved by the host (ROADMAP §2.1 `call`: "a budget carved from the parent's"). The solver's own
   `budgetUsd` in flow-v2 is a soft check before each judge tier (`flow-v2.mjs` header) [M]; it cannot bound a child it
   does not control.

So flow-v3 is mostly host code (`services.mjs` endpoints, `run-compiled.mjs` child runs, a library registry) plus a thin
SDK. This keeps ROADMAP's IR guarantees (journal, replay, budgets, isolation, typed returns) in the host, where they
already live, and keeps the authoring surface code, which is what the C0 evidence favours (B1-haiku `solve.mjs` 16/16 vs
F-haiku `workflow.json` 11/16, `research/construction-20261006/REPORT-dev.md:21–26`) [M].

## 1. Shared machinery

### 1.1 Spans

Every event gains two optional fields, `span` (this scope's id) and `parent` (the enclosing scope's id). They are written
**only** on events emitted inside a `call`, `agent`, `wide` or `plan` scope, and on the start/end events of those
scopes. A solver that uses only v2 primitives emits no `span` field anywhere, so its `trace.jsonl` has the same keys as
under flow-v2 (§5). Span ids are `${kind}:${name}#${ordinal}`, with the ordinal counted per (kind, name) in the run, so
they are deterministic under replay (ROADMAP replay rule R1: control flow is a pure function of hash, input and journal).

The span tree is the **observed structure** of a run. W-BED §6.3 measures structural fidelity from it.

### 1.2 Library registry (host)

A **library entry** is what `call` resolves. It is the reusable asset of THESIS-JIT §6.7 [M]:

```jsonc
{ "hash": "sha256 of solve.mjs bytes + contract canonical JSON",      // the only way to name it
  "solve": "solve.mjs", "flowVersion": 3,
  "contract": { "input": <schema>, "output": <schema>, "taskTemplate": "<prompt used to interpret this subtask>" },
  "profile": <input profile learned from accepted traces (experiments/jit/profile.mjs)>,
  "evidence": { "runs": n, "shadowed": n, "silentMissesPer100": x, "durableSince": "<task idx>", "parent": "<hash>" },
  "effects": "none",                                                    // until sagas exist (ROADMAP §2.1 call)
  "revoked": false }
```

Entries are append-only (FRONTIER-GAPS §1 item 5: "versions become append-only") [M]. Registering an entry is a host
action after compile acceptance; a solver cannot register anything. The registry is per experiment arm (one directory
per arm, as `stream.mjs` already isolates arm state, header lines 6–10) [M], and in the W-BED curriculum it persists
across rungs (W-BED §5).

### 1.3 Budgets

- The host holds a budget tree. A child reservation is strictly smaller than the parent's remaining budget (ROADMAP §2.1
  `call`). Unused reservation returns to the parent when the child ends.
- `BUDGET_TOO_SMALL` (ROADMAP §2.1 parallel `map`): the host refuses a reservation below one call's floor for the
  child's cheapest tier, or below `agentFloorUsd` (default $0.10, about the Haiku agent's whole-task cost on records,
  $0.103, FRONTIER-GAPS §0.1) for an agent node [M for the $0.103; floor value I].
- The gateway's existing 402 handling ends a judge with deopt kind `budget` (`flow-v2.mjs`, judge loop) [M]. The same
  402 is returned to any child whose reservation is spent.
- Every scope's end event carries `spentUsd` and `reservedUsd`, so cost per span is exact, which is what N8's cost guard
  needs (FRONTIER-GAPS N8) [M].

### 1.4 Deopt kinds

flow-v2 has `guard | invariant | judge | budget` [M]. flow-v3 adds:

| kind | raised by | meaning |
|---|---|---|
| `call` | `flow.call` | the child refused (outside its profile, revoked, schema) or deopted, and the caller asked for propagation |
| `agent` | `flow.agent` | the agent node's mandatory verify failed after its retry, or its result was void |
| `wide` | `flow.wide` | the plan failed its check after one replan, or coverage fell below quorum, or the panel rejected |
| `plan` | `flow.plan` | a proposal was refused by the checker and the caller asked for propagation |

Exit code stays 75 and `deopt.json` keeps its shape `{kind, name, detail}` [M], so `stream.mjs` handles them unchanged
except for the new kind strings (it already records `deopt` kind per row; FRONTIER-GAPS S9 "Deopt kinds") [M].

### 1.5 Local deopt (the composition win)

A child deopt need not deopt the whole task. `flow.call(…, { onDeopt: 'interpret-child' })` asks the host to interpret
**only the child subtask** (the callee's `contract.taskTemplate` filled with the child input), with a budget carved from
the parent, and return that answer in place of the child's. The event says `localDeopt: true`. The interpreted child
trace goes to the callee's own recompile queue, not the parent's. This is THESIS-JIT §6.7's "composition makes healing
local" made mechanical [I]. Default is `'propagate'`, which is today's behaviour (whole-task deopt), so a v3 solver that
never sets it behaves like a v2 solver that inlined the child.

## 2. The four primitives

### 2.1 `flow.call(ref, input, opts)`: a nested workflow by hash

```js
const sub = await flow.call({ hash: 'sha256:…' }, input, {
  name: 'subsidiary-close',          // span name; required
  budgetUsd: 0.25,                   // reservation carved from the parent (host-enforced, strictly < parent remaining)
  timeoutMs: 120_000,
  onDeopt: 'propagate',              // 'propagate' (default) | 'interpret-child' (§1.5)
  onRefuse: 'deopt',                 // 'deopt' (default) | 'value' (return {refused: reason} to the caller's code)
});
```

**Host behaviour, in order.** (1) Resolve the hash in the arm's registry; refuse if absent or `revoked`. (2) Refuse if
the hash is already on the ancestor chain (no recursion through `call`; ROADMAP: "a document cannot contain its own
hash"). (3) Refuse if depth ≥ `maxCallDepth` (default 3, policy ceiling 8) or the tree has run 1,000 children (ROADMAP
§2.1). (4) Validate `input` against `contract.input`. (5) **Applicability:** check `input` against the callee's
`profile`; outside it, refuse with `outside-profile`. This is the reuse safety check of THESIS-JIT §6.7 [M]. (6) Reserve
the budget. (7) Compute the idempotency key `(calleeHash, inputDigest, parentSpanPath)`; under replay, a journaled
result for that key is returned at $0. (8) Run the callee with `runCompiled` in its **own** sandbox and workdir, with
its own `trace.jsonl` and `calls.jsonl`, under the same flow version it was compiled for. (9) Validate the output
against `contract.output`; a schema failure is a child crash.

**Events (parent trace).**
`{kind:'call-start', name, span, parent, callee, inputDigest, budgetUsd, depth, key}` and
`{kind:'call-end', name, span, ok, outDigest, spentUsd, reservedUsd, calleeVersion, refused?, deopt?: {kind, name},
localDeopt?, childTrace: '<relative path>', childTraceSha256}`. The child trace is a file, not inlined, so the parent's
5,000-event cap (`MAX_EVENTS`, `flow-v2.mjs`) [M] is not consumed by children.

**Guards, shadows, adjudication.**
- The callee's own guards and invariants run inside the child; their deopts surface as `call-end.deopt`.
- **Shadows at module level.** The host may shadow a `call` by interpreting the child subtask alone and comparing to the
  child's answer. This is cheaper than a whole-task shadow and is the "verify decisions, not answers" move of
  THESIS-JIT §6.2 at the module boundary [I]. A disagreement is adjudicated with the existing machinery
  (`stream.mjs`, majority then the arm's adjudicator) and the settled answer becomes a regression case **for the
  callee**, not for the caller.
- Random shadow floor (`jit.shadowFloor`, already in the S0-6 wiring, `ENGINE-FREEZE.md:116`) [M] applies per call
  site, so unflagged children are sampled (FRONTIER-GAPS N5) [M].

**Budget and isolation.** The child cannot see the parent's workdir, trace or inputs beyond `input` (ROADMAP P8,
private by default). Effects: callee must declare `effects: 'none'`; until sagas exist, an effectful callee is refused.

**Refuses** (`refused` values): `unknown-hash`, `revoked`, `recursion`, `depth`, `tree-size`, `input-schema`,
`outside-profile`, `effects`, `BUDGET_TOO_SMALL`.

### 2.2 `flow.agent(name, spec, opts)`: a node that owns a sandboxed subagent

```js
const rows = await flow.agent('decode-legacy-dump', {
  instructions: 'Decode the files in files/dump/ into rows of the given schema. The README there describes the layout.',
  files: { 'dump/': dumpHandle },             // data handles from flow.input() or earlier steps; nothing else is copied
  returns: ROW_LIST_SCHEMA,                   // required: typed result (validated by the host)
}, {
  model: 'claude-haiku-5-5',                  // from policy/models.json only
  tools: ['Bash', 'Read', 'Write', 'Edit'],   // allow-list, at most 5 (ROADMAP agent.tools default)
  budgetUsd: 0.30, timeoutMs: 600_000,
  verify: (rows, ctx) => rows.length === ctx.manifest.rowCount && sumMinor(rows) === ctx.manifest.controlTotal
    ? null : 'control totals differ',          // required: code predicate over (result, parent-visible context)
  retries: 1,                                 // one fresh-nonce retry on verify failure, then deopt kind 'agent'
});
```

**Host behaviour.** The host runs `interpret()` (`experiments/jit/interpret.mjs:15`, signature
`interpret({ task, familyId, outputSchema, model, budgetUsd, timeoutMs, workdir, effort, binary, traceId })`) [M] in a
fresh sandbox, with `task = { prompt: instructions, inputs: {}, files }` and `outputSchema = returns`. This reuses the
B0 arm's sandbox, tools and answer contract unchanged (`interpret.mjs` header) [M]. Then:
1. scan the transcript with `nestedModelUses`; any hit voids the result (`agent-end.void: 'nested-model'`);
2. scan for hidden-path attempts, as `stream.mjs` already does for interpreter sessions (`hiddenPathAttempts`,
   `stream.mjs:717`) [M]; any hit voids the result;
3. validate against `returns`;
4. return the value to the SDK, which runs `verify` **in the parent process** (the parent's code, not the agent's
   claim), and retries once with a new nonce if it fails.

**Why verify is code in the parent.** ROADMAP §2.1 makes downstream verify mandatory for executors [M]. The verify must
not be the agent's own statement of success: free-running agents that read untrusted data can be steered by it (THESIS
§3 item 5) [M], and "checks written by the model under test encode its actual behaviour" (FRONTIER-GAPS §1 item 2) [M].
A parent-side predicate over values the parent already holds (a manifest total, a row count, a round-trip) is the
cheapest independent check available [I]. The SDK refuses to construct an agent node without `verify`.

**Events.** `{kind:'agent-start', name, span, parent, model, budgetUsd, tools, filesDigest}` and
`{kind:'agent-end', name, span, ok, model, costUsd, turns, transcriptSha256, scripts: n, void?, verify: {ok, reason},
attempt, nestedModelAttempts, hiddenPathAttempts}`. The harvested scripts (`harvestScripts`, `writtenScripts`,
`interpret.mjs`) [M] are stored beside the child trace.

**Guards, shadows, compile.** An agent node is the interpreter running *inside* a compiled workflow. That makes it a
compile target in its own right: when the same agent node recurs across tasks, its harvested scripts and answers are
traces for a **sub-compile** of that node into a callee (`flow.call`) with its own profile. The parent keeps
`flow.agent` as the fallback: `call` with `onRefuse: 'value'`, and on `refused` the agent node runs. This is the
intra-task and cross-task JIT on a single node (FRONTIER-GAPS G6, §3.14) [I]. Shadows on agent nodes are not
scheduled: the verify is the check; a failed verify is a deopt.

**Budget and isolation.**
- Nested agents 0: the allow-list never includes `Task`/`Agent`, and the nested-model scan voids any attempt [M for the
  scan].
- At most 2 agent nodes running at once and 16 per run (ROADMAP §2.1 executor limits) [M].
- Egress none; the sandbox is `runClaudeCode`'s (`UNSHARE_ARGS`, `ENGINE-FREEZE.md` §1) [M].
- **D10:** an agent node never receives third-party text until the isolation canary passes (ROADMAP §2.1, THESIS D10)
  [M]. So agent nodes run only on synthetic W-BED rungs, never on corpus rungs (W-BED §7).
- Cost: an agent node is priced in dollars and in strong-model quota (THESIS-JIT §6.6) [M].

**Refuses:** `no-verify`, `no-returns`, `tool-not-allowed`, `model-not-in-policy`, `concurrency`, `per-run-limit`,
`BUDGET_TOO_SMALL`, `third-party-text` (a file handle labelled third-party), `depth` (agent nodes allowed only at call
depth ≤ `maxAgentDepth`, default 1, so a child workflow inside a child cannot own an agent) [I for the default].

### 2.3 `flow.wide(name, spec)`: the swarm operator

```js
const table = await flow.wide('entity-table', {
  plan: { tiers: ['claude-haiku-5-5', 'claude-sonnet-5-5'], system, prompt, schema: SUBTASKS_SCHEMA },  // a flow.judge spec
  check: (subtasks, ctx) => coverageIssues(subtasks, ctx.index),     // code: overlap, gaps, size; [] = ok
  maxFanout: 32,                                                     // ROADMAP: ≤ 32 without evidence
  worker: { judge: { tiers: ['claude-haiku-5-5'], schema: CELL_SCHEMA, prompt: s => render(s) } },
          // or { call: { hash } } or { agent: {...} }  (agent workers obey the 2-concurrent / 16-per-run limits)
  reduce: (results, coverage) => assemble(results, coverage),        // code; coverage = {done, failed, skipped}
  quorum: 1.0,                                                       // share of subtasks that must be done
  verify: { panel: { n: 3, judge: {...}, independence: 'different-model' }, sample: 0.2 } // or a code predicate
         ,
  budgetUsd: 0.6,
});
```

**Semantics.** One planner judge emits a typed, bounded subtask list. Code checks it (`check`); one replan is allowed,
with the issues in the prompt. A `map` runs the workers. A code reducer receives typed coverage (ROADMAP §2.1 parallel
`map`: "the reducer receives typed coverage") [M]. The verifier runs last, independent of the workers. `panel` is
ROADMAP's "independent verifiers with independence labels; vote, not debate" [M].

**Events.** `wide-plan {n, digest, issues, replanned}`, one `call-*`/`judge`/`agent-*` per worker with
`parent: <wide span>`, `wide-reduce {done, failed, skipped, outDigest}`, `wide-verify {kind, votes, independence, ok}`.

**Guards, shadows, adjudication.** The plan is the high-leverage read. FRONTIER-GAPS §1 item 6 shows one global read
can sink a whole solver (D11: `rules` tier-down, 7/8 → 5/8) [M]. So the planner's tier list must start no lower than
the arm's adjudicator tier unless `check` is a complete coverage proof against a code index [I]. Shadows sample
individual worker cells (decision-level). A panel rejection deopts with kind `wide`.

**Default status.** `wide` stays opt-in for compiled solvers until W-BED R6 shows it beats `best_of_n` with the same
verifier at equal tokens (ROADMAP §2.1, §3 "A swarm subsystem … must beat best-of-K with the same verifier") [M]. The
compiler prompt names it only for arms preregistered to use it.

**Refuses:** `fanout` (plan longer than `maxFanout`), `plan-schema`, `check-failed` (after one replan), `quorum`,
`BUDGET_TOO_SMALL` (`maxFanout × worker floor + plan + verify > budgetUsd`), `agent-workers-over-limit` (more than 16
agent workers).

### 2.4 `flow.plan(name, proposal, opts)`: bounded runtime dynamism

`flow.plan` lets a running solver splice in a small subgraph that a judge proposed, after a host check. The proposal is
**not code**. It is a JSON fragment over a closed vocabulary that flow-v3 interprets with its own primitives:

```jsonc
{ "nodes": [
    { "id": "a", "op": "call",  "ref": { "hash": "sha256:…" }, "input": { "$from": "input.subsidiaries[2]" } },
    { "id": "b", "op": "judge", "spec": "<name of a judge the solver already declared>", "input": { "$from": "a" } },
    { "id": "c", "op": "map",   "over": { "$from": "input.batches" }, "do": { "op": "call", "ref": { "hash": "…" } } } ],
  "out": { "$from": "b" } }
```

**Host check, in order** (ROADMAP §2.1 `plan/expand`) [M]: (1) type check: every `$from` resolves, every edge's
schema matches the next node's contract input; (2) composition check: no hash on the ancestor chain, depth and size
within `maxNodes` (default 16) and `maxPlansPerRun` (default 4); (3) capability policy: the fragment may only narrow
privileges, never widen them (no agent op unless the solver already holds an agent capability; no hash outside the
registry); (4) label policy: a node fed by data labelled untrusted may not choose a data-dropping op unless the op
names a contract rule id (FRONTIER-GAPS I3 option 1) [M]; (5) budget carving. Accepted fragments are hash-recorded and
journaled; replay serves the journaled fragment.

**Events.** `plan-proposed {name, digest, nodes}`, `plan-accepted {name, digest, span}` or
`plan-refused {name, digest, reason}`. Every expansion is an audit event (ROADMAP).

**Why not let the judge write JavaScript.** Generated code would need a second sandbox inside the solver, and the
solver sandbox has none; P9 (control flow fixed before untrusted data is read) would be lost entirely. Code generation
already has a safe home: `flow.agent`, whose output is data checked by a parent-side verify [I].

**Refuses:** `type`, `composition`, `capability-widening`, `label`, `size`, `count`, `BUDGET_TOO_SMALL`.

**Open risk [I].** A plan proposed from untrusted data still chooses control flow, which P9 forbids in its strong form.
The checks above narrow what it can choose; they do not restore P9. W-BED R8's adversarial-content faults measure
whether this matters.

## 3. What does not change

- `judge` keeps its tier escalation, samples, majority and check semantics byte for byte, including the salt-free
  `requestDigest` the replay memo uses (`flow-v2.mjs` `requestOf`) [M].
- `guard`, `invariant`, `flag`, `note`, `map`, `step`, `done`, `spent`, `input`: unchanged. `map` keeps fail-fast;
  typed coverage is a `wide` feature, not a change to `map`.
- Exit codes (0, 75, other = crash), `deopt.json`, `trace.jsonl` line format, the 5,000-event cap, the override hook
  (`tools/flow-override.mjs`).
- No effect, wait or approval primitive. FRONTIER-GAPS H2 option 2 says "Do not build `flow.await`" [M]. Effects and
  waits stay in the engine; a compiled solver is a pure activity inside an engine `compiled` node (H2 option 1). W-BED
  R7 is parked for this reason.

## 4. Minimal first slice

| rung | primitives needed | new in v3 |
|---|---|---|
| R0 (no-workflow control) | none (one call) | — |
| R1 linear pipeline | `step`, `judge`, `guard`, `invariant` | none |
| R2 judged branching | `judge` + plain `if`, `flag` for low confidence | none |
| R3 fan-out/fan-in | `map`, `judge`, code reducer, `invariant` (conservation) | none |
| R4 nested sub-workflow | `call` | **`call`**, spans, registry |
| R5 agentic node | `agent` | `agent` |
| R6 swarm | `wide` (or `judge` + `map` + code, as the ablation) | `wide` |
| held-out rung | `call` + `map` + `judge`; `plan` optional | — |

**Slice 1 = `flow.call` + spans + the library registry + the host `call` endpoint.** That is all R1–R4 need. R1–R3 run
on flow-v2 today; running them on flow-v3 too is only for the span tree, which W-BED's structural-fidelity metric reads.

Estimated size [I]: SDK side about 120 lines (span bookkeeping, `call` request/response, `onDeopt` handling); host side
about 300 lines (`services.mjs` endpoint, child `runCompiled` with carved budget, registry read/append, profile check via
`profile.mjs`, journal key); tests about 400 lines (byte compatibility §5, refusal table, budget carving, replay of a
call by key, local deopt). $0 to build and test with the existing stub gateway.

Slice 2 = `agent` (host endpoint wrapping `interpret()`, verify, void rules). Slice 3 = `wide`. Slice 4 = `plan`.

## 5. Migration from flow-v2

1. **New file, no edits.** `experiments/jit/flow-v3.mjs` is a copy of `flow-v2.mjs` plus the additions. `flow.mjs` and
   `flow-v2.mjs` keep their bytes; their pins (`flow.test.mjs:209`, `compile.test.mjs:292`) stay green [M].
2. **Prompt version 5.** `prompts.mjs` maps prompt versions 2–4 to `flow-v2.mjs` today (`FLOW_FILES`,
   `prompts.mjs:25`) [M]. Add `5: 'flow-v3.mjs'`. Arms with promptVersion ≤ 4 keep their normalized config and
   therefore their arm hashes (the v2.1 rule that options at their defaults are dropped, `stream.mjs` header) [M].
3. **Byte-compatibility test.** Run every flow-v2 test fixture solver under flow-v3 and assert identical stdout, exit
   code, `deopt.json`, and `trace.jsonl` after removing the `at` and `ms` fields. A solver that never calls a v3
   primitive must produce no `span`/`parent` keys.
4. **Engine freeze.** `experiments/` changes do not move the kit hash, but they do move the `experiments/jit` tree id
   that `ENGINE-FREEZE.md` §2 records as the JIT half of the freeze [M]. ROADMAP rule 13: no comparative run on a
   changing engine; IR and engine work happens on a branch and merges only after the round's last trial [M]. So
   flow-v3 is built on its own branch (or after R0/E1's last trial), and the W-BED round gets its own freeze record.
5. **Host changes** are in `run-compiled.mjs`, `services.mjs` and `stream.mjs` (registry per arm, child runs, new deopt
   kinds in the row). These are engine changes for the freeze rule above.
6. **Replay.** The salt-free memo (S0-2) keys judge calls by request digest [M]. `call` adds the key
   `(calleeHash, inputDigest, parentSpanPath)`; `agent` journals the agent's final answer and transcript hash under
   `(name, filesDigest, instructionsDigest, attempt)`; replay of an agent node returns the recording, and a resample is a
   new candidate with a new nonce (ROADMAP §2.1 record/replay) [M].
