# Review lane 2: IR expressiveness to ≥ 94 % and composition (2026-10-07)

*Design review. Development/diagnostic evidence only. Nothing here is implemented, and no file under `src/`,
`schemas/`, `experiments/`, `beds/`, `skills/` or `policy/` was touched. Analysed at HEAD `fd7bd27`; `src/` and
`schemas/` had no uncommitted changes (other agents' edits were under `beds/` and `experiments/` only). Corpus:
`research/corpus-20261006/items.jsonl`, sha256 `b968d168…08b3a0`, which matches `MANIFEST.json`. Corpus items were
read as data. Measurements ran on 4 vCPU (Xeon 2.1 GHz) with Node 24.21.0.*

**Evidence tags.** **[M]** measured in this session (the script is in Appendix A). **[D]** documented in the repo
(path:line) or in R09, which carries the external URLs. **[R]** platform behaviour recalled from public docs and not
re-verified this session. **[I]** inference or design proposal. Effort is in engineer-days (ed) for one engineer who
knows this codebase, including tests. Every effort figure is **[I]** with about ±50 %.

---

## 0. Summary

**What the owner asked, answered for this lane**

1. **Raise expressiveness to 94 %.** This is feasible, with three corrections.
   - The "94 %" bundle row in COVERAGE.md §4 is really **93.74 % (1,258 of 1,342 items)**. Reaching ≥ 94.0 % needs
     1,262 items. **[M]**
   - The number is a *declared* coverage. It counts converter tokens against a construct list. Nothing is
     compiled or run (COVERAGE §9 **[D]**). The existing script does not even read which constructs are
     implemented: it adds them hypothetically (`coverage-report.mjs:541–590` **[D]**). Re-running it after each
     stage would print the same 35 % until a construct ledger is added (§8).
   - Under declared coverage, nine constructs are each individually necessary for ≥ 94 %: schedule, webhook and
     event triggers, error-branch, completion-hook, adaptive-retry, call, cross-run state and the agent tool loop.
     Dropping any one of them leaves 81.6–93.3 % **[M]**. The cheapest set that crosses the line reaches 94.26 %,
     only 3 items above the threshold **[M]**; the effort weights behind "cheapest" are **[I]**. Compiled coverage
     will be lower than declared coverage, so a measured ≥ 94 % realistically needs **all 19 constructs**. Their
     declared ceiling is 99.85 %; the 2 dashboard-state items stay unsupported.
2. **A workflow inside a workflow inside a workflow, and iterative flows.** Yes:
   - `call` by hash, plus local named `flows` and `group`;
   - a static and runtime depth cap;
   - recursion only through a *local* flow or `self` with a declared `maxDepth`. A content hash cannot contain
     itself, so recursion by hash is impossible by construction **[I]**;
   - `loop` with convergence criteria, and a bounded `machine` node for arbitrary cycles. Of the 46
     unstructured-cycle items, 27 contain a cycle with several entry points, which no single `loop` can express
     **[M]**.
3. **Parallel workflows working together; subagents inside nodes; a shared board, shared state and private notes.**
   - Children are addressed by handle (`detach` and `await`), never by ambient run id.
   - Runs communicate through signals, queries, updates, a tree-scoped board and streams.
   - Delegation inside a node takes one of three bounded forms: `agent.tools` (a capped tool loop), `executor` (a
     delegated agent) and `call`/`expand` (child workflows or a checked plan).
   - State has three scopes: node-private `scratch`, the run/tree `board`, and workflow/session `state` with CAS.
     Labels persist across runs (§3.E, §4).
4. **Efficiency.** Measured on the current runtime:
   - **Superlinear per-node overhead.** A 500-node chain of trivial tasks takes 21.1 s, or 42 ms per node, against
     1.1 s for 100 nodes **[M]**. Of the time, 33 % goes to the per-step SQLite transaction (`synchronous=FULL`)
     and 19 % to re-reading and parsing the whole run blob. About 25 % goes to re-validating and canonicalizing it
     **[M]**.
   - **Head-of-line blocking.** A node that became ready at 31 ms waited until 2,051 ms for an unrelated slow
     sibling in the same scheduling batch **[M]**.
   - **Sandbox cost.** A sandboxed `code` node costs 170–270 ms **[M]**. Real workflows hold thousands of small
     expressions: 8,905 Jinja expressions in 74 Home Assistant items **[M]**.

   All three are algorithmic and fixable in JavaScript. None is an argument for a Rust port; lane 4 owns that
   question (§6).
5. **What the corpus vocabulary does not count, but honest coverage and composition need:**
   - a workflow-level **output contract** (`call`, webhook responses and chat replies are untyped without it);
   - a **sink-field label policy** and program-counter taint. Without them, ordinary
     "webhook → write row" workflows fail `LABEL_POLICY` (`validate.mjs:130–136` **[D]**);
   - a pure **expression** sub-language;
   - **sagas**, `detach`/`await`, queries and updates, heartbeats and cancellation;
   - a **resume ABI**. Any edit to the 14 engine source files strands every suspended run with `ENGINE_DRIFT`
     (`engine.mjs:11–17`, `runtime.mjs:280` **[D]**). With 30-day waits, schedules and sessions, that is fatal.
6. **Total effort [I]:**

   | Part | Effort |
   |---|---|
   | The 19 corpus constructs | ~75–115 ed |
   | Cross-cutting prerequisites and composition extras | ~50–80 ed |
   | Total | ~125–190 ed |

   §7 stages the work so that every stage ends with a declared, a compiled and an executed coverage number, plus a
   capability number.
7. **Scope.**
   - The owner's direction changes what the IR must *express*. It does not require a meta-harness, a general
     agent loop, a visual builder, a memory store or a model gateway (§9).
   - Two places need an explicit amendment:
     - THESIS §4 "not a LangGraph/n8n/Temporal replacement" becomes "expresses their control semantics, ships none
       of their product surface";
     - AGENTS.md "no resident workers": trigger ingress belongs to the host, and development uses `foundry tick`.

---

## 1. Baseline: what the Phase 1 IR and runtime do today

| Area | Today | Source |
|---|---|---|
| Node kinds | `task, assert, human, map, loop, wait, agent, code, verify` | `schemas/workflow.schema.json:99` **[D]** |
| Bounds | 500 nodes per flow; 2,000 in total (validator default); nesting depth ≤ 6; `map.maxItems` ≤ 1,000 and `concurrency` ≤ 16; `loop.maxIterations` ≤ 1,000; `wait.delayMs` ≤ 3,600,000; `retry` ≤ 10 attempts with ≤ 60 s backoff; `maxDurationMs` ≤ 30 days; `maxConcurrency` ≤ 16 | schema; `validate.mjs:146,165` **[D]** |
| Failure handling | `onError: stop|continue` on `task` and `agent` only. `code`, `verify`, `map` and `loop` have no `onError`. `code` has no `retry`. A continued node completes as `handled_error` with `{ok:false,error}`. Successors under the default `join: all_success` are skipped unless they use `all_resolved`. | `validate.mjs:89–97`; `runtime.mjs:380,539,560` **[D]** |
| Failures that cannot be handled | env faults, budget, deadline, cancellation, policy and integrity errors are never hidden by `continue`/`collect` | `runtime.mjs:48–50` **[D]** |
| Run start | only an explicit `create(workflow, input)`; no triggers | `runtime.mjs:102` **[D]** |
| Waiting | durable timers table plus `tick`; `human` is the only external-input suspension | `store.mjs:45–46`; `runtime.mjs:169,397–409` **[D]** |
| Composition | none (no `call`); map and loop bodies are nested frames inside one run blob | `runtime.mjs:332–339` **[D]** |
| State | one JSON blob per run (`runs.body`), rewritten on every update; 10 MiB state budget | `store.mjs:127–140`; `runtime.mjs:235` **[D]** |
| Scheduling | a ready batch of up to `maxConcurrency` nodes runs; the next batch starts only after *all* settle | `runtime.mjs:355–371` **[D]**; HOL measured **[M]** |
| Idempotency key | `digest(runId, nodeKey, workflowHash, args)` | `runtime.mjs:493` **[D]** |
| Engine pinning | `engineHash` hashes 14 source files, 3 schemas, the Node version and the ajv version; any change blocks resume (`ENGINE_DRIFT`) | `engine.mjs:11–17`; `runtime.mjs:280` **[D]** |
| Labels | integrity labels on `input.*`; joined through refs; effects with untrusted-derived args are refused unless approval-gated. `when` guards are not part of the static taint, so there is no pc-taint | `validate.mjs:103–144` **[D]** |

---

## 2. Conventions every extension follows

1. **Additive, versioned.**
   - Extensions carry `schemaVersion: "1.1"`. The validator accepts 1.0 and 1.1, and a 1.0 document may not use
     1.1 fields. Existing 1.0 workflows keep their hash and their behaviour.
   - Data schemas carried by the IR must be in the portable subset of DESIGN §5.3 **[D]**: payloads, signals,
     state, outputs, tool args and returns. That subset has no `oneOf`, `anyOf` or `pattern`. Tagged unions in
     data are therefore encoded as an `enum` discriminator plus optional fields, and checked after parsing **[I]**.
2. **Suspension only at node boundaries (R4).** Every new waiting construct suspends between nodes, never inside
   one.
3. **Journal before observe (R2).** Each of the following is journaled before control flow can read it:
   - every trigger admission;
   - every inbox delivery;
   - every state snapshot sequence number;
   - every child completion;
   - every expansion fragment;
   - every tool-loop turn;
   - every stream offset;
   - every computed wake time.
4. **Budgets are hierarchical.**
   - Every child run, expansion and finally-block gets a *carved* budget (steps, cost, ms).
   - Reservations count against the parent until they are released.
   - The root budget bounds the whole run tree.
5. **Authority stays outside the model (AGENTS.md).** A workflow, even a model-constructed one, may *declare*
   triggers, params and expansions. *Activating* a trigger and binding a flow param are host acts bound to the
   workflow hash.
6. **Labels flow across every boundary:**
   - trigger to input;
   - signal to wait output;
   - state write to a later run's read;
   - parent to child to parent;
   - plan to expansion.

   A boundary never declassifies, except through quarantined typed outputs (≤ 64 bits, DESIGN §4 **[D]**).
7. **Harness independence is a written semantics plus a conformance suite, not a JSON schema.**
   - Add `docs/IR-SEMANTICS.md` and `tests/conformance/`. Each fixture holds a workflow, inputs, scripted
     capability/model/event tapes, and the expected event-type trace and outputs. Fixtures are runtime-agnostic,
     so a second runtime (an adapter or a port) can prove conformance **[I]**.
   - Committed fixtures must come from redistributable items or be synthetic. Every `unstructured-cycle` and
     `stream` item is non-redistributable **[M]**.

---

## 3. The missing constructs

Counts are from COVERAGE §4 **[D]** and were re-derived here **[M]**. "Only" means the construct is the item's
only blocker. Each construct gets six parts:
1. semantics;
2. IR syntax;
3. runtime behaviour;
4. static checks;
5. tests;
6. effort.

### 3.A Composition

#### A1. `subworkflow-call`: 214 items, 102 where it is the only blocker, 16 platforms

**Evidence [M]**
- Callee node types:

  | Callee node type | Platform | Nodes |
  |---|---|---|
  | `is.workflow.actions.runworkflow` | Apple Shortcuts | 896 |
  | `script.*` | Home Assistant | 348 |
  | `toolWorkflow` (a workflow used *as an agent tool*) | n8n | 61 |
  | reusable workflows | GitHub Actions | 40 |
  | `trigger-job` | GitLab | 33 |
  | `executeWorkflow` | n8n | 27 |
  | `templateRef` | Argo | 27 |
  | SubZap | Zapier | 20 |

- Calls per item: p50 3, p90 26, max 62.
- 84 items combine sub-workflows with human steps.
- COVERAGE §4 says some shortcuts call themselves. No item field identifies the callee, so the number of
  self-calls is **unmeasured** (no item notes mention recursion **[M]**).

**1. Semantics**
- A `call` node runs a callee flow with a typed input and waits for its typed output.
- The callee is one of:
  - an external workflow pinned **by hash** (it gets its own run record, event chain and journal);
  - a **local named flow** in the same document (an inline frame, with no separate run);
  - `self` (recursion);
  - a flow-typed param (A1 composes with F2).
- The node completes with the callee's declared `output`. It fails if the child fails, is cancelled or exhausts
  its carve. It becomes `uncertain` if the child ends `uncertain`.
- The child's verdict class is preserved: a child `env_fault` is an env fault in the parent and is never routable.

**2. IR**
```jsonc
// workflow level (1.1): an output contract, needed by every caller (see §3.G1)
"outputSchema": { "type": "object", "properties": { "rows": { "type": "array", "maxItems": 1000 } }, "required": ["rows"] },
"output": { "rows": { "$ref": "nodes.clean.rows" } },
"flows": {                                   // local named flows, hashed with the document
  "enrichOne": { "inputSchema": {…}, "outputSchema": {…}, "output": {…}, "nodes": [ … ], "acceptance": [ … ],
                 "maxDepth": 4 }             // required when the flow can (transitively) call itself
},
// node
{ "id": "enrich", "kind": "call", "needs": ["fetch"], "description": "Enrich the fetched rows",
  "target": { "hash": "<64 hex>" },          // | { "flow": "enrichOne" } | { "self": true } | { "param": "onPress" }
  "input": { "rows": { "$ref": "nodes.fetch.rows" } },
  "budget": { "maxSteps": 200, "maxCost": 0.50, "maxDurationMs": 600000 },   // carve; ≤ parent remaining
  "detach": false,                           // true → returns a handle (§3.G4)
  "onParentClose": "cancel",                 // cancel | abandon (detached only, owner-visible)
  "compensation": "none",                    // none | child (§4.6)
  "timeoutMs": 600000, "onError": "stop" }
```

**3. Runtime**
- *Durability and replay.*
  - The child run id is `digest(parentRunId, nodeKey, attempt)`, which makes creation idempotent across crashes.
  - The parent journals `call.started {childRunId, childWorkflowHash, inputHash, carve}` before creating the
    child. It journals `call.completed {outputHash, verdict, childEventHead}`, which links the child's chain head
    into the parent's hash chain.
  - On replay the parent reads the child's result and never re-executes the child.
- *Execution.* The child runs in the same process and store, as a nested `Invocation`.
- *Suspension.*
  - If the child suspends (human, wait or signal), the parent node becomes `waiting_child` and the parent run
    `waiting`.
  - When the child completes, it writes a wake row for the parent (in the timers or inbox table), which `tick`
    then resumes.
- *Budgets.* The carve is reserved atomically against the parent and unused budget is refunded when the child
  ends. Spending is charged to the child and rolled up to every ancestor in the same transaction. One store is
  needed for this.
- *Deadline.* The child's deadline is `min(parent deadline − parent finally reserve, now + carve.maxDurationMs)`.
- *Cancellation.* A parent cancel cancels its children (structured concurrency). A parent becomes terminal only
  after its children settle or their `graceMs` expires. A child with an in-flight non-idempotent effect becomes
  `uncertain` and propagates that state upward.
- *Concurrency.* A `call` node never holds a concurrency slot while it waits, or nested calls deadlock (§4.8).
- *Labels.* A child input field inherits the label of the caller's template ref. The child's declared `labels`
  may only raise a label. The call node's output label is the child's output label, computed at child completion.
  Statically, an upper bound comes from the callee's *label summary*: per output field, the input fields and
  sources it can depend on.
- *Authority.* The child's `allowedCapabilities` are the intersection of the parent's and the callee's declared
  manifest. Model policy and registry hash are inherited, and the child is re-validated when it is created.

**4. Static checks**
- The target resolves to a stored hash (`CALLEE_MISSING`). The validator gains a `resolveWorkflow(hash)` option.
- The input template type-checks against the callee's `inputSchema`; parent refs into the call output type-check
  against `outputSchema` (dataflow.mjs gets a `call` case).
- The carve is ≤ the parent budget, and the sum of the static carves of concurrent calls is ≤ the parent budget
  (a warning).
- The call graph over local flows is analysed:
  - a cycle needs `maxDepth` on each flow in it (`UNBOUNDED_RECURSION`);
  - `maxDepth` must be ≤ 8;
  - the global run-tree depth must be ≤ 8.
- The callee's capability manifest must be within the caller's policy (`CAPABILITY_WIDENING`).
- The static step bound is Σ carve × fan-out. If it exceeds the root budget, the validator warns
  (`STATIC_BOUND_EXCEEDS_BUDGET`).

**5. Tests**
- Crash at each step of the call protocol:
  - before `call.started`;
  - after child creation and before the parent records it;
  - after the child completes and before the parent records it.

  Each must yield exactly one child and an identical output.
- Child suspended on `human` → parent waiting → answer the child → `tick` resumes both.
- Parent cancel with a child mid-effect → `uncertain` propagates.
- A child's `env_fault` cannot be routed by the parent's `onError`.
- Budget roll-up under 16 concurrent children: no overcommit.
- Self-recursion to `maxDepth` then `CALL_DEPTH`; mutual recursion between local flows.
- Label laundering attempt: an untrusted input passes through a non-quarantined child and must still be
  untrusted.
- Corpus lowering on redistributable items: `prefect:…/elt-with-snowflake.py` (subflow),
  `github-actions:ankorstore/yokai/…/generate-ci.yml` (reusable workflow),
  `argo:cluster-workflow-template/…` (templateRef).

**6. Effort.** 8–12 ed, including local flows, `self`, the output contract and depth rules.

#### A2. `flow-size>500`: 12 items, 6 only, 4 platforms (ComfyUI 6, Home Assistant 4); max 965 nodes [M]

**1. Semantics.** One flow with more than 500 nodes.

**2. IR**
- Raise `nodes.maxItems` to 2,000 per flow and the total to 10,000.
- Encourage local named flows and `group` (§3.B2) for structure. Lowering may split by connected regions.

**3. Runtime.** Raising the cap is unsafe until the store stops rewriting the whole run blob.
- Measured cost: 42 ms per node at 500 nodes, rising superlinearly **[M]**.
- Extrapolated **[I]**: about 60–90 s of pure engine overhead for a 965-node ComfyUI graph.
- Prerequisite: §6 P-store (per-node rows, an in-memory state cache, group commit).

**4. Static checks**
- Validator time must stay roughly linear. Measured on the label fixpoint: nested loops up to depth 5 validate in
  ≤ 11 ms, so there is no blow-up there **[M]**.
- Add a total-size check across local flows.

**5. Tests**
- Synthetic 2,000-node chain and wide graphs within an overhead target (P-store, about ≤ 5 ms per node **[I]**).
- Lowering of `comfyui:Comfy-Org-…-spr` (579 nodes, redistributable).

**6. Effort.** 0.5–1 ed after P-store.

### 3.B Failure handling

#### B1. `error-branch`: 220 items, 26 only, 14 platforms

**Evidence**
- [D] COVERAGE §6 error routes:

  | Route | Count |
  |---|---|
  | `code –error→ on-error` | 51 |
  | `on-error –error→ on-error` | 16 |
  | `write –error→` | 9 |
  | `ext-call –error→` | 8 |

  The most frequent route starts at a `code` node, and Phase 1 `code` has no `onError`.
- [R] Airflow trigger rules (`one_failed`, `all_done`, `none_failed`); GitHub `if: failure()`; n8n
  "continue (using error output)"; Argo `onExit`.

**1. Semantics**
- A node may declare that some of its failures are *routed*, after retries are exhausted.
- A routed failure:
  - ends the node in status `failed` with `routed: true`;
  - does not abort the frame;
  - exposes `status.<id>` and `error.<id>` to successors.
- Successors choose when to run with an extended `join` and `when`.
- Unhandled classes are never routable: env, budget, deadline, cancellation, policy and integrity errors.
- A routed failure that no successor consumes is still reported (`run.routedFailures`). Acceptance must inspect
  routed failures, or the validator warns.

**2. IR**
```jsonc
"onError": "stop" | "continue" | { "route": "any" | ["TOOL_TIMEOUT", "HTTP_5XX", "EXIT_1"] },  // now on task, agent, code, verify, map, loop, call, group
"join": "all_success" | "all_resolved" | "any_success" | "all_failed" | "any_failed" | "none_failed",
"when": { "op": "eq", "left": { "$ref": "status.fetch" }, "right": "failed" }   // new ref roots: status.<id>, error.<id>
// status.<id> ∈ completed | skipped | failed | handled_error | cancelled ; error.<id> = { code, message, attempts }
```

**3. Runtime**
- Joins are evaluated only once all needs are resolved, never eagerly. Eager or racing joins are `await race`
  (§3.G4).
- The routed status and the error are journaled with the node.
- Labels:
  - `error.<id>.message` is labelled with the join of the node's input labels plus `untrusted:error`, because
    error bodies quote remote content;
  - `error.<id>.code` is trusted when it comes from the capability's declared closed `errors` set;
  - `status.<id>` carries the node's input labels as pc-taint (§3.G3).
- Error text never enters a model prompt outside an untrusted fence. This matches the existing verify-reasons rule
  (`runtime.mjs:749` **[D]**).

**4. Static checks**
- Route codes ⊆ the capability's declared `errors` (`UNKNOWN_ERROR_CODE`).
- `ERROR_ROUTE_DANGLING`: a routed node with no successor whose `join`/`when` can fire on failure.
- Refs to `nodes.<id>` from a node that may run after `<id>` failed must use `exists` or a `default`. The
  dataflow analysis already models `possibleMissing`.
- An effect after a failure join needs an explicit evidence guard. This generalizes the current
  `EFFECT_AFTER_RESOLVED_JOIN` warning.

**5. Tests**
- The handler runs and the success path is skipped.
- A route never swallows DEADLINE, COST_BUDGET or CANCELLED.
- A routed `code` failure.
- A routed map, where the routed error is the map's, not an item's.
- Error-label propagation into an effect, which must be refused.
- `any_success` with an exclusive branch skipped.
- Lowering of `tekton:…/pipelinerun-with-final-results`, `argo:work-avoidance` and
  `airflow:…openlineage_custom_operator_failure_dag` (all Apache-2.0).

**6. Effort.** 3–5 ed.

#### B2. `completion-hook`: 88 items, 6 only (nf-core 64 of 72, Tekton 10, Nextflow 7, Airflow 6)

**1. Semantics**
- A `finally` flow attached to a flow (root, local flow or group). It runs once, after every main node is
  resolved or the flow is aborted.
- It sees `outcome.status` (succeeded | failed | cancelled), `outcome.error`, `outcome.failed` (node keys) and the
  outputs of completed nodes.
- `runOn` filters it to succeeded, failed or cancelled.
- Ordering: main acceptance is evaluated first, then `finally`.
- Outcome rules:
  - a failing `finally` makes the run `failed` with `FINALLY_FAILED` and keeps the main outcome in
    `run.mainOutcome`;
  - a successful `finally` never turns a failed run into a succeeded one.
- Setup/teardown scoping (Airflow) is a `group` with a `finally`.

**2. IR**
```jsonc
"finally": { "nodes": [ … ], "acceptance": [ … ], "runOn": ["succeeded", "failed", "cancelled"],
             "reserve": { "maxSteps": 20, "maxCost": 0.05, "maxDurationMs": 60000 } },
// structured scope (also the visual collapse unit, §4.16)
{ "id": "deploy", "kind": "group", "needs": [], "description": "…", "body": { "nodes": […], "acceptance": […], "finally": {…} }, "onError": "stop" }
```

**3. Runtime**
- The reserve is carved at run creation:
  - the main flow's effective budget is the budget minus the reserve;
  - the main flow's deadline is the run deadline minus `reserve.maxDurationMs`.

  So a run that failed on COST_BUDGET or DEADLINE can still clean up.
- A first cancel runs `finally` within `graceMs`. A second (force) cancel skips it and journals `finally.skipped`.
- A crash during `finally` resumes it, because it is durable like any flow.
- Run status: `running → finalizing → terminal`.

**4. Static checks**
- `finally` nodes may read only `outcome.*`, `input.*` and nodes of the main flow, through `exists` or a `default`.
- The reserve must fit inside the budget.
- No `human` in a `finally` that runs on cancel (it could block shutdown). This is a warning, or an error with
  `runOn` including `cancelled`.

**5. Tests**
- `finally` runs after COST_BUDGET using the reserve.
- Cancel, then force-cancel.
- A crash inside `finally`.
- A `finally` failure masks nothing.
- A group's teardown runs when its setup ran.
- Lowering of `airflow:…pinecone/example_create_pod_index` (`@teardown`), `nf-core:neutronstar@1.0.0` and the
  Tekton `finally` example.

**6. Effort.** 4–6 ed, `group` included.

#### B3. `adaptive-retry`: 94 items, 19 only (nf-core 72, Nextflow 16, Snakemake 6)

**Evidence**
- [D] `merge-items.mjs:63` maps every science `retry-policy` token to `adaptive-retry`. This is a cluster rule and
  may over-count nf-core pipelines whose retries are fixed.
- [R] Nextflow `errorStrategy { task.exitStatus in 137..140 ? 'retry' : 'terminate' }` with
  `memory = 6.GB * task.attempt`, and `'finish'`.

**1. Semantics**
- Whether to retry depends on the error class.
- Arguments, typically resources, depend on the attempt number.
- Backoff may be exponential with a cap and jitter.
- On exhaustion the node does one of:
  - `fail`;
  - `ignore` (`handled_error` with a null output);
  - `drain`: start no new nodes in the run, let in-flight ones finish, then fail (Nextflow `finish`).

**2. IR**
```jsonc
"retry": { "maxAttempts": 3, "backoffMs": 1000, "backoff": "exponential", "maxBackoffMs": 3600000, "jitter": true,
           "on": ["EXIT_137", "EXIT_143", "TOOL_TIMEOUT"],
           "attemptArgs": [ { "memoryGb": 6 }, { "memoryGb": 12 }, { "memoryGb": 18 } ],   // shallow-merged into args for attempt k (last repeats)
           "onExhausted": "fail" }                                                         // fail | ignore | drain
```
A finite table, not arithmetic. It is portable, and it can be checked statically without an expression language.

**3. Runtime**
- The jittered delay and the next attempt time are journaled before sleeping (R1).
- Backoff above 60 s uses the durable timers table (node status `waiting_retry`), not an in-process delay.
- The idempotency key **excludes** fields the capability declares as `resourceFields`. Otherwise every attempt of
  an idempotent effect gets a new key and the external system cannot deduplicate.
- `drain` sets a run-level flag that the scheduler honours.

**4. Static checks**
- `attemptArgs` keys must exist in the capability's `inputSchema` and be declared `resourceFields`; otherwise
  `UNSAFE_ATTEMPT_ARGS`.
- `on` ⊆ the capability's `errors`.
- `UNSAFE_RETRY` stays for non-idempotent capabilities.
- `maxAttempts` × timeout must fit the budget (a warning).

**5. Tests**
- An exit-code-selective retry.
- Attempt-indexed memory.
- A long backoff survives a restart.
- `drain` lets in-flight work finish.
- The same idempotency key across attempts.
- Jitter replays identically.
- Lowering of `nf-core:neutronstar@1.0.0`, `nf-core:nanostring@1.3.3` and `snakemake:epigen/rnaseq_pipeline`.

**6. Effort.** 2–4 ed.

### 3.C Starting runs

#### C1–C4. Triggers: `webhook-trigger` 245 (83 only), `event-trigger` 218 (44), `schedule-trigger` 162 (41), `poll-trigger` 20 (16)

**Evidence [M]**
- 232 items have more than one trigger node, so triggers are a list, and the run needs the id of the trigger that
  fired.
- Trigger kinds by platform:

  | Kind | Platforms |
  |---|---|
  | Webhook | GitHub PR/push, GitLab pipeline sources, n8n/Flowise/Langflow HTTP or chat starts, IFTTT |
  | Event | Home Assistant state and numeric_state, app events (Zapier, Activepieces), Airflow assets |
  | Schedule | cron |
  | Poll | Dagster sensors, IFTTT polling |

**1. Semantics.** A trigger is a declared *start condition* for new runs of one workflow hash. It is not a node.
A firing produces a start request `{triggerId, kind, firedAt, scheduledAt?, payload, dedupeKey}`. The request is:
1. validated against `payloadSchema`;
2. filtered by `filter` (a condition over the payload);
3. deduplicated within `dedupeWindowMs` (ingress is at-least-once; run creation is exactly once per dedupe key
   within the window, and duplicates outside the window are documented);
4. admitted by the run-overlap policy (C5);
5. turned into a run whose input is a template over `{trigger, payload}`.

Kind-specific rules:
- **schedule.**
  - Cron or interval, with an IANA timezone.
  - DST: a nonexistent local time fires at the next valid time; an ambiguous time fires once, on its first
    occurrence.
  - `catchup`: `none` | `latest` | `all` (with `maxCatchup`).
  - The dedupe key is `scheduledAt`, so two schedulers cannot fire the same slot twice.
- **webhook.**
  - The host owns the endpoint. Authentication uses an HMAC secret named by environment variable; the value is
    never in the IR.
  - Size cap and per-trigger rate limit. Excess requests get 429 and leave no inbox row.
  - `response`: `ack` (202 with the run id) or `output` (wait up to `responseTimeoutMs` for the workflow output,
    else 202).
- **event.** A named source from a host adapter (`ha.state_changed`, `github.workflow_run`). The registry declares
  the source's payload schema, an event id for deduplication, and an ordering guarantee.
- **poll.**
  - A schedule plus a read-only query capability and a monotonic cursor.
  - New items, ordered by cursor, each create a run (or a batch, see D3).
  - The cursor advance commits in the same transaction as the inbox rows.
  - A failing query retries on the next tick; consecutive failures emit `trigger.degraded`.

**2. IR**
```jsonc
"triggers": [
  { "id": "nightly", "kind": "schedule", "cron": "0 3 * * *", "timezone": "Europe/Berlin", "catchup": "latest",
    "input": { "day": { "$ref": "trigger.scheduledAt" } } },
  { "id": "orders", "kind": "webhook", "path": "orders", "auth": { "hmacSecretEnv": "ORDERS_HOOK_SECRET" },
    "payloadSchema": {…}, "dedupeKey": "/body/id", "response": "ack", "maxPerMinute": 60,
    "input": { "order": { "$ref": "payload.body" } } },
  { "id": "door", "kind": "event", "source": "ha.state_changed", "filter": {…}, "payloadSchema": {…},
    "batch": { "maxItems": 50, "maxWaitMs": 2000, "key": "/entity_id" },        // optional, D3
    "input": { "entity": { "$ref": "payload.entity_id" } } },
  { "id": "posts", "kind": "poll", "every": "PT5M",
    "query": { "tool": "blogger.list_posts", "args": { "since": { "$ref": "cursor" } } },
    "itemsPath": "posts", "itemKey": "/id", "cursorPath": "/published", "maxItemsPerPoll": 50,
    "input": { "post": { "$ref": "payload" } } }
]
```

**3. Runtime**
- New tables:
  - `trigger_activations(workflowHash, triggerId, specHash, enabled, approvedBy, cursor)`;
  - `trigger_inbox(workflowId, triggerId, dedupeKey UNIQUE, payload, status, runId)`.
- Evaluation:
  - `foundry tick` evaluates schedules and polls, so no resident worker is needed in development;
  - webhook and event ingress come through a host **TriggerPort**: `foundry serve`, ARC or AMP.
- Replay: the run's input embeds the trigger record, so replaying a run never needs the trigger. Trigger
  evaluation, meaning cursor advances and admissions, is journaled in `trigger_events`.
- Budgets: `maxPerMinute`, `queueMax` and the per-run budget. The total spend of a trigger over time is an owner
  setting (`maxRunsPerDay`).
- **Authority.**
  - Activation is an owner/host approval bound to `(workflowHash, triggerId, specHash)`.
  - A model-built workflow can declare triggers but never activate them.
  - A new workflow version needs a new activation. Nothing upgrades silently.
- **Labels.**
  - Webhook, event and poll payloads are `untrusted:trigger.<id>`, and the label reaches every derived `input.*`
    field automatically.
  - Schedule fields (times only) are trusted.

**4. Static checks**
- Unique ids, and ≤ 32 triggers.
- The payload schema is portable.
- The `input` mapping type-checks against `inputSchema`.
- Cron parses, and its minimum interval is ≥ policy (1 min).
- A poll query capability has `effects: none`.
- A webhook has `auth`.
- Labels are derived from the mapping. This interacts with §3.G3: without sink-field policy, almost every
  webhook → write item fails `LABEL_POLICY`.

**5. Tests**
- Same dedupe key twice → one run.
- A crash between the inbox insert and run creation → exactly one run.
- A fake-clock schedule across DST, with each catch-up mode.
- The poll cursor does not advance when admission fails.
- An HMAC failure leaves no inbox row.
- A payload schema violation is recorded.
- A disabled or unactivated trigger ignores firings.
- After a head change, the old activation still fires the old hash.
- Label propagation from payload to an effect.
- Lowering of `argo:cron-workflow`, `prefect:…/create-deployments.mdx`, the Dagster sensor items, Flowise start
  nodes and GitHub `pull_request_target`.

**6. Effort.**

| Part | Effort |
|---|---|
| Core (activations, inbox, admission, TriggerPort, tick) | 6–8 ed |
| Webhook | 2–3 ed |
| Event | 2–3 ed |
| Schedule (cron, timezone, DST, catch-up) | 2–4 ed |
| Poll | 2–3 ed |
| **Total** | **14–21 ed** |

#### C5. `run-concurrency-policy`: 56 items, 1 only, all Home Assistant (restart 31, parallel 14, queued 11 [M])

**1. Semantics**
- Decides what happens when a start request arrives while runs of the same workflow *id* (across versions) with
  the same `key` are active:
  - `single`: drop the new request and record it;
  - `restart`: request cancellation of the active run, then start the new one;
  - `queued`: FIFO, up to `queueMax`;
  - `parallel`: up to `max` at once.
- For `restart`, the new run starts only after the old run is terminal, or after its `graceMs` expires. In the
  second case the old run is `cancelled` and its in-flight effects are `uncertain`. Two runs never race on the
  same effects.

**2. IR**
```jsonc
"concurrency": { "key": { "$ref": "input.entity" }, "mode": "restart", "max": 1, "queueMax": 10, "graceMs": 30000, "priority": 0 }
```

**3. Runtime**
- Admission runs in a store transaction over the active runs per `(workflowId, key)`. The queue lives in
  `trigger_inbox`, with status `queued`.
- Ordering: `queued` is FIFO by inbox sequence; `parallel` gives no ordering guarantee.
- Priority inheritance applies (§4.15).

**4. Static checks**
- `key` refs only `input.*` derived from the trigger.
- Bounds on `max`, `queueMax` and `graceMs`.
- `restart` with non-idempotent effects and no `finally` → warning.

**5. Tests**
- Each mode.
- `restart` during an in-flight effect.
- Queue overflow.
- A crash during admission.
- Key isolation.
- Versions sharing the same key space.
- The redistributable `home-assistant:CCOSTAN/…` items, which number 13.

**6. Effort.** 3–4 ed.

### 3.D Waiting and streams

#### D1. `signal-wait`: 75 items, 19 only (Home Assistant 39, Temporal 18, Shortcuts 13, Airflow, n8n, Prefect)

**1. Semantics.** The run suspends at a node until one of three things happens: a run-addressed **signal**
arrives, an external **event** matching a filter is observed, or a **timer** fires.
- Signals:
  - declared with a schema;
  - delivered at least once, then deduplicated;
  - buffered if they arrive before the wait, up to `bufferMax`;
  - consumed in arrival order, exactly once, atomically with the completion of the consuming node;
  - unconsumed signals are reported at run end, never dropped silently.
- Run-scoped event subscriptions (Home Assistant `wait_for_trigger`) register when the wait starts. To avoid lost
  wake-ups the order is subscribe, then check the current state.
- `wait_template`, a condition over external state, is a `for.condition` with poll fallback.

**2. IR**
```jsonc
"signals": { "approve": { "schema": {…}, "dedupeKey": "/id", "bufferMax": 100, "label": "untrusted:signal.approve" } },
{ "id": "door_closed", "kind": "wait", "needs": [], "description": "…",
  "for": { "any": [ { "signal": "approve", "match": {…} },
                    { "event": { "source": "ha.state_changed", "match": {…} } },
                    { "timer": { "delayMs": 3600000 } } ] },
  "timeoutMs": 86400000, "onTimeout": "fail" }        // fail | continue (output fired:"timeout") | route (B1)
// output: { fired: "signal"|"event"|"timer"|"timeout", name, payload, receivedAt }
```

**3. Runtime**
- New table: `inbox(run_id, name, seq, dedupe_key UNIQUE, payload, label, consumed_by)`.
- `signal(runId, name, payload)` is an API and a capability.
- A waiting run wakes through the same ready path as `tick`.
- Which source fired first is decided by the journal: ties between a timer and an inbox entry are resolved by
  commit order and recorded (R3).
- Authority: a signal is **not** an approval. Approvals stay a separate, user-only authority
  (`runtime.mjs:151–163` **[D]**).

**4. Static checks**
- Every wait has a timeout ≤ the run deadline (`UNBOUNDED_WAIT`).
- Named signals are declared.
- `match` refs only the payload.
- Event sources exist in the host registry.

**5. Tests**
- A signal before the wait is buffered.
- A duplicate signal is consumed once.
- A timer and a signal race, then replay.
- An unconsumed signal is reported.
- A lost-wake-up probe.
- A crash between delivery and consumption.
- `temporal:samples-go/reqrespactivity` and the `samples-python` interrupt items (redistributable).

**6. Effort.** 5–7 ed.

#### D2. `durable-wait`: 38 items, 0 only, all Home Assistant

**Evidence [M]**
- Of the delay nodes, 306 are "Delay (templated/input)", i.e. the duration is computed at run time. Only a few
  are literal delays over 1 h.
- So the construct is mostly **runtime-computed delays**, which a literal `delayMs` cannot express. Long delays
  are the smaller part.

**1. Semantics.** A wait whose duration or deadline comes from data, possibly days long.

**2. IR**
- `delayMs` becomes an integer up to `budget.maxDurationMs`, or a `{"$ref"}`.
- New `until: {"$ref": …}`, an absolute time in epoch ms.

**3. Runtime**
- The wake time is computed and journaled when the node starts.
- The timers table already exists (`store.mjs:45` **[D]**).
- **Blocker:** under strict engine pinning, any engine change made during a multi-day wait strands the run. This
  needs §6 P-resume.

**4. Static checks**
- A ref's schema must bound the value (`maximum` ≤ remaining budget); otherwise `WAIT_BOUND` at run time.
- `DEADLINE_UNREACHABLE` if the wake time is after the deadline. This fails early instead of waking dead.

**5. Tests**
- A computed delay.
- A 7-day fake-clock wait across a process restart, and across an engine change (with P-resume).
- A wake time beyond the deadline.

**6. Effort.** 1–2 ed, plus P-resume.

#### D3. `stream`: 28 items, 0 only, all Node-RED

**Evidence [M].** Node types: `inject` 338, `link in` 124, `mqtt in` 58, `join` 27, plus TCP, InfluxDB, GPIO and
serial inputs. Every one of these items is non-redistributable.

**1. Semantics.** Three different things are called "stream":
- **(a)** One run per message from a long-lived source. This is an event trigger (C1–C4) plus a concurrency
  policy, and covers most of these items.
- **(b)** Cross-message aggregation (Node-RED `join`, windows, debounce). This is a trigger `batch`
  (`maxItems`/`maxWaitMs`/`key`) that starts one run per batch. Longer-lived aggregates use `state` reducers
  (E1).
- **(c)** Bounded **in-run** streams between nodes. This is the owner's game-QA case: findings stream to triage
  while exploration continues (ROADMAP §1 **[D]**).
  - Producers emit only at node completion, never mid-node, which preserves R4.
  - Back-pressure delays *starting* new producer nodes, such as further map iterations.
  - Consumers process items in offset order.
  - The stream closes when every producer is resolved.

**2. IR (c)**
```jsonc
"streams": { "findings": { "schema": {…}, "capacity": 256, "overflow": "block" } },     // block | drop_oldest | fail
// producer: any node may declare  "emits": [{ "stream": "findings", "value": {"$ref": "output.finding"}, "each": false }]
{ "id": "triage", "kind": "consume", "needs": [], "stream": "findings", "body": { … }, "concurrency": 4,
  "until": "closed", "maxItems": 1000, "provisional": true }
```

**3. Runtime**
- Stream items are journaled appends `(run_id, stream, offset, producerKey, valueHash)`.
- Replay consumes them by offset.
- `provisional: true` lets a consumer act before its producer completes. Each item records its producer's final
  status. With `false`, items are buffered until the producer completes (§4.14).

**4. Static checks**
- The emitted value type-checks against the stream schema.
- A consumer cannot be its own transitive producer, or the stream could never close (`STREAM_CYCLE`).
- Capacity and `maxItems` bounds.

**5. Tests**
- Synthetic tests only (no redistributable items): back-pressure, close semantics, a failed producer with
  provisional items, offset replay, and a batch trigger flushing on `maxWaitMs`.

**6. Effort.** (a) and (b): 3–4 ed after the triggers. (c): 5–7 ed.

### 3.E State, sessions, agentic loops

#### E1. `cross-run-state`: 134 items, 4 only (n8n 57, Node-RED 24, Activepieces, Dify, Flowise 14 each, Zapier 7, Langflow 4)

**Evidence [M]**
- Converter tokens: `conversation-state` 88 and `external-state-store` 51; an item can have both.
- Node types:

  | Node type | Nodes |
  |---|---|
  | `googleSheets` | 123 |
  | `memoryBufferWindow` | 85 |
  | `PIECE:store` | 45 |
  | `vectorStoreSupabase` | 29 |
  | `memoryPostgresChat` | 21 |
  | `redis` | 14 |

- Read honestly, an external store reached through a connector, such as Sheets or a vector store, is already a
  `task`. What the IR lacks is a **declared, concurrency-safe state contract** for state that outlives a run.
  Reclassifying the Sheets items as native would need a pre-registered amendment (§8). It must not happen
  silently.

**1. Semantics.** Typed, bounded state cells scoped to a workflow *id* or to a session key. Each cell has a
reducer: `lww` (CAS on `expectSeq`), `append(maxItems)`, `counter`, `setUnion(maxItems)` or `max`.
- A run reads one **snapshot** at sequence `s0`, journaled at first use, overlaid with its own writes
  (read-your-writes).
- Writes are idempotent by `(runId, nodeKey, attempt)`.
- `commit` is `node` (applied at node completion) or `run` (buffered, applied in the run's terminal transaction
  only if the run succeeded). `run` suits conversation history.
- `lww` conflicts fail with `STATE_CONFLICT`, which is retryable: the node re-reads and recomputes.
  Commutative reducers never conflict.
- Values keep the label they were written with. Untrusted content stored by run 1 is untrusted when run 2 reads
  it, so state cannot launder labels.
- Versioning: a state cell is keyed by `(workflowId, name, schemaHash)`. A new version either declares
  `migrateFrom` (a pure `code` function) or starts empty. Old state is kept for rollback until its TTL expires.

**2. IR**
```jsonc
"state": {
  "conversation": { "scope": "session", "key": { "$ref": "input.sessionId" }, "schema": {…},
                    "reducer": { "append": { "maxItems": 50 } }, "commit": "run", "ttlMs": 604800000, "maxBytes": 262144 },
  "lastSync":     { "scope": "workflow", "schema": {…}, "reducer": "lww", "commit": "node" }
},
{ "id": "remember", "kind": "state", "needs": ["reply"], "description": "…",
  "writes": [ { "state": "conversation", "value": { "user": {"$ref": "input.message"}, "bot": {"$ref": "nodes.reply.text"} } } ] }
// reads anywhere: { "$ref": "state.conversation" }
```

**3. Runtime**
- New tables: `state_events(workflowId, name, schemaHash, key, seq, op, valueHash, label, runId)` and
  `state_views`, a materialized fold.
- The run's snapshot `s0` is recorded in node state, and replay re-reads at `s0`.
- TTL and `maxBytes` are enforced on write.
- There is a **StatePort**: native SQLite by default, with AMP as an adapter later (§9).

**4. Static checks**
- Schema and reducer agree, e.g. `counter` needs an integer.
- `lww` with concurrency `parallel` and no `expectSeq` handling → warning.
- A session key must come from an authenticated trigger field (`trigger.auth.subject` or a host session id), not
  from the payload body. Otherwise attackers can hijack sessions (`SESSION_KEY_UNTRUSTED`).
- Size bounds.

**5. Tests**
- CAS conflict, then retry.
- Commutative reducers under parallel runs.
- `commit: run` with a failed run leaves no write.
- A label persists across runs.
- TTL expiry.
- Schema migration.
- Replay at `s0`.
- `flowise:chatflows-conversation-chain` and the Dify advanced-chat item (redistributable).

**6. Effort.** 5–8 ed.

#### E2. `chat-session`: 77 items, 6 only (Langflow 23, Flowise 21, Dify 20, n8n 13)

**1. Semantics.** A conversation is a sequence of user turns that share session state. Each **turn is one
bounded run**:
- started by a `chat` trigger, a webhook with a session key and a reply channel;
- serialized per session (concurrency `queued`, `max: 1`, keyed by session);
- history in `state.conversation` with `commit: "run"`;
- the reply is the workflow `output`, or token streaming to the UI. Tokens are never journaled at token
  granularity; the final output is.

Double texting (R09 B1 **[D]**) maps to the concurrency mode: `queued` (enqueue), `single` (reject) or `restart`
(interrupt). The alternative, one long-lived run fed by `updates`, is more complex to replay and bound. It is
rejected here **[I]**.

**2. IR.** Trigger `{ "kind": "chat", "session": "auth.subject" | "host.sessionId", "response": "output" }`, plus
an agent context field `history: { "state": "conversation", "last": 20, "maxTokens": 4000 }`. That field extends
`history: "none"` (DESIGN §1.1 **[D]**). It is compiled deterministically from the journaled snapshot, with label
`untrusted:chat`.

**3. Runtime.** Built from C1–C5 and E1. Session idle TTL drops state. A reply is sent at most once.

**4. Static checks**
- The session key's source (E1).
- History `maxTokens` is ≤ the class budget (ROADMAP §2.2 **[D]**).
- `history` is not allowed on quarantined agents.

**5. Tests**
- Ordered turns.
- An interrupt cancels the in-flight turn, and its history is not committed.
- A history window.
- A replayed turn has the same prompt bytes.
- `flowise:agentflowsv2-simple-rag` and `langflow:memory-chatbot` (redistributable).

**6. Effort.** 3–5 ed after the triggers and E1.

#### E3. `agent-tool-loop`: 99 items, 6 only (n8n 64, Flowise 20, Langflow 13)

**Evidence [M].** n8n `agent` 149 nodes, `toolWorkflow` 60 (workflows as tools), `agentTool` 33 (agents as
tools), Sheets, Gmail and HTTP tools.

**1. Semantics.** A **bounded** model-driven loop.
- Each turn is one journaled model call that returns either a tool call (from an allowlist) or the final typed
  value.
- Tool results enter the next turn as labelled inputs.
- Hard caps: `maxSteps` ≤ 16, `maxToolCalls`, the node's cost budget, and a context `maxTokens` with
  `onOverflow`.
- Tools are capabilities, local or hash-pinned workflows (`call`), or other agents through `call`.
- Parallel tool calls are off by default, for determinism.

This is not the "general agent loop" of ROADMAP §3. It has a fixed allowlist, a step cap and per-turn journaling,
and it never edits its own procedure. Open-ended work goes to `executor`.

**2. IR**
```jsonc
{ "id": "assistant", "kind": "agent", …, "returns": {…final…},
  "tools": { "allow": [ { "tool": "gmail.search" }, { "call": { "flow": "lookupCustomer" } } ],
             "maxSteps": 8, "maxToolCalls": 12, "parallel": false } }
// model-side schema (portable): { action: enum[<tool names>, "final"], args: object, final: object }; per-tool args and final validated after parse
```

**3. Runtime**
- Journal key: `(runId, nodeKey, attempt, turn)`.
- Tool results are node sub-events `agent.tool.completed {turn, tool, argsHash, outputHash}`, with a bounded
  transcript.
- On resume, the loop replays model turns from the journal and never re-executes completed tools. An effectful
  tool in flight at a crash becomes `uncertain`.
- Labels: tool outputs carry the capability's `outputLabel` (default `untrusted:<tool>`).
- **Rule of Two:** if the context holds any untrusted input, every effectful tool must be approval-gated per
  call, or reach only data-sink fields (§3.G3). The model chooses the args, so they are untrusted-derived.
- Quarantined agents cannot have tools.
- The `claude -p` provider can emulate the loop with structured output; no native tool use is needed **[I]**.

**4. Static checks**
- Tools ⊆ `allowedCapabilities`.
- Tool count ≤ the class limit (S 3, M 5, L 8, XL 12, ROADMAP §2.2 **[D]**).
- Tool input schemas are portable.
- The Rule of Two holds.
- `maxSteps` is declared.
- The cost cap fits the budget.

**5. Tests**
- A crash mid-loop resumes without duplicate tool calls.
- An effectful tool in flight becomes `uncertain`.
- An injected tool output cannot widen the tools or reach a control sink.
- Hitting `maxSteps` gives `AGENT_STEPS_EXHAUSTED`, which is routable.
- A workflow used as a tool.
- `flowise:chatflows-csv-agent` and `flowise:agentflowsv2-interacting-with-api`.

**6. Effort.** 6–9 ed.

### 3.F Dynamism and rewrites

#### F1. `unstructured-cycle`: 46 items, 1 only (n8n 30, Node-RED 16; none redistributable)

**Evidence [M].** SCC analysis over the normalized graphs:
- 164 non-trivial strongly connected components;
- 47 of them have several entry points;
- **27 of the 46 items contain at least one multi-entry cycle**;
- 106 of the 164 pass through a wait node (poll or retry shapes) and 35 through a model node.

Caveat: these graphs include message and data edges.

**1. Semantics.**
- A reducible, single-entry cycle is lowered to `loop`: the body is the cycle region, `until` is the exit edge's
  condition.
- Anything else uses a **bounded state machine**:
  - named states, each a sub-flow;
  - after a state's flow completes, the first outgoing transition whose condition holds wins;
  - no transition holding gives `MACHINE_STUCK`;
  - terminal states end the machine.

  Any control-flow graph can be written this way without duplicating nodes.

**2. IR**
```jsonc
{ "id": "flow", "kind": "machine", "needs": [], "description": "…",
  "states": { "fetch": { "nodes": […], "acceptance": […] }, "check": { … }, "done": { "terminal": true } },
  "initial": "fetch",
  "transitions": [ { "from": "fetch", "to": "check" },
                   { "from": "check", "to": "fetch", "when": {…} },
                   { "from": "check", "to": "done",  "when": {…} } ],
  "maxTransitions": 100, "maxVisits": { "fetch": 20 }, "onExhausted": "fail" }
// locals inside a state: visit, from, previous (outputs of the previous state); output: { state, visits, last }
```

**3. Runtime**
- Each visit is a frame `machineId:<k>`.
- Transitions are pure functions of journaled outputs, so replay is deterministic.
- The frame growth is the same as for `loop`: needs epoch compaction (§6 P-store).

**4. Static checks**
- Every state is reachable.
- From every state some terminal state is reachable; otherwise `MACHINE_NO_EXIT`.
- `maxTransitions` ≤ 1,000.
- **pc-taint**: transitions that depend on untrusted data taint every node in their target states for effect
  policy (§3.G3).

**5. Tests**
- An irreducible two-entry cycle.
- Visit caps.
- A stuck machine.
- Replay.
- A random-CFG property test against a reference interpreter.
- A lowering test showing that reducible cycles become `loop`.
- Synthetic only, since no redistributable item exists.

**6. Effort.** 4–6 ed.

#### F2. `parametric-action-input`: 19 items, 0 only, all Home Assistant blueprints

**1. Semantics.**
- A workflow input whose value is itself an action list, such as the "on press" actions of a blueprint. This is a
  higher-order workflow, and the same mechanism instantiates templates.
- The param is a **flow-typed parameter**. It is bound to a concrete flow, as a literal or by hash, *before the run
  starts*, by the host or the owner, never from runtime data (P9).
- The binding is statically validated against the declared signature and capability allowlist, then hashed into
  the run identity (`bindingHash`).

**2. IR**
```jsonc
"params": { "onPress": { "kind": "flow", "inputSchema": {…}, "outputSchema": {…},
                         "allow": { "capabilities": ["ha.light.turn_on", "ha.notify"], "maxNodes": 50, "kinds": ["task", "wait", "code"] } } },
{ "id": "act", "kind": "call", "target": { "param": "onPress" }, "input": {…}, … }
```

**3. Runtime.** A bound param executes like a local-flow `call`. Its label is `trusted` only if the owner bound it
at activation time.

**4. Static checks.** Run when the binding happens: the full validator runs on the bound flow, its capabilities
must be within `allow` and the caller's policy, and the signature types must match.

**5. Tests**
- An unbound param is rejected.
- A binding that widens capabilities is rejected.
- The binding hash appears in the identity.
- `home-assistant:Burningstone91/smart-home-setup/…` (redistributable).

**6. Effort.** 2–4 ed after A1.

#### F3. `dynamic-dag`: 17 items, 8 only, all Snakemake checkpoints (1–9 per item [M])

**1. Semantics.** Part of the graph exists only after an earlier node's output is known. There are two kinds:
- **Data-parametric.** The same rules run over a runtime list. This is `map` and native today. During lowering
  (§8), some of the 17 items may turn out to be this kind, but only the frozen lowering may decide that.
- **Structural.** A planner (code, or a model) emits an IR fragment. The fragment is checked, hash-recorded and
  spliced in as a child frame. This is ROADMAP §2.1 `plan/expand`.

**2. IR**
```jsonc
{ "id": "grow", "kind": "expand", "needs": ["planner"], "description": "…",
  "fragment": { "$ref": "nodes.planner.flow" },            // or { "template": "<local flow>", "bind": {…}, "count": {"$ref": …} }
  "allow": { "capabilities": [ … ], "kinds": ["task", "agent", "code", "verify", "map"], "maxNodes": 50, "maxDepth": 1,
             "models": { "maxClass": "M" } },
  "budget": { "maxSteps": 100, "maxCost": 0.20, "maxDurationMs": 600000 }, "outputSchema": {…} }
```

**3. Runtime.** Checks run at expansion time, before any fragment node starts:
1. the shape is valid;
2. `validateWorkflow` passes, covering types, refs, dataflow and label policy;
3. capabilities ⊆ `allow` ∩ the parent's policy (narrow only);
4. models are within `maxClass`;
5. the static step bound is ≤ the carve;
6. the depth is ≤ `maxDepth` (default 1);
7. the count is ≤ the per-run cap;
8. acceptance is not vacuous.

**P9 rule:** if the producer's output label is untrusted, only the `template` form is allowed, with trusted or
quarantined bindings. A free fragment from untrusted-influenced planning would let untrusted data choose control
flow.

The fragment is journaled with an `expand.accepted {fragmentHash}` event, and replay uses the recorded fragment
rather than planning again. A rejection gives `EXPANSION_REJECTED`, which is routable. Validator messages go to
node state, never into a model prompt, except through an untrusted fence on escalation.

**4. Static checks** at authoring time:
- `allow` ⊆ the workflow policy;
- the budget fits;
- a planner whose output feeds `fragment` must have a `returns` schema that bounds its size.

**5. Tests**
- Widening attempts: a new capability, a higher model class, a nested `expand`.
- An oversized fragment.
- An untrusted planner restricted to templates.
- Replay of a recorded fragment.
- A crash between acceptance and the first fragment node.
- `snakemake:snakemake-workflows/dna-seq-gatk-variant-calling@v2.1.1` (MIT).

**6. Effort.** 6–9 ed.

### 3.G Additions the corpus vocabulary does not count

| # | Addition | Why it is needed | Effort [I] |
|---|---|---|---|
| G1 | **Workflow output contract** (`outputSchema`, `output` template evaluated after acceptance) | Today a run's "result" is every node output. `call`, webhook `response: output`, chat replies and library reuse all need a typed, minimal result. | 1–2 ed (in A1) |
| G2 | **Pure expression language** `{"$expr": [op, …args]}`. JSON AST; arithmetic, string, collection and comparison ops; no regex, `now` or `random`; step and size limits (≤ 10⁵ steps, ≤ 1 MiB); a reference interpreter plus a conformance table. Usable in `when`, `args`, `items`, `until`, trigger `input`, `concurrency.key` and `output`. | Real workflows are dense with small expressions: 8,905 Jinja expressions in 74 Home Assistant items, and 12,427 pure transform nodes in 484 items **[M]**. Today each is a sandboxed `code` node at 170–270 ms **[M]**, which fails with `SANDBOX_UNAVAILABLE` where namespaces are missing. In-process evaluation takes microseconds **[I]**. CEL is the reference design, being non-Turing-complete and linear-time **[R]**. A JSON AST avoids a parser dependency and is trivial for a Rust or other runtime to implement **[I]**. | 4–6 ed |
| G3 | **Sink-field label policy plus pc-taint.** Capability input schemas mark control sinks (recipient, path, URL, command, query) and data sinks (row values, message body). Untrusted data may reach data sinks; reaching a control sink needs approval or a quarantined endorsement. `when`, `machine` transitions, loop counts and error status taint the program counter. | ROADMAP §2.9 requires both **[D]**. Today the policy is all-or-nothing on args (`validate.mjs:130–136` **[D]**), so most trigger → write items will fail `LABEL_POLICY` in honest compilation. Today's `when` is not tainted at all, which under-approximates implicit flows. | 4–6 ed |
| G4 | **`detach` + `await`** (all / any / race / first_k / all_settled; journaled completion order; `onLosers`), as in R09 B2 **[D]** | Parallel workflows, swarm-style fan-out with quorum, races | 5–7 ed |
| G5 | **Saga roles** `saga: {role: compensable|pivot|retryable, compensate: {tool, args}}` (§4.6) | Multi-effect workflows. The corpus vocabulary has *no* saga construct, so coverage is blind to it. | 5–7 ed |
| G6 | **Queries and updates** (R09 B2 #6) | Read-only progress views for the UI and parents; validated, journaled writes into running runs | 3–5 ed |
| G7 | **Heartbeats and a `cancel` API** (`heartbeatMs`, `progressSchema`, `graceMs`, propagate) | Long tasks, executors, children | 3–4 ed |
| G8 | **Shared rate limits** on capabilities (`rateLimit: {perMinute, key}`, a token bucket in the store) | n8n "wait between batches" and API limits across overlapping runs. The corpus does not count this. | 2–3 ed |
| G9 | **Semantics spec plus conformance suite** (§2.7) | Makes "harness-independent" checkable, and makes a port testable | 6–10 ed |

---

## 4. Composition: edge cases

Unless marked otherwise, every rule in this section is a design proposal **[I]** built on R09 B2/B3 **[D]**.

### 4.1 Workflow calls workflow by hash
- The parent document contains the callee's hash, so the parent's own hash commits to the callee.
- Library garbage collection must refcount: a kept parent pins its callees, and a dangling hash makes the parent
  invalid (`CALLEE_MISSING`).
- Callers across workspaces or stores are **not** `call`. They are capabilities (MCP or A2A tasks), because
  budget roll-up and chain linking need one store.

### 4.2 Nesting N deep
- Depth counts across run boundaries, `group`, map/loop bodies and `expand` frames:
  - static nesting inside one document stays ≤ 6 (`validate.mjs:165` **[D]**);
  - run-tree depth is ≤ 8;
  - total runs in one tree are ≤ 1,000, following Temporal's "≤ 1,000 children" guidance (R09 B1 **[D]**).
- Node keys stay per run (`root/a:3/b:17/x`). The UI shows the path `root → call node → child root → …`.

### 4.3 Recursion and cycle limits
- **By hash, recursion is impossible**: a document cannot contain its own content hash.
- Recursion therefore exists only through `self`, or through local flows in one document. Every cycle in the
  local call graph needs `maxDepth` on each flow in it. Runtime depth is enforced from `run.lineage`
  (`CALL_DEPTH`).
- Other limits:
  - data cycles within a flow stay forbidden (`CYCLE`);
  - control cycles are `loop` (≤ 1,000 iterations) or `machine` (≤ 1,000 transitions);
  - expansion inside expansion is ≤ `maxDepth`, default 1.

### 4.4 Budget and deadline inheritance and carving
- Each child, expansion and `finally` reserves steps, cost and ms from its parent's *remaining* budget minus the
  outstanding reservations, so concurrent children cannot overcommit.
- Unused budget is refunded when the child ends.
- Spending rolls up to every ancestor in one transaction.
- Cost bounds marked `costUnknown` roll up as upper bounds (existing mechanism, `runtime.mjs:647–656` **[D]**).
- A child's deadline is at most the parent's deadline minus the parent's `finally` reserve.
- The root's `maxSteps` bounds the whole tree, which prevents a step explosion through fan-out.

### 4.5 Cancellation and failure propagation
- **fail_fast** (the default):
  - a failure aborts the frame scope (today's behaviour);
  - cancellation propagates to in-flight children;
  - a parent becomes terminal only once its children settle, or after `graceMs`;
  - children with non-idempotent work in flight become `uncertain`, and `uncertain` propagates upward and is never
    collected.
- **collect:** a child's or item's failure becomes `{$error:{code, message, childRunId}}`. Env, budget,
  cancellation and policy errors still stop the run (`runtime.mjs:463` **[D]**).
- **route** (B1) gives a failure a node-level handler.
- **compensate** (§4.6) undoes completed effects.
- Cancellation is a request: it never proves an effect did not happen (R5 **[D]**).

### 4.6 Sagas and compensation
- Roles per effectful node:
  - `compensable`, with a `compensate` capability call whose args come only from this node's own args and
    output;
  - `pivot`, the point of no return;
  - `retryable`, meaning idempotent with `maxAttempts` ≥ 2.
- The checker allows only `retryable` nodes after a pivot on any path.
- If the run fails or is cancelled (`onCancel: compensate`) before the pivot, compensations run in reverse
  *journaled completion* order. Each is journaled, retried by its own policy, and becomes `uncertain` plus a human
  task if it keeps failing.
- **Nested sagas:**
  - a `call` with `compensation: "child"` keeps the child's compensation log open until the root completes (the
    "compensation horizon");
  - when the parent fails later, it invokes the child's compensations in reverse;
  - a child that is itself a pivot makes the call node a pivot.

### 4.7 Iterative loops with convergence
- `loop` gains:
  - `converge: {metric: <ref>, delta, patience}`: stop when |mᵢ − mᵢ₋₁| < delta for `patience` iterations;
  - `onExhausted: fail | last | best`, with `best: {metric, direction}`;
  - an explicit `carry` template, so `previous` is not the whole body output. This also bounds state growth.
- `until` may reference a `verify` node's `pass`. That is generate → verify → retry with an independent check.
- Iteration frames older than `keepFrames` are compacted to per-node rows, so 1,000 iterations do not reach the
  10 MiB state budget.
- Convergence on model outputs replays from the journal.

### 4.8 Map inside loop inside call
- Frame keys compose, and resume re-enters exactly the incomplete item (`FRAME_DRIFT` guards changed contexts,
  `runtime.mjs:337,448` **[D]**).
- Labels compose: an item label inside a loop's `previous` label, inside the child's input labels. The static
  check uses the callee's label summary.
- **Concurrency.** Nested maps multiply (16 × 16). Each child run has its own semaphore today, so the run tree
  needs one shared, tree-wide semaphore plus the per-provider semaphores (claude-cli: 6).
- **Deadlock rule.** Slots are held only by leaf operations (task, agent turn, code, oracle). They are never held
  by composite nodes (map, loop, call, group, consume, await) while those wait. Otherwise nested calls deadlock
  once depth exceeds the slot count.
- The static step bound is Σ (maxItems × maxIterations × child carve). It is a warning, not an error.

### 4.9 Dynamic expansion with static checks
Every check from F3 applies, at run time, before execution. An expansion may contain `call` and `map`, but `expand`
only within `maxDepth`. Its capabilities, model classes and budget can only narrow. **Swarm-style fan-out**
(a planner choosing N parallel sub-tasks) is:
1. `expand` from a template, or a `map` over a typed task list;
2. `detach` plus `await first_k | all_settled`;
3. a board or stream for findings.

All of these are bounded by `maxItems`, the carve and the depth caps. Whether swarms help is a capability question
for another lane. Lane 1 lists the missing swarm baselines.

### 4.10 Parallel workflows communicating
- **Signals** go only to runs the sender holds a handle for: its children, its parent, or handles passed
  explicitly as typed values. There is no ambient run-id addressing. Signals are one-way, deduplicated and
  buffered.
- **Queries** are read-only views declared by the target, `queries: {progress: {schema, value: <template>}}`. They
  are never journaled in the target. The *caller* journals the answer, because it may affect the caller's control
  flow (R2).
- **Updates** are validated, journaled writes that return a value. At most K are in flight.
- **Shared board.**
  - Topics live at `run` scope or `tree` scope (the root and its descendants).
  - Each topic declares a schema, a reducer, its writers (workflow or node ids; one writer per key unless the
    reducer is commutative) and its readers.
  - A read happens at a board sequence number recorded in the context receipt, so replay is exact.
  - **Private notes** are node `scratch`: readable only by the same node across its attempts and turns, never
    shared.
- **Deadlock between runs** (A awaits B's signal while B awaits A's) cannot be detected statically for
  separately authored workflows. Mandatory wait timeouts bound it. A wait-for graph over explicit handles reports
  `DEADLOCK_SUSPECTED` cheaply.

### 4.11 Versioning when a callee changes
- A hash pin means that a new callee version never changes an existing parent.
- An upgrade is a *proposal*: a new parent version that references the new hash, checked by:
  - structural subtyping: the new `outputSchema` must satisfy the parent's refs, and the new `inputSchema` must
    accept what the parent passes;
  - replay of the parent's regression slice (L3 gates, ROADMAP §2.6 **[D]**).
- In-flight runs stay pinned (R7).
- Signals, queries and updates to old runs use the old schemas.
- State migrates as described in E1.
- Trigger activations do not move automatically.
- Concurrency keys span versions, so two versions do not race on the same entity during a switchover.

### 4.12 Determinism and replay across nested runs
- Each run has its own chain and journal.
- The parent journals the child's id, input hash, output hash and chain head, so the root chain commits to the
  whole tree (a Merkle link).
- Deterministic child ids and salts (`sampleSalt` defaults to the run id, `runtime.mjs:113` **[D]**) let a full
  re-execution in a fresh store replay every model call from the journal.
- Await completion order, inbox deliveries, state snapshots, stream offsets, expansion fragments and wake times
  are all journaled (R2/R3).
- A child's completion counts only if its journaled completion time is before the parent's deadline. Otherwise
  the parent records DEADLINE.

### 4.13 Human steps inside nested runs
- The question lives in the child run. The parent's call node is `waiting_child`, and the root's status is
  derived: `awaiting_human`, with `blockedOn: [{runId, nodeKey, question}]` for the whole tree.
- Answers address `(childRunId, nodeKey)` with a single-use resume token bound to (run, node, question hash) (R09
  B2 #10 **[D]**).
- `human.timeoutMs` and `onTimeout` route as in B1. The root deadline still applies.
- Approvals in a child bind to the child run and its workflow hash. The root lists every pending approval in the
  tree.
- On cancel, pending questions are revoked.
- MCP `input_required` on the root task carries the nested input requests, keyed by full path.

### 4.14 Streaming partial results
- A child stream (D3c) can be consumed by the parent before the child completes.
- With `provisional: true`, an item consumed from a producer that later fails stays a fact that was emitted, and
  the consumer records the producer's final status.
- With `provisional: false`, items wait for the producer to complete.
- Model token streams are UI-only and never drive control flow.

### 4.15 Priority and concurrency policies
- **Within a run.**
  - Node `priority` orders the ready set.
  - The scheduler must become **work-conserving**: start a node as soon as a slot frees. The measured HOL delay was
    2.0 s for a node ready at 31 ms **[M]** (`runtime.mjs:355–371`).
  - Fair share across map items.
- **Between runs.** Admission priority, workflow `concurrency` (C5), and global per-provider slots shared by every
  run in the process.
- **Priority inheritance.** A run awaiting a handle lends its priority to the awaited run, so a high-priority run
  never waits on a starved low-priority one.
- **Determinism.** Scheduling order never changes outputs, because outputs are keyed by node id and maps are
  ordered by index (R6). The exception is order-sensitive shared writes. Those require commutative reducers or
  CAS, and the journaled order makes replay exact.

### 4.16 Very large flows (> 500 nodes)
- Covered by A2 plus P-store.
- Local flows and `group` give the run inspector natural collapse levels. They answer the owner's request to
  "simplify it": a "visual understanding" group shows as one node with a state dot (lane 1 #13).
- Validator cost stayed ≤ 11 ms for nested loops up to depth 5 **[M]**. The large-flow risk is the store, not the
  validator.

---

## 5. What must not be allowed

1. **Unbounded recursion or expansion.**
   - `self` and local-flow cycles need `maxDepth` ≤ 8.
   - The tree depth cap is 8, and a tree holds ≤ 1,000 runs.
   - `expand` inside `expand` is allowed only within `maxDepth`, default 1.
2. **Mutable call targets at run time.** `{id, version: "latest"}` is never stored. Every target is a hash, a
   local flow, `self`, or a param bound before the run starts.
3. **Ambient authority.**
   - A callee, expansion, tool loop or flow param gets at most the intersection of the caller's policy and its own
     declared allowlist.
   - No in-run capability may activate triggers, write workflows, change policy, approve operations, or address
     runs without a handle.
4. **Untrusted data choosing control flow.** This covers `expand` fragments, `call` targets, `machine` transition
   tables, flow-param bindings, session keys and trigger activation. The only exception is selection among
   pre-validated options through quarantined typed judgments (≤ 64 bits), with pc-taint applied.
5. **Unbounded waits.** Every `wait`, signal, human step and `await` has a timeout ≤ the run deadline.
6. **Unbounded loops, streams and queues.** `maxIterations`, `maxTransitions`, stream `capacity`, trigger rate
   limits and `queueMax` are all required.
7. **Suspension inside a node (R4).** Emits and back-pressure act only at node boundaries. Tool loops resume from
   journaled turns.
8. **Silent fallbacks.**
   - No automatic callee upgrade and no model fallback (already policy).
   - Routes and `collect` never swallow env, budget, cancellation or policy errors.
   - `uncertain` is never collected or retried.
9. **Uncontrolled shared writes.** Shared state or board writes with several writers need a commutative reducer
   or CAS. Labels are never stripped on write.
10. **Self-modification.** `expand` adds a checked child frame. It never edits its parent's definition or the stored
    workflow (ROADMAP §3 **[D]**).
11. **Orphans.** A detached child outlives its root only with `abandon`, its own carved budget and deadline, and a
    handle the owner can see.
12. **Composite nodes holding concurrency slots** while waiting.
13. **Compensation arguments** from later nodes or from untrusted data.

---

## 6. Runtime prerequisites, with measurements

| Id | What | Why | Evidence | Effort [I] |
|---|---|---|---|---|
| P-store | Per-node journal rows. The run blob becomes a cache, the event chain is the source of truth, and an in-memory state is kept per Invocation. Group commit (one transaction per scheduler tick). The incremental chain check replaces `COUNT(*)` on every update. Epoch compaction. | Overhead per node grows superlinearly | 500-node chain 21.1 s (42 ms/node); 100 nodes 1.1 s; wide 500 12.2 s **[M]**. Profile: 33 % `Store.transaction`, 19 % `Store.run`, about 25 % checkData/walk/clone/canonical **[M]**. `updateRun` runs `COUNT(*)` over events and rewrites the blob (`store.mjs:127–140` **[D]**). | 8–12 ed |
| P-sched | Work-conserving scheduler with priorities; a tree-wide semaphore; composite nodes hold no slots | HOL blocking; deadlock under nesting | `after` was ready at 31 ms and started at 2,051 ms **[M]** | 2–3 ed (in P-store) |
| P-resume | A resume ABI. A run binds to `irSemanticsVersion` plus the engine's conformance digest instead of raw source hashes. On resume, the new engine replays the event log, and resume proceeds only if the reconstructed state hash equals the checkpoint. This is D2's "migrate only when replay proves equivalence", made mechanical. | Every durable construct (D1, D2, triggers, sessions, sagas) | `engineHash` covers 14 source files and the Node version; any edit gives `ENGINE_DRIFT` (`engine.mjs:11–17`, `runtime.mjs:280` **[D]**) | 4–6 ed, plus an owner D2 amendment |

**Rust (lane 4 owns the question; lane-2 data only):**
- The measured costs are the shape of the algorithm and the durability policy. Rewriting the whole blob and
  fsyncing on every step is quadratic in any language **[I]**. Rust would shrink the constant factor and keep the
  shape.
- The conformance suite (G9) and the JSON-AST expression language (G2) are what would make a later port checkable
  **[I]**.

---

## 7. Staged plan to ≥ 94 % measured coverage

**Order.** Composition comes first:
- it is the base for the owner's requests (nesting, parallel workflows, delegation);
- the lowering needs it to split large flows;
- triggers depend on host-side decisions (activation authority, ingress), which take longer to settle.

The greedy order in COVERAGE §4 (triggers first) reaches 50 % sooner. Its final set is the same.

**Declared coverage per stage**, computed over the frozen corpus **[M]**:

| Stage | Adds | Constructs | Declared (micro) | Declared (platform-avg) | Worst platforms after stage | Effort [I] |
|---|---|---|---|---|---|---|
| S0 | Measurement pipeline (§8); P-store, P-sched; G1, G2, G3 (needed for honest compilation); G9 skeleton | — | 476 (35.47 %) | 38.6 % | Activepieces 0 %, Zapier 0 %, GitLab 0 % | 30–45 ed |
| S1 | A1 call, local flows, `self`; A2 size | subworkflow-call, flow-size>500 | 585 (43.59 %) | 46.2 % | Activepieces, Zapier, GitLab 0 % | 9–13 ed |
| S2 | B1 route; B2 finally and group; B3 adaptive retry | error-branch, completion-hook, adaptive-retry | 717 (53.43 %) | 56.4 % | Activepieces, Zapier, GitLab 0 % | 9–15 ed |
| S3 | C1–C4 triggers; C5 admission; P-resume | 4 triggers, run-concurrency-policy | 1,014 (75.56 %) | 78.4 % | Langflow 15 %, Node-RED 16 %, Flowise 31 % | 21–31 ed |
| S4 | D1 signals and events; D2 durable wait; G6 queries and updates | signal-wait, durable-wait | 1,083 (80.70 %) | 82.6 % | Langflow 15 %, Node-RED 16 %, Flowise 31 % | 9–14 ed |
| S5 | E1 state; E2 sessions; E3 tool loops | cross-run-state, chat-session, agent-tool-loop | 1,240 (92.40 %) | 93.9 % | Node-RED 20 %, Snakemake 57 %, n8n 78 % | 14–22 ed |
| S6 | F1 machine; D3 streams (a, b, c) | unstructured-cycle, stream | **1,304 (97.17 %)** | 97.5 % | Snakemake 57 %, Home Assistant 80 %, Node-RED 96 % | 12–17 ed |
| S7 | F2 flow params; F3 expand; G4 detach/await; G5 sagas | parametric-action-input, dynamic-dag | 1,340 (99.85 %) | 99.8 % | Node-RED 96 % (2 dashboard items stay unsupported) | 18–27 ed |

**Reading the table**
- **S6 is the first stage whose *declared* coverage clears 94 %**, with a 42-item margin (1,304 − 1,262). Whether
  *compiled* coverage clears it depends on lowering failures, which are unknown until S0 measures them. Each stage
  therefore re-plans with the measured failure taxonomy.
- G4 and G5 are not in the corpus vocabulary but are required by the composition rules of §4. They are scheduled
  in S7 so that the coverage arithmetic stays honest: they move no counted item.
- The plan totals about 125–190 ed **[I]**.
- Capability first (ROADMAP §6.5): stop after S2 and measure capability (below) before committing to S3–S7. Those
  later stages are driven by coverage and are weakly tied to the C0/C1 claims.

**Every stage ends with:**
1. updating the construct ledger;
2. the three coverage numbers of §8 (declared, compiled, executed) and the per-platform table;
3. the conformance suite passing, with the engine hash recorded;
4. **a capability number:**
   - population: corpus pilot items (COVERAGE §8) and bed tasks that *need* the stage's constructs;
   - builder: the Haiku 5.5 builder;
   - comparison: construction and executed success **with the stage versus the S(n−1) IR**, where the builder must
     emulate or inline the construct;
   - also reported: construction cost and time.

   This tells us whether the new IR surface helps a cheap constructor, or only adds ways to fail.
5. a `research/ir-<date>/REPORT.md` and a README status line.

---

## 8. How to measure it honestly

1. **Freeze before measuring.** Pin these by hash in `research/ir-<date>/FREEZE.json` before S1:
   - the corpus file;
   - the verdict rules (`TOKEN_MAP`/`canonicalVerdict` in `merge-items.mjs:47–218` **[D]**);
   - the construct vocabulary;
   - the lowering;
   - the mock-capability generator.

   Any reclassification needs a pre-registered amendment that states its reason and before/after numbers. Two
   examples: "Sheets as state → native", and "Snakemake checkpoint → map".
2. **A construct ledger, not a hand list.**
   - `CONSTRUCTS.json` lists each construct as implemented only when its schema, validator, runtime and named
     conformance tests exist and pass at a recorded commit.
   - `coverage-report.mjs` gains a `--ledger` input. Today it never reads which constructs exist (§0.1).
3. **Report three levels, every time:**
   - **Declared (D):** tokens ⊆ the ledger. This is what the existing scripts compute, and it is a claim about the
     converters, not about Foundry.
   - **Compiled (C):** an automated lowering of *every* item's normalized graph to IR 1.1 that passes
     `validateWorkflow` **under the production label policy**. A relaxed policy is never used for measurement.
     Capabilities are typed mocks generated from node types and effects. Report the failure taxonomy by validator
     code. Scope: this proves structure plus static checks, not semantics. Normalized graphs dropped the
     expressions and real guard conditions.
   - **Executed (E):** the 96 T1 items plus a frozen, stratified T3 sample run against recorded fixtures with mocks
     (COVERAGE §7 **[D]**). Pass means an equivalent effect trace and output. Report the share of the oracle
     subset.
4. **Report micro, macro and the worst platforms.** The platform mix drives the micro number: HA has 96 items
   and n8n 135. Report the platform-averaged figure and the three worst platforms next to the overall one (§7
   table).
5. **List the blind spots next to the number.** Constructs the converters never detect:
   - sagas and compensation;
   - shared rate limits;
   - expression semantics;
   - credentials and connectors (1,067 items call external services; lane 1 #5);
   - delivery and ordering guarantees.

   Platforms missing from the corpus: LangGraph, CrewAI, AutoGen, ADK, Claude Code workflows and swarm frameworks
   (lane 1 #5). "Any and all workflows" cannot be claimed until an agentic-framework slice of about 100 items is
   added and frozen.
6. **Development versus held-out.** This review, and every stage, is shaped by these 1,342 items, which makes them
   development evidence. The headline number comes from a **fresh sample**:
   - about 300 items from the same platforms plus the agentic slice;
   - collected after the IR 1.1 and lowering freeze;
   - measured once at D, C and E.
7. **Independent audit of the lowering.** A second agent that never saw the lowering code hand-lowers 30 random
   items. A mismatch above 10 % invalidates the compiled number until it is fixed and re-frozen.
8. **No goodhart levers.**
   - Do not loosen the validator, label policy or bounds to raise C.
   - Report every item that moves from native to failing (a regression).
   - Report the two `unsupported` items explicitly.

---

## 9. Scope: does the owner's direction change ROADMAP §3?

The task requires an explicit argument. One is given for each non-goal. **[I]** throughout.

| §3 non-goal | Does this plan build it? | Argument |
|---|---|---|
| Meta-harness or outer optimizer | No | Nothing here evolves workflows globally. `expand` is per-run and checked. |
| General agent loop | No | `agent.tools` is a capped, allowlisted, journaled loop (≤ 16 steps). Open-ended work stays with `executor`. |
| Visual builder or connector catalog | No | Authoring stays IR and code. `group` and local flows only give the read-only inspector collapse levels (lane 1 #13). Connectors stay capabilities owned by hosts. |
| Memory store | No | `state` is typed, bounded cells per workflow id or session, with reducers, CAS, TTL and size caps. It has no retrieval, embeddings or ranking. AMP remains the memory store and can back the StatePort. Vector stores stay capabilities. |
| Model gateway | No | Unchanged; model ids come from the policy file. |
| Durable distributed execution | No | Single-node SQLite. Cross-store composition goes through capabilities (MCP or A2A tasks). |
| "Not a LangGraph/n8n/Temporal replacement" (THESIS §4) | **Amend the wording** | The IR targets their *control semantics*, measured as coverage. It ships none of their product surface: no connectors, hosting, multi-tenant scale or editor. Suggested text: "expresses the control semantics of most such workflows (measured); ships none of their product surface". |
| AGENTS.md "no resident workers beyond the task" | **Amend, or delegate** | Triggers inherently need a listener. Development uses `foundry tick` (cron, non-resident) and fake clocks. Production ingress belongs to the host (ARC, AMP, or an owner-started `foundry serve`) through the TriggerPort. |

Taken together: the owner's "mini harness for focused systems" matches *bounded run semantics plus a complete IR*. Every
run stays bounded, and only trigger activations are long-lived, as owner-approved host state. That keeps the
thesis intact and makes "represent any workflow" a measurable property of the IR.

---

## 10. Decisions and questions for the owner

1. **D2 amendment (P-resume).** Allow resume under a new engine when replaying the event log reproduces the
   checkpoint state hash. Without it, durable waits, schedules and sessions are unusable during development.
   *Recommended.*
2. **The 94 % definition.** It should be *compiled* coverage on a *fresh held-out sample*, with declared and
   executed coverage reported alongside. Not declared coverage on this development corpus. *Recommended.*
3. **Trigger activation authority.** Owner approval per `(workflowHash, triggerId, specHash)`. Model-built
   workflows declare but never activate. *Recommended.*
4. **Order.** Stop after S2 for a capability check before S3–S7, or run straight to S6. *Recommended: stop after
   S2.* Lane 1 notes that the usage budget is the binding constraint.
5. **Agentic-framework slice** of about 100 items (LangGraph, CrewAI, ADK, Claude Code workflows, swarms) before
   any "any workflow" claim. *Recommended.*

---

## Appendix A: reproduction

The scripts ran from this session's scratchpad and are reproduced below, shortened but with the same logic. They
read only the corpus and `src/`. The benchmarks write only to temporary workspaces.

**A.1 Declared coverage per stage, leave-one-out, and platform averages [M]**
```js
// node stages.mjs research/corpus-20261006/items.jsonl
const items = readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse), N = items.length;
const need = items.map(i => i.ir.verdict==='native' ? [] : i.ir.verdict.startsWith('via-extension:') ? i.ir.verdict.slice(14).split('+') : null);
const covered = have => need.filter(x => x && x.every(c => have.has(c))).length;   // threshold Math.ceil(0.94*N) = 1262
// stages S1..S7 as in §7; leave-one-out = covered(all minus c); macro = mean over platforms of per-platform covered share
```
Results: 476 / 585 / 717 / 1,014 / 1,083 / 1,240 / 1,304 / 1,340; the five COVERAGE bundles give 1,258 (93.74 %).

Leave-one-out from the full set:

| Dropped construct | Coverage |
|---|---|
| schedule-trigger | 87.78 % |
| error-branch | 83.46 % |
| webhook-trigger | 81.59 % |
| event-trigger | 83.61 % |
| agent-tool-loop | 92.47 % |
| subworkflow-call | 83.90 % |
| cross-run-state | 89.87 % |
| completion-hook | 93.29 % |
| adaptive-retry | 92.85 % |
| chat-session | 94.11 % |
| signal-wait | 94.26 % |
| run-concurrency-policy | 95.68 % |
| unstructured-cycle | 96.42 % |
| durable-wait | 97.02 % |
| stream | 97.76 % |
| poll-trigger | 98.36 % |
| parametric-action-input | 98.44 % |
| dynamic-dag | 98.58 % |
| flow-size>500 | 98.96 % |

The cheapest ≥ 94 % subset, by exhaustive search over 2¹⁹ subsets with the effort weights of §3 **[I]**, omits
flow-size>500, stream, parametric-action-input and dynamic-dag, and reaches 1,265 (94.26 %).

**A.2 Runtime overhead versus flow size [M]**
```js
// N core.identity task nodes, chain (each needs the previous) or wide; maxConcurrency 16; fresh Store per run
const t0 = performance.now(); const run = rt.create(w, { v: 1 }); await rt.execute(run.id); const ms = performance.now() - t0;
```

| Shape | 50 | 100 | 200 | 400 | 500 nodes |
|---|---|---|---|---|---|
| Chain | 774 ms | 1,145 ms | 3,037 ms | 12,867 ms | 21,063 ms |
| Wide | 473 ms | 1,324 ms | 4,535 ms | 14,312 ms | 12,214 ms |

Events: 2N + 4. Run blob: 223 KB at 500 nodes. The profile used `node --cpu-prof` on a 300-node chain and summed
self time per function.

**A.3 Head-of-line blocking [M].** Nodes: `slow` (`core.sleep` 2,000 ms), `fast` (`core.identity`), and `after`
(needs `fast`), with maxConcurrency 4. Event times: `fast` completed at 31 ms, `slow` at 2,047 ms, and `after`'s
`tool.intent` came at 2,051 ms.

**A.4 Sandbox latency [M].** `runCode` of a one-line `main` returning `{ok: x > 1}`, five calls per language. JS:
269, 205, 252, 189, 205 ms. Python: 174, 177, 207, 191, 174 ms.

**A.5 Corpus probes [M]**
- Node-type histograms per construct, over items whose canonical verdict contains the construct (§3 evidence
  lines).
- Converter tokens counted from `ir.notes` "Converter verdict".
- SCC analysis with Tarjan over all edge kinds, where entries are SCC nodes with an in-edge from outside (F1).
- Jinja count: the sum of "N Jinja template expression(s)" in `ir.notes`.

**A.6 Validator nesting [M].** Loops nested to depth 1–5, with an untrusted `input.x` threaded through `previous`,
validated in 11, 2, 1, 4 and 4 ms.
