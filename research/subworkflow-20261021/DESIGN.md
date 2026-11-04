# SW-1 design: adaptive in-node sub-workflows (self-build vs the governing builder)

2026-10-22. Gap A5 / F4 in [REQUIREMENTS-COVERAGE-20261021.md](../REQUIREMENTS-COVERAGE-20261021.md): an agent inside a
workflow node realises it needs a sub-workflow and creates one ("one node can maybe need a complex workflow too ... don't
dumb down the efficiency of the model working on it"), and owner message [75]: "build a sub-solution themselves or send
it outwards to the governing harness to use a fresh Haiku builder?". Author: the orchestrator's Opus 5.5 worktree agent.
Code: [experiments/subworkflow/](../../experiments/subworkflow/). Bed: [beds/golive](../../beds/golive/README.md).

## §1 The node and its envelope

A parent workflow (code) runs one intake node per sales channel. A node is a Haiku 5.5 agent with four inputs
(`channel`, `spec` = the parent's go-live rules, `notes`, `export`), a declared answer contract (the bed's
`nodeOutputSchema`, bound by the parent; the node cannot change it) and an **authority envelope**:

| envelope field | value | where enforced |
|---|---|---|
| inputs | the node's four inputs (A2: only those its request names) | `checkSpec` (static), and the run only receives that subset |
| ops | pure ops only: `parse_table`, `code`, `judge_rows`, `verify`, `call` | `checkSpec`; `runSpec` refuses effect ops at run time; the call host refuses `effects != 'none'` callees |
| models | `claude-haiku-5-5` (policy/models.json) | `checkSpec`; the ModelPort `allowedModels` |
| budget | node $0.15 in all; a child is carved from what the node has left, at most $0.06, keeping $0.02 for a fallback answer | `checkSpec` (asks above the carve are refused), the call host's budget tree (reservation < caller's remaining), the judge step's per-call reserve check |
| depth | at most 2 (a sub-workflow may call one nested sub-workflow) | `checkSpec` (static, nested specs re-checked at depth+1), the call host `maxDepth` |

Anything outside the envelope is never widened: `checkSpec` refuses the spec and records each widening as a **proposal**
for the owner (`executed: false`); the builder gets the refusal as feedback. A governing builder's `notCovered` items
(things the request or data asks for that no template does, such as writing typos back to the legacy system or e-mailing
a list) are also recorded as proposals, never done. Three layers refuse an effect independently (static check, call host,
runtime), and `analyze.mjs` re-checks every spec that ran after the fact.

## §2 The sub-workflow language (subworkflow/1, `dsl.mjs`)

Typed JSON: ordered steps over a closed op set, references `$in.<input>` / `$<step>[.<path>]` checked before anything
runs, a declared output, the models used and the budget asked. `code`/`verify` steps run in `src/sandbox.mjs` (fresh
namespaces, no network, no host files, PATH-only environment); `judge_rows` is a batched, schema-typed model call (closed label enum, every row
labelled or retried once) through the caller's ModelPort scope with a per-call budget reserve; `verify` steps stop the
run with their problems; `call` runs a nested spec through the call host (depth + 1). Code owns the procedure; the model
only labels free text.

## §3 Binding (`bind.mjs`)

A checked spec is registered **by content hash** in the flow-v3 library registry (`experiments/jit/call-host.mjs`
`createRegistry`; the stub's text is the canonical spec, so the hash is the spec) and invoked as an ordinary `flow:call`
request from the node's root scope (`host.request({op: 'call', callee: <hash>, ...})`). The host enforces what it does
for every callee: unknown hash, recursion, depth, tree size, effects `'none'` only, input/output contracts and the budget
tree. The child runs in process (stub mode); its model calls go through the child's scope of the same journaled
ModelPort, so every call is booked to the span that made it. No `src/runtime.mjs` change.

Before the real run: a **practice run** ($0) on the node's own input with every judgment stubbed to the first label, and
the **contract gate** (`gateProblems`: the answer schema with enum errors naming the allowed values, the node's own
channel, unique refs, quarantine disjoint from imports, totals equal to the imports, every ref present in the export).
The same gate runs on the real answer. Any failure goes back to the builder as feedback, at most 3 repair rounds; then
the node answers directly (a logged fallback).

## §4 Builders and templates (`templates.mjs`, `prompts.mjs`)

Four frontier-written templates (author: this agent; the same author as the bed, a declared threat): `legacy-export-intake`
(parse dialect, keep newest row, repair O-typos, quarantine impossible dates, judge statuses in batches of 15, cutover,
convert, total; verify steps check the `#END` trailer row count and per-currency sums and the answer labels),
`json-list-intake`, `batch-classify`, `two-list-reconcile`. A builder only selects a template and fills typed slots
(column names, dialect enums, rates, labels, cutoff); slot values reach code steps as JSON constants, never code.

| arm | who decides | who builds | builder context |
|---|---|---|---|
| A0 | - | nobody: one typed answer (the simple baseline) | - |
| A1 | the node (answer now, or build) | the node itself, free-form subworkflow/1 | the node's whole context + the DSL guide |
| A2 | the node (answer now, or a typed request) | the **governing builder**: a fresh Haiku 5.5 call that selects and fills a template | only the typed request (goal, inputs it names, returns, budget), the answer contract (attached by code) and the named inputs |
| A1F / A2F | the parent (legacy-export nodes always get a sub-workflow) | as A1 / A2 | as A1 / A2 |
| A1TF | the parent | the node itself, from the template library (ablation: templates without a fresh builder) | the node's whole context + the catalogue |

The typed request (A2) is `{goal, inputs ⊆ node inputs, returns, budgetUsd}`; code clamps the budget to the carve
(excess → proposal) and drops inputs the node does not hold (→ proposal).

## §5 Measurement

Bed `golive` d3-d5 (d4-d5 are 110-290-row backlogs, where one-pass answers start to fail; d3 is the no-need stratum).
Node-level oracle (exact import set, quarantine set, totals), task-level oracle (every node + group totals), cost from
the journaled ModelPort, authority audit, depth and budget compliance. Frozen in [PREREG-SW-1.md](PREREG-SW-1.md).
