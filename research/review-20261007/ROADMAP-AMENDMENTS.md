# Proposed amendments to `docs/ROADMAP.md` and `docs/THESIS.md` (2026-10-08)

*Companion to [`00-SYNTHESIS.md`](00-SYNTHESIS.md), revision 2. Proposals only: nothing in `docs/` was edited. Line
numbers are at HEAD `c7149b6` and drift if the files change; each old text is quoted exactly so it can be found by
search. Development and diagnostic status, like the synthesis.*

**How to read each entry.**
- **Old text** is quoted verbatim from the file.
- **New text** replaces it. For an *insertion*, the old text is an anchor that stays, and the new text repeats it
  followed by the added lines.
- **Rationale** says why, with the synthesis section or critique finding.
- **Owner decision** names the synthesis decision (§6 there) that must be answered first, or says none is needed
  because the change only writes down rules already agreed or measured.

**Decision numbers** refer to `00-SYNTHESIS.md` §6:

| # | Decision |
|---|---|
| 1 | The ambition sentence |
| 2 | The "~100%" definition |
| 3 | Model roles |
| 4 | Executor model access through a host-side egress proxy |
| 5 | No cross-run store in Foundry |
| 6 | Keep building representation regardless of Haiku |
| 7 | Kev pause |
| 9 | Your own tasks |
| 13 | Usage rule |
| 14 | R-bench enablers |
| 15 | Phases interleave |

**Order of adoption.**
1. The entries marked "none needed" can go into the week-0 docs commit.
2. The others wait for their decision, or for its default (each decision has one).
3. Adopt THESIS before ROADMAP, because ROADMAP cites it.

---

## Summary

| ID | File and section | Change | Owner decision |
|---|---|---|---|
| T-1 | THESIS §1 | "cheap open-weight models" → "cheap models (Haiku 5.5 today; open-weight once a GPU route exists)"; "the best workflow is often none" | 3 |
| T-2 | THESIS §1 | The owner's ambition, in his words; the sentence left open | 1 (only to finish the sentence) |
| T-3 | THESIS §2 | New terms: coverage, need router and slider, run board, wild ladder and R-bench | none needed |
| T-4 | THESIS §4 "Is" | Model roles; the workflow language as a target; the need router; the read-only run viewer | 2, 3 |
| T-5 | THESIS §4 "Is not" | Memory store and gateway clarifications | 4, 5 |
| T-6 | THESIS §10 | New decisions D8–D16 | they *are* the decisions |
| R-1 | ROADMAP §1 | Selection and construction lines of the overview diagram | 3 |
| R-2 | ROADMAP §2.1 | Today's IR, plus the coverage goal and bounded semantics | 2, 6 |
| R-3 | ROADMAP §2.1 `agent` | Capped `agent.tools` loop (represented); image inputs | none needed |
| R-4 | ROADMAP §2.1 `executor` | Isolation, limits, transcript hash | 4 |
| R-5 | ROADMAP §2.1 `call` | Depth, recursion, budget, callee-effect and idempotency rules | none needed |
| R-6 | ROADMAP §2.1 search operators | `wide` (swarm) and `panel`, which must beat B5 | none needed |
| R-7 | ROADMAP §2.1 async | Error routes, `finally`, adaptive retry, bounded `machine`, loop convergence | none needed |
| R-8 | ROADMAP §2.1 `map` | `quorum(k)`, typed coverage, budget exhaustion | none needed |
| R-9 | ROADMAP §2.1 runtime debts | Store rewrite measured and ordered first | none needed |
| R-10 | ROADMAP §2.2 scopes | No `workflow` scope; board only behind its experiment | 5 |
| R-11 | ROADMAP §2.3 | Model roles; construction classes | 3 |
| R-12 | ROADMAP §2.4 | A Kev port must also beat Haiku 5.5 | 7 |
| R-13 | ROADMAP §2.5 | Construction cascade; who builds what | 3 |
| R-14 | ROADMAP §2.5 step 3 | Reviewed skeletons only; the R-bench source firewall | none needed |
| R-15 | ROADMAP §2.5 step 5 | Strict construction lint | none needed |
| R-16 | ROADMAP §2.5 step 7 | Edits as replay-proven proposals | none needed |
| R-17 | ROADMAP §2.6 | Acceptance must gate; verdict vs oracle reported | none needed |
| R-18 | ROADMAP §2.8 | The need router, modes and slider; RX1 gate | none needed now (slider default can wait) |
| R-19 | ROADMAP §2.9 | Builders reading third-party text | 14 |
| R-20 | ROADMAP §2.9 | Executor isolation, declassification budget, model-written code, retrieval poisoning, gating | 4 (proxy part only) |
| R-21 | ROADMAP §2.10 | Read-only run viewer, chain binding, control surface, 10-run exit test | none needed |
| R-22 | ROADMAP §2.11 | Claude Code workflows as baseline (B1-cc); harness-independence test | none needed |
| R-23a–f | ROADMAP §3 | Clarify five non-goals; add a swarm clause | 4, 5 (see each) |
| R-24 | ROADMAP §4.1 | C1 wording; new claims C6 (representation) and C7 (need routing) | 3 |
| R-25 | ROADMAP §4.2 | The wild ladder and R-bench | 9, 14 |
| R-26 | ROADMAP §4.3 baselines | B0-agent vs B0-call; B1-cc | none needed |
| R-27 | ROADMAP §4.3 discipline | Rules R2–R5 (engine freeze, comparable costs, powered decisions, seeds and sealing) | none needed |
| R-28 | ROADMAP §4.4 | Agent-framework slice; R-bench as a use; description provenance | none needed |
| R-29 | ROADMAP §5 | Phases interleave in a dated plan | 15 |
| R-30 | ROADMAP §5.2 | Phase 2 build and exit | none needed |
| R-31 | ROADMAP §5.6 | End-to-end case uses `gridquest` until the env port exists | none needed |
| R-32 | ROADMAP §6 | README rule clarified; usage rule; no new subsystem; engine freeze | 13 |
| R-33 | ROADMAP §8 | Kickoff prompt: model roles and phase order | 3, 15 |
| X-1 | README.md (outside `docs/`) | Status table, review link, stale Haiku 4.5 line | none needed |
| X-2 | AGENTS.md (outside `docs/`) | Objective sentence; `tools/` in the layout | 3 |

---

## THESIS.md

### T-1. THESIS §1, the one-paragraph answer (lines 12–14)

**Old text**
```text
procedure and models make narrow judgments, so these workflows let **cheap open-weight
models do work that today needs a frontier agent**, and they make agent work
inspectable and repairable.
```

**New text**
```text
procedure and models make narrow judgments, so these workflows let **cheap models (Haiku
5.5 today; open-weight models once a GPU route exists) do work that today needs a frontier
agent**, and they make agent work inspectable and repairable. The goal is the best possible
workflow for any task; for many tasks the best workflow is none, one call or one agent, and
the need router says so.
```

- **Rationale.** The cheap executor in every measurement is Haiku 5.5. Local generative models were parked
  (README: 268 s per call on this CPU). C1's open-weight half is untested and needs a GPU route; the sentence should
  not claim it. The "none is often best" clause carries the owner's "best possible workflow for any task" without
  over-claiming (synthesis §1; critique B P1-8, last row; critique A P1-2).
- **Owner decision.** Needed: decision 3. If the owner prefers to keep "open-weight" as an open claim, keep the old
  sentence and add "(open-weight half untested; needs a GPU route)".

### T-2. THESIS §1, insertion after the one-paragraph answer (after line 16)

**Old text**
```text
inside it.** It is not a giant meta-harness to evolve, a general agent loop, or a
LangGraph/n8n competitor.
```

**New text**
```text
inside it.** It is not a giant meta-harness to evolve, a general agent loop, or a
LangGraph/n8n competitor.

**The owner's ambition (2026-10-07), in his words.** "a mini harness … something that can
allow us to build focussed systems to execute tasks", able to "represent any and all
workflows independent of a harness", with "the best possibel workflow for any tas" as "the
ultimate goal". A cheap model constructs, edits and runs the workflows from templates; Kev
makes quick semantic calls, including whether a task needs a workflow at all; workflows
nest, iterate, run in parallel or as swarms, and stay efficient and auditable. His sentence
"it becomes essentially …" is unfinished and is left open here until he completes it.
```

- **Rationale.** THESIS should record the owner's scope in his words, not ours. The synthesis' guess must not become
  the record (critique A P1-1).
- **Owner decision.** Only decision 1, to finish the sentence. The quotes themselves need no decision.

### T-3. THESIS §2 Terms, insertion after the AMP row (line 28)

**Old text**
```text
| **AMP** | The owner's memory and context authority, also called Hippocampus. It is not Sourcegraph Amp. |
```

**New text**
```text
| **AMP** | The owner's memory and context authority, also called Hippocampus. It is not Sourcegraph Amp. |
| **Coverage** | How much of a corpus of real workflows the IR represents. *Declared*: the constructs exist. *Compiled*: the item lowers to valid IR under the production label policy. *Executed*: it reproduces the original on fixtures (measured only on items with an oracle). Every item is represented exactly or rejected with a named reason. |
| **Need router** | The selection step that decides whether a task needs a workflow at all, and how much: direct call, agent, reuse, template, construct, or construct+ (multi-stage). Hard requirements force structure; otherwise expected value decides. |
| **Slider** | The owner's setting for "how much is a correct result worth?", from cost first to reliability first. Underneath it is the dollar value of one verified success. |
| **Run board** | A run-scoped set of typed topics with reducers and declared writers and readers, read at a fixed sequence number. Not chat, and not memory across runs. |
| **Wild ladder** | Evaluation rungs that Claude did not write or tune on: sealed families, replication of real hand-built workflows (R-bench), external benchmarks, owner-written tasks, the owner's real recurring tasks. |
```

- **Rationale.** These terms now carry claims and decisions; THESIS §2 is the shared glossary (synthesis Appendix A).
- **Owner decision.** None needed.

### T-4. THESIS §4 "Is" (lines 85–88)

**Old text**
```text
- a **workflow constructor**, used by agents through MCP;
- a **runtime** with durable records, async primitives and record/replay;
- a **context system**: private by default, shared by contract;
- a **model layer**: frontier models author, cheap models execute, escalation follows rules;
```

**New text**
```text
- a **workflow language** (the IR) meant to represent any real workflow exactly or reject
  it with a named reason; its written semantics and conformance suite are the target that
  makes it harness-independent (today it runs only on Foundry's runtime);
- a **workflow constructor**, used by agents through MCP;
- a **need router** that decides whether a task needs a workflow at all, and how much;
- a **runtime** with durable records, async primitives and record/replay;
- a **context system**: private by default, shared by contract;
- a **model layer**: frontier models write the template library, build the most complex
  workflows and take escalations; cheap models (Haiku 5.5 today) construct from templates,
  edit through replay-proven proposals, and execute; escalation follows rules;
- a **read-only run viewer**, the face of the audit ledger;
```

- **Rationale.** These are the owner's asks that the review keeps in scope: "represent any and all workflows", the
  "does it need a workflow" router, Haiku as constructor, and the node visualisation. The harness-independence clause
  is worded so it doesn't over-claim (critique A P1-13; critique B P1-6b). (The last old line is followed in the file
  by the typed-judgment, verdict and library bullets, which stay.)
- **Owner decision.** Needed: decisions 2 and 3.

### T-5. THESIS §4 "Is not" (lines 97–98)

**Old text**
```text
- a memory store (that is AMP);
- a provider/model gateway;
```

**New text**
```text
- a memory store (that is AMP). Cross-run application state (a cursor, a dedupe set, a chat
  session) is a typed state capability behind the ContextPort; cross-run lessons become a
  replay-proven workflow version or an AMP claim;
- a provider/model gateway. (A minimal host-side egress proxy for executor model calls, with
  no routing and no provider choice, is a security boundary, not a gateway.)
```

- **Rationale.** IR stage S5 needs cross-run state and chat sessions (lane 2), and executor isolation needs model
  access through the host (lane 7). Without these clauses both read as violations of the non-goals (critique B P1-8,
  rows 1–2; critique A P2-9).
- **Owner decision.** Needed: decision 5 (memory clause) and decision 4 (proxy clause). If decision 4 is "no", keep
  the clause anyway: it only says what such a proxy would be.

### T-6. THESIS §10 Decisions, insertion after the D7 row (line 320)

**Old text**
```text
| D7 | Jev access for the cloud session (API key via env), and permission to fine-tune a judge | Provision; fine-tuning after Phase 4 data exists |
```

**New text**
```text
| D7 | Jev access for the cloud session (API key via env), and permission to fine-tune a judge | Provision; fine-tuning after Phase 4 data exists |
| D8 | Coverage goal: ~100% of real workflows, exact or rejected with a named reason; headline = compiled + executed (executed ÷ oracle-eligible) on a fresh held-out sample after the IR freeze; declared reported alongside; agent frameworks included | Approve (default) |
| D9 | Model roles: Haiku 5.5 runs, constructs from templates and edits by replay-proven proposals; Opus writes the library, builds `construct+` and takes escalations; local generative models parked; Kev is the candidate local judge, kept per port only where it beats Haiku 5.5 and rules | Approve (default) |
| D10 | Executor model access through a host-side egress proxy, which likely needs an owner-provisioned API key | Default **no** (owner rule against new authentication): no executor reads third-party text; R-bench uses the in-runtime structured builder |
| D11 | No mutable cross-run store in Foundry (amends ROADMAP §2.2 and the §3 wording) | Approve (default) |
| D12 | Keep building toward ~100% representation even if new constructs don't help a cheap builder | Yes, at lower priority than the wild ladder (default) |
| D13 | Kev: pause further wave-1 data groups and laptop training until a Kev-vs-Haiku-5.5 probe reports; hosted $150–450 held | Pause (default) |
| D14 | Usage rule: ≤ 4 concurrent agents; under a 7-day warning only in-flight pre-registered runs; heavy runs after resets; weekly allowance budgets (overrides "Full speed") | Approve (default) |
| D15 | R-bench enablers: builders may read third-party task text under provenance taint with no effects, no egress and mocks (ROADMAP §2.9); R-bench oracles up to 60 s per scenario and a runner shim | Approve (default) |
| D16 | Phases interleave in a dated plan instead of running 1→6 in order | Approve (default) |
```

- **Rationale.** ROADMAP §7 says owner decisions live here. These are synthesis decisions 2–7, 13, 14 and 15.
  Operational choices (closing C0 dev, the owner's tasks, the Haiku 4.5 stress arm, recurring tasks, Rust) stay in
  README's decision table.
- **Owner decision.** These rows *are* the decisions; each records its default until answered.

---

## ROADMAP.md

### R-1. ROADMAP §1 System overview, selection and construction lines (lines 25–27, 31–32)

**Old text**
```text
 │ signature → candidates (kept workflows + standard ops)     │
 │ hard guards (code) + applicability (typed judgment)        │
 │ choose: reuse W@v │ construct new │ delegate to executor   │
```

**New text**
```text
 │ hard requirements (code + typed properties): add structure │
 │ utility head per executor model + slider (value of success)│
 │ choose: direct │ agent │ reuse W@v │ template │ construct(+)│
```

**Old text**
```text
 CONSTRUCTION (when needed): probe environment → draft IR from operators →
 static checks (types, effects, budgets, labels, composition) → smoke run
```

**New text**
```text
 CONSTRUCTION (when needed): cheap builder first, frontier on escalation and construct+:
 intake → oracle discovery → skeleton + typed slots → lint → smoke run → patch by replay
```

- **Rationale.** This is the router of synthesis §3.4 and the cascade of §3.5. The kept-workflow candidates and the
  applicability judgment survive inside the `reuse` mode and §2.8.
- **Owner decision.** Needed: decision 3 (who builds).

### R-2. ROADMAP §2.1, today's IR and the coverage goal (lines 116–118)

**Old text**
```text
Today the schema supports `task`, `assert`, `human`, `map`, `loop` and `wait`
(`schemas/workflow.schema.json`). The runtime has no model node, `map` runs serially,
`wait` never wakes, and there is no call-by-hash.
```

**New text**
```text
Today the schema has 9 node kinds: `task`, `assert`, `human`, `map`, `loop`, `wait`,
`agent`, `code` and `verify` (`schemas/workflow.schema.json`). `map` runs in parallel and
timers wake through `foundry tick`. There is no call-by-hash, trigger, error route or board.

**Coverage goal (owner, 2026-10-07).** About 100% of real workflows, defined so it cannot be
gamed: every workflow is represented exactly or rejected with a named reason, never silently
flattened. Every IR stage reports three numbers: *declared* (the constructs exist),
*compiled* (lowers to valid IR under the production label policy) and *executed* (reproduces
the original on fixtures, reported as executed ÷ oracle-eligible). The headline is compiled
plus executed on a fresh held-out sample (~300 items) collected after the IR freeze; the
agent-framework slice is included. Bounded semantics: infinite processes become triggered
runs, recursion has depth limits, loops have caps. Free group chat and full-history handoffs
are refused by design choice and labelled so (representable with a turn cap if wanted).
Whether a construct helps a cheap builder decides the build order and the builder's kit,
not whether the IR gets it. Stages S0–S7 and their effort:
`research/review-20261007/02-ir-expressiveness.md` §7.
```

- **Rationale.** The old sentence predates Phase 1. The goal and its definition are what the owner was told
  ("100% … I'll make it the target"; "agreed" to bounded semantics). The last sentence applies critique A P0-2.
- **Owner decision.** Needed: decision 2 (the definition) and decision 6 (the last sentence).

### R-3. ROADMAP §2.1 `agent`: capped tool loop and image inputs, insertion (line 126)

**Old text**
```text
  - The full field list is in R09 §C6.
```

**New text**
```text
  - The full field list is in R09 §C6.
  - **Capped tool loop (`agent.tools`).** The IR represents a short tool loop: an
    allowlist, at most 16 turns, every turn journaled. Its first implementation runs inside
    the executor adapter. A Foundry-native loop needs a §3 amendment first.
  - **Image inputs.** `media` inputs (kind, hash, bytes, size) render into the context and
    are untrusted like text. Needed for the game-QA visual pass.
```

- **Rationale.** 134 of 220 agent-framework items need a tool loop (synthesis §3.6). The owner's game-QA "visual
  understanding node" needs image inputs (§3.17; critique A P1-6).
- **Owner decision.** None needed.

### R-4. ROADMAP §2.1 `executor` (lines 137–143)

**Old text**
```text
  - It is opaque inside but bounded outside:
    - a workspace handle;
    - a budget;
    - a timeout;
    - an allowed capability set, enforced by sandbox;
    - typed `returns`;
    - mandatory downstream `verify`.
```

**New text**
```text
  - It is opaque inside but bounded outside:
    - a workspace handle;
    - a budget, reserved from the parent;
    - a timeout and heartbeats;
    - an allowed capability set, enforced by sandbox;
    - `egress: none` by default: a private network namespace, model calls only through a
      host-side egress proxy (no routing, no provider choice), no CLI login inside the
      sandbox, per-node budget-scoped revocable tokens;
    - nested agents 0 by default; nested model use blocked up front, not detected after;
    - a transcript whose hash enters the hash chain;
    - effects marked `uncertain` when egress is on;
    - typed `returns`;
    - mandatory downstream `verify`.
  - Limits: at most 2 running at once and 16 per run.
  - No executor reads third-party text (corpus, benchmarks, owner repositories) until the
    isolation canary test passes (§2.9).
```

- **Rationale.** Today the executor sandbox has open egress and a readable CLI login (lane 7 §3.4). These are the
  owner's "subagents inside nodes", bounded (synthesis §3.11).
- **Owner decision.** Needed: decision 4, for the proxy's model access. With "no", the bullet stands, and executors
  simply never get third-party text.

### R-5. ROADMAP §2.1 `call` (lines 147–148)

**Old text**
```text
- **`call`.** Invokes a child workflow by hash. The child gets its own run record, a
  budget carved from the parent's, and a delivery-bound result.
```

**New text**
```text
- **`call`.** Invokes a child workflow by hash. The child gets its own run record, a
  budget carved from the parent's, and a delivery-bound result.
  - Depth: default 3, hard policy ceiling 8; static nesting inside one document ≤ 6; at
    most 1,000 runs per tree.
  - Recursion only through `self` or local flows with `maxDepth` (a document cannot contain
    its own hash). Each child gets a strictly smaller budget than its parent has left.
  - Until sagas exist, callees may have only idempotent or approval-gated effects.
  - Idempotency key = (callee hash, input hash, parent path); siblings share one
    rate-limit gate.
  - Human questions carry their path, workflow hash and question hash; stale answers are
    rejected; no approval covers sibling items unless declared as a bounded batch.
  - Every document carries an IR version; a revocation list overrides hash pins for
    security defects.
```

- **Rationale.** The owner's "workflow inside another inside another", with the edge cases critique A P1-8 asked for
  (synthesis §3.2, Appendix C).
- **Owner decision.** None needed: these follow from the bounded semantics he agreed to.

### R-6. ROADMAP §2.1 search operators (lines 149–152)

**Old text**
```text
- **Search operators**, with typed fields and a `verifier` ref:
  - `best_of_n`, `tournament`, `loop_until_dry`;
  - `explore`, with `env` snapshot and fork, novelty or coverage selection, and a
    persona set.
```

**New text**
```text
- **Search operators**, with typed fields and a `verifier` ref:
  - `best_of_n`, `tournament`, `loop_until_dry`;
  - `explore`, with `env` snapshot and fork, novelty or coverage selection, and a
    persona set;
  - `wide` (the swarm operator): a planner emits a bounded, typed subtask list; code checks
    it for overlap and gaps; a `map` of cheap typed workers; a code reducer; an independent
    `verify`. Fan-out ≤ 32 without evidence. It becomes a default only after it beats
    `best_of_n` with the same verifier (B5) at equal tokens;
  - `panel`: independent verifiers with independence labels; vote, not debate.
```

- **Rationale.** Swarms are in scope as an operator, not a subsystem (synthesis §3.9).
- **Owner decision.** None needed.

### R-7. ROADMAP §2.1 async primitives, insertion (line 190)

**Old text**
```text
  - `saga` roles: compensable, pivot, retryable.
```

**New text**
```text
  - `saga` roles: compensable, pivot, retryable.
- **Error routes, `finally` and adaptive retry** (IR stage S2).
- **Bounded `machine`** for cycles with several entry points (at most 1,000 transitions).
  `loop` gains convergence criteria (`delta`, `patience`) and `onExhausted: best`, and is
  capped at 1,000 iterations.
```

- **Rationale.** 27 of the 46 corpus cycles have several entry points that `loop` cannot express. Error branches are
  individually necessary for 94% (lane 2).
- **Owner decision.** None needed.

### R-8. ROADMAP §2.1 parallel `map` (lines 191–192)

**Old text**
```text
- **Parallel `map`.** Fields `concurrency` and `failure: fail_fast|collect`. Outputs are
  ordered by index.
```

**New text**
```text
- **Parallel `map`.** Fields `concurrency` and `failure: fail_fast|collect|quorum(k)`.
  Outputs are ordered by index. The reducer receives typed coverage (done, failed,
  cancelled, skipped). A run cannot be `pass` with collected errors unless its acceptance
  says so. On budget exhaustion the map stops launching items: in-flight items keep their
  reservation, unstarted items become `skipped: budget`, unused reservations return to the
  parent, and the verdict is `inconclusive` (budget). A static check `BUDGET_TOO_SMALL`
  rejects carving that leaves a leaf below one call's budget.
```

- **Rationale.** The Haiku-built `records` workflow dropped failed batches silently and still passed (lane 5). These
  are the fan-in and mid-swarm edge cases of critique A P1-8.
- **Owner decision.** None needed.

### R-9. ROADMAP §2.1 runtime debts (line 202)

**Old text**
```text
  - per-node journal rows instead of rewriting the whole run blob (`src/store.mjs`);
```

**New text**
```text
  - per-node journal rows instead of rewriting the whole run blob (`src/store.mjs`). It is
    measured: a 1,000-item map adds 73–135 s of pure overhead. It lands in the first engine
    bump, before any composition or swarm feature;
```

- **Rationale.** Lane 4's measurements; synthesis §3.14.
- **Owner decision.** None needed.

### R-10. ROADMAP §2.2 shared-state scopes (lines 260–265)

**Old text**
```text
- **Scopes:**
  - `node`: private;
  - `run`: the blackboard for one run;
  - `workflow`: persists across runs and holds playbook deltas;
  - `library`: read-only, through the ContextPort;
  - `temp`.
```

**New text**
```text
- **Scopes:**
  - `node`: private (the node's scratch notes; they leave only through a typed output);
  - `run`: the blackboard for one run (tree-scoped for composed runs);
  - `library`: read-only, through the ContextPort;
  - `temp`.

  There is no `workflow` scope. Cross-run knowledge ("lessons") becomes a replay-proven
  workflow version or an AMP claim. Cross-run application state (a cursor, a dedupe set, a
  chat session) is a typed state capability with compare-and-swap behind the ContextPort.
  The run board is built only after a pre-registered experiment shows it beats plain edges
  by at least 15% per dollar, and after its injection, confused-deputy and flooding tests
  (§2.9).
```

- **Rationale.** AMP owns memory; a cross-run store invites poisoning that persists across runs (lane 7 S7). The
  pre-registered B0+N notes arm is not evidence either way (its failures are mostly timeouts). The board's kill rule
  comes from lane 7 step 2 (synthesis §3.12).
- **Owner decision.** Needed: decision 5.

### R-11. ROADMAP §2.3 model layer: roles and construction classes (line 291; line 303)

**Old text**
```text
- The runtime uses no model id outside this file. A test proves it.
```

**New text**
```text
- The runtime uses no model id outside this file. A test proves it.

**Model roles (2026-10-08).**
- Cheap executor and first-rung constructor: Haiku 5.5 (class M). A weaker model (Haiku 4.5)
  is kept as a stress arm, because Haiku 5.5 is no longer a "9B-like" stand-in.
- Template library, the `construct+` tier and construction escalations: Opus 5.5 (class F).
- Building Foundry itself: Opus and Sonnet.
- Local generative models: parked until a GPU route exists (268 s per call on the cloud CPU).
- Typed judgments: Kev is the candidate local engine, kept per port only where it beats
  Haiku 5.5 and rules (§2.4).
```

**Old text**
```text
| `plan/expand` and construction | F |
```

**New text**
```text
| `plan/expand` | F |
| construction (`template`, `construct`) | M first (structured builder), escalating to F as a logged event |
| construction (`construct+`: nested, multi-stage, waits or human steps) | F |
```

- **Rationale.** Synthesis §3.5 and decision 3. The current text assigns all construction to F. The owner's ask is
  "haiku 5.5 will e the workflow constructor … by using the tempaltes".
- **Owner decision.** Needed: decision 3.

### R-12. ROADMAP §2.4 promotion (lines 362–363)

**Old text**
```text
**Promotion.** A port gates real decisions only after its Jev engine beats the baseline
on held-out labelled data.
```

**New text**
```text
**Promotion.** A port gates real decisions only after its Jev engine beats the baseline
on held-out labelled data. A local Kev port must also beat a typed call to the cheap hosted
model (Haiku 5.5) on accuracy, calibration and latency; otherwise that port uses the hosted
model or rules.
```

- **Rationale.** Haiku 5.5 answers a typed call in about 1–1.5 s for under $0.001, which removed Kev's cost edge
  (synthesis §2; critique A P0-6).
- **Owner decision.** Needed: decision 7.

### R-13. ROADMAP §2.5 construction, who runs the builder (lines 373–374)

**Old text**
```text
Construction is a workflow too: a standard builder workflow that the frontier builder
runs. Its steps:
```

**New text**
```text
Construction is a workflow too: a standard builder workflow (the "structured builder")
that a cheap builder (Haiku 5.5) runs first, escalating to a frontier builder as a logged
event if no probe passes within budget. Frontier models write the operator skeletons (with
typed slots and offline self-tests), worked examples and repair cookbook it uses, and build
the `construct+` tier themselves. The structured builder runs inside Foundry as narrow,
schema-constrained calls with no executor. One of its outcomes may be "no workflow: one
call", which hands the task back to selection. Its steps:
```

- **Rationale.** Synthesis §3.5. Oracle discovery is already step 1's outcome contract; the change is who runs it and
  in what form.
- **Owner decision.** Needed: decision 3.

### R-14. ROADMAP §2.5 step 3 Retrieve, insertion (line 389)

**Old text**
```text
   - Mined operators come later (A2Flow-style).
```

**New text**
```text
   - Mined operators come later (A2Flow-style).
   - Only reviewed skeletons enter the builder's trusted context; every retrieved snippet
     carries a provenance label. Worked examples come from other families, never the
     task's own. Any repository or template family that supplies an R-bench item is
     excluded from mining and from worked examples (source firewall).
```

- **Rationale.** Retrieval poisoning and evaluation leakage (critique A P0-4 item 5 and P1-11).
- **Owner decision.** None needed.

### R-15. ROADMAP §2.5 step 5 Check (lines 391–394)

**Old text**
```text
5. **Check.** Types, effects and the effect lattice, budgets, labels, composition
   assume-guarantee checks, the one-writer rule, and the oracles' independence and
   controls. Every new oracle gets known-good, known-bad, mutant and double-mutant
   controls before it is trusted.
```

**New text**
```text
5. **Check.** Types, effects and the effect lattice, budgets, labels, composition
   assume-guarantee checks, the one-writer rule, and the oracles' independence and
   controls. Every new oracle gets known-good, known-bad, mutant and double-mutant
   controls before it is trusted. A strict construction lint treats these as errors:
   acceptance that only checks that an answer exists (`ACCEPTANCE_EXISTENCE_ONLY`), verify
   nodes that do not gate (`VERIFY_NOT_GATING`), silently collected errors
   (`ERROR_COLLECTION`), reasoning on extraction nodes, and model classes assigned without
   screening the cheaper class.
```

- **Rationale.** All 7 constructed workflows accept on existence. The run verdict said "pass" on all 5 failed
  F-haiku trials (synthesis point 3).
- **Owner decision.** None needed.

### R-16. ROADMAP §2.5 step 7, insertion of an edit step (lines 397–398)

**Old text**
```text
7. **Hand off** to run, with the construction record. Construction qualification is kept
   separate from outcome qualification.
```

**New text**
```text
7. **Hand off** to run, with the construction record. Construction qualification is kept
   separate from outcome qualification.
8. **Edit.** Repairs to an existing workflow, including by a cheap model, are version-bound
   proposals: a patch to one node, proven by replay of the failing run plus a regression
   slice, applied by code, never inside a running run. Smoke runs replay unchanged nodes.
```

- **Rationale.** This is the "edit" half of the owner's "construct and edit", consistent with the §3 non-goal on
  runtime self-modification (critique A P0-3; critique B P1-8). EX1 measures it.
- **Owner decision.** None needed.

### R-17. ROADMAP §2.6 verdicts, insertion (line 419)

**Old text**
```text
A finding triggers reproduction, never a retry. Only `harness_fault` reaches repair.
```

**New text**
```text
A finding triggers reproduction, never a retry. Only `harness_fault` reaches repair.
A run is `pass` only if its acceptance gates on an independent check. Every experiment
report shows the run verdict against the independent oracle, per arm.
```

- **Rationale.** Self-certified success (synthesis W6).
- **Owner decision.** None needed.

### R-18. ROADMAP §2.8 selection actions (lines 509–513)

**Old text**
```text
**Actions:**
- reuse workflow W at version v;
- construct;
- delegate to executor X;
- cascade (a cheap workflow → verify → escalate).
```

**New text**
```text
**Actions (modes, by construction effort):** `direct` (one call); `agent` (delegate to
executor X); `reuse` (workflow W at version v); `template` (one skeleton, slots filled);
`construct` (a bespoke workflow); `construct+` (multi-stage or composed). A cascade (a cheap
workflow → verify → escalate) is a policy over these modes.

**Need gate.** Two stages. (1) Hard requirements (code guards plus typed task properties)
force structure whatever the slider says: a durable wait, a schedule or trigger, human
approval, effects with authority implications, or an audit trail beyond the model-call
journal (approvals, effect records). This guard can only add structure. (2) A small
calibrated head per executor model predicts success and cost per mode; the mode with the
best expected value wins. The slider sets the dollar value of one verified success
(owner-facing: "how much is a correct result worth?"); each position shows its measured
operating point, or "uncalibrated". Typed judgments extract task properties; they do not
pick the mode. The router is built only if a cross-fitted headroom sweep (RX1) finds that
per-task choice beats the best fixed mode by at least 3 points of success or 20% of cost at
the lower 95% bound; otherwise ship the fixed policy plus the hard guards.
```

- **Rationale.** The owner's Kev ask "from extremely complex … down to … tasks which dont need workflows" with a
  slider, as designed in lane 5 and corrected in synthesis §3.4 (cross-fitting from critique B P1-1; the
  audit-trail definition from critique A P2-6). The selection filters, policy v0 and v1 and granularity text that
  follows stays.
- **Owner decision.** None needed now. The slider's default position can wait until a router exists.

### R-19. ROADMAP §2.9 builders and untrusted text (lines 542–543)

**Old text**
```text
- Control flow is pinned (hash) before any untrusted byte is read. The builder's own
  context must not contain untrusted content.
```

**New text**
```text
- Control flow is pinned (hash) before any untrusted byte is read. A builder may read
  third-party task text only as provenance-labelled data, with no effects, no egress and
  mock capabilities. Workflow text derived from it is tainted, and a tainted workflow needs
  owner approval before it may use effects or egress. The need router reads trusted fields
  only.
```

- **Rationale.** R-bench (translate and rebuild), corpus construction and the injection slice all put third-party
  text in the builder's context; under the old sentence none of them can run (critique B P0-1 item 4).
- **Owner decision.** Needed: decision 14(a).

### R-20. ROADMAP §2.9 isolation and gating, insertion (line 551)

**Old text**
```text
- One writer per resource.
```

**New text**
```text
- One writer per resource.
- Executors: `egress: none` by default, model calls only through a host-side egress proxy,
  no login inside the sandbox, per-node revocable tokens (§2.1).
- A run-level declassification budget in bits. Effect arguments built from declassified
  values must match an allowlist or enum.
- Model-written code runs only as sandboxed `code` with no network, and its output is
  untrusted.
- Control-flow taint and the sink-field policy ship together, with a false-positive test:
  honest "webhook → write row" workflows must still compile.
- **Each security item gates the first run that needs it.** The gating table (item, first
  run that needs it, test that must pass first) is kept with the current plan
  (`research/review-20261007/00-SYNTHESIS.md` §7).
```

- **Rationale.** Synthesis §7. The first draft promised fixes after the runs that needed them (critique B P0-1;
  critique A P0-5).
- **Owner decision.** The proxy part depends on decision 4. The rest needs none.

### R-21. ROADMAP §2.10 audit and inspection (lines 570–572)

**Old text**
```text
- Web UI decision cards for each selection, each escalation and each promotion: inputs,
  alternatives with scores, evidence refs, independence labels. Exit criterion: the owner
  can answer "why did this happen?" in under 2 minutes.
```

**New text**
```text
- Web UI decision cards for each selection, each escalation and each promotion: inputs,
  alternatives with scores, evidence refs, independence labels.
- A **read-only run viewer**: each node a breathing state dot, a one-line live note, and
  a drawer with its transcript (prompt, typed reply, checks, escalations, costs, receipts),
  for recorded and live runs. It never approves, answers or resumes. Prototype:
  `tools/run-view/`.
- The chain binds `requestHash`/`responseHash` on every model call, decisions, executor
  transcript hashes, and a journal root at seal (a board root once a board exists). Run
  heads are anchored in committed experiment manifests. `foundry verify RUN` checks it all.
- The owner acts through the CLI and the web UI: `foundry answer`, `foundry approve`,
  `foundry cancel RUN` and a stop-all with process-group kill.
- Exit criterion: the owner answers "why did this happen?" on 10 recorded failing runs in
  under 2 minutes each, with and without the viewer.
```

- **Rationale.** The owner's node visualisation (synthesis §3.17); the chain gaps (lane 7 §4); the messy stop on
  10-07 (critique A P1-9); one exit test instead of two (critique A P2-5).
- **Owner decision.** None needed. The §3 "tracing UIs" line is amended in R-23d.

### R-22. ROADMAP §2.11 Claude Code interop, insertion (line 592)

**Old text**
```text
  - Export Foundry cases in `claude plugin eval` format.
```

**New text**
```text
  - Export Foundry cases in `claude plugin eval` format.
  - Use real Claude Code workflow scripts as the B1-cc baseline and as executors, after a
    headless feasibility smoke. A lowering from IR to a Claude Code workflow script, or a
    second minimal interpreter for the conformance subset, is the cheap test of harness
    independence.
```

- **Rationale.** Claude Code workflows are the baseline to beat, not something to rebuild (synthesis §3.10). Harness
  independence has one implementation today (critique A P1-13).
- **Owner decision.** None needed.

### R-23. ROADMAP §3 What we deliberately do not build (lines 620–629)

Six separate edits, so each can be accepted alone.

**R-23a. Old text**
```text
- A general agent loop. Use executors.
```

**New text**
```text
- A general agent loop. Use executors. (The IR may represent a capped `agent.tools` loop,
  run inside the executor adapter. A Foundry-native loop requires amending this line first.)
```

- *Owner decision:* none needed.

**R-23b. Old text**
```text
- A memory store (AMP).
```

**New text**
```text
- A memory store (AMP). Cross-run application state is a typed state capability behind the
  ContextPort, not a Foundry store.
```

- *Owner decision:* decision 5.

**R-23c. Old text**
```text
- A model gateway or provider router.
```

**New text**
```text
- A model gateway or provider router. (A minimal host-side egress proxy for executor model
  calls, with no routing and no provider choice, is a security boundary and is allowed.)
```

- *Owner decision:* decision 4 for using it; the clarification itself needs none.

**R-23d. Old text**
```text
- Tracing UIs or a general eval platform: emit OTel, build only qualification rules.
```

**New text**
```text
- Tracing UIs or a general eval platform: emit OTel, build only qualification rules and one
  read-only run viewer (§2.10) that never approves, answers or resumes.
```

- *Owner decision:* none needed (the owner asked for the viewer).

**R-23e. Old text**
```text
- Runtime self-modification by small models.
```

**New text**
```text
- Runtime self-modification by small models. (Small models may propose edits offline as
  version-bound patches that code applies only after replay; §2.5 step 8.)
```

- *Owner decision:* none needed.

**R-23f. Insertion after the last line of §3.**

**Old text**
```text
- Plain LLM-judge rubric loops without hash binding and independence labels.
```

**New text**
```text
- Plain LLM-judge rubric loops without hash binding and independence labels.
- A swarm subsystem, free group chat between agents, or default fan-outs above 32.
  Swarms are an operator over the IR (`wide`) that must beat best-of-K with the same
  verifier. Group chat and full-history handoffs are refused by design choice and stay
  representable with a turn cap if the owner asks.
```

- *Owner decision:* none needed, unless the owner wants a swarm subsystem. He asked whether swarms are in scope; this
  keeps them in scope as an operator.

- **Rationale for R-23 as a whole.** Every plan item that touched a non-goal now has stated wording (critique B
  P1-8).

### R-24. ROADMAP §4.1 claims (lines 640, 644)

**Old text**
```text
| **C1** cheap execution | Frontier-authored workflows executed by assigned open-weight models reach non-inferior verified success at much lower cost than the frontier executing alone. | cost per verified success (CPS) at a non-inferiority margin; pass^k |
```

**New text**
```text
| **C1** cheap execution | Frontier-authored workflows executed by assigned cheap models (Haiku 5.5 today; open-weight models once a GPU route exists) reach non-inferior verified success at much lower cost than the frontier executing alone. | cost per verified success (CPS) at a non-inferiority margin; pass^k |
```

**Old text**
```text
| **C5** game loops | Per-task adaptive exploration with snapshots beats a plain agent loop at matched budget. | RHAE or levels per $; actions per level |
```

**New text**
```text
| **C5** game loops | Per-task adaptive exploration with snapshots beats a plain agent loop at matched budget. | RHAE or levels per $; actions per level |
| **C6** representation | The IR represents real workflows exactly or rejects them with a named reason, across platforms and agent frameworks. | declared, compiled and executed coverage on a fresh held-out sample; lowering-audit mismatch rate |
| **C7** need routing | The need router beats the best fixed mode (always direct, always agent, always construct) on held-out families, with calibrated slider positions. | captured headroom and regret vs the best fixed mode; slider operating-point error |
```

- **Rationale.** C1 matches what is measured (T-1). C6 and C7 make the owner's two new asks claim-bearing, each with
  a falsifier, which R-27 asks for.
- **Owner decision.** Needed: decision 3, for the C1 wording.

### R-25. ROADMAP §4.2 beds: the wild ladder, insertion (line 674)

**Old text**
```text
**Workflow corpus (§4.4)** for C0 and for expressiveness.
```

**New text**
```text
**Workflow corpus (§4.4)** for C0 and for expressiveness.

**Wild ladder** (beds Claude did not write or tune on; each rung harder to fool):
0. Development beds.
1. Sealed families (separate author, read once by one pre-registration).
2. Real external material: (a) **R-bench**, replication of real hand-built workflows from
   the corpus (§4.4 use 5); (b) external benchmarks, after an acquisition check (τ²-bench,
   AppWorld, Spider 2.0 / BIRD, a SWE-bench Verified slice; GAIA if acquirable); (c) the
   owner family `ownerci`.
3. 20–30 owner-written tasks, sealed until the run. Each arrives with an acceptance check
   or input/output examples, or is graded blind against a rubric frozen before the run
   (recorded as human assistance). Stored like `beds/sealed/`, with a hash commitment.
4. The owner's real recurring tasks from ARC/AMP logs, redacted before anything enters a
   journal, the corpus or an export.
```

- **Rationale.** The owner's "say something arbitrary" and "cheaply recreate their workflow" (synthesis §3.7),
  matching what he was told at 08:10 and 08:13.
- **Owner decision.** Needed: decision 9 (rung 3) and decision 14(b) (R-bench oracle runtime and shim).

### R-26. ROADMAP §4.3 baselines (lines 682, 684)

**Old text**
```text
| B0 | Plain executor |
```

**New text**
```text
| B0 | Plain executor (Claude Code with tools; "B0-agent") |
| B0-call | One direct model call with no tools |
```

**Old text**
```text
| B1 | A CC-workflow-style script, written by an independent subagent with an equal construction budget |
```

**New text**
```text
| B1 | A CC-workflow-style script, written by an independent subagent with an equal construction budget |
| B1-cc | A real Claude Code workflow script, run headless (after a feasibility smoke) |
```

- **Rationale.** P1 and C0 already use both B0 forms. B1-cc is the baseline the synthesis plans (§3.10).
- **Owner decision.** None needed.

### R-27. ROADMAP §4.3 discipline, insertion (line 713)

**Old text**
```text
- No K=1 comparative claims. Gaps under 3 points are noise.
```

**New text**
```text
- No K=1 comparative claims. Gaps under 3 points are noise; gaps over 3 points are not
  thereby real. Every kill rule names a non-inferiority margin δ and a family-clustered CI,
  with a power table. Below the powered size the outcome is "directional, no decision".
- Comparative runs use a named engine freeze point. IR and engine work happens on a branch
  and merges only after the round's last trial.
- Each pre-registration records the engine hash and the CLI environment flags. Cost per
  success is compared only within one setting; cross-setting comparisons also report cost
  recomputed from journaled tokens at one fixed price table.
- Separate builder model from builder method (a 2×2 design), as well as architect model,
  executor model, tools, runtime and human assistance.
- Sealed families are read once, by one pre-registration holding every arm. Inspected test
  seeds are recorded as burned in a dated amendment.
- Interim looks at a running experiment change neither its stopping rule nor its verdict.
```

- **Rationale.** Critique B P0-4, P1-2, P1-3 and P1-13; critique A P1-10.
- **Owner decision.** None needed.

### R-28. ROADMAP §4.4 workflow corpus (lines 761, 779)

**Old text**
```text
- the owner's own repos.
```

**New text**
```text
- the owner's own repos;
- agent frameworks (LangGraph, CrewAI, AutoGen/AG2, OpenAI Agents SDK and Swarm, Google
  ADK, Claude Code workflows and others), from official examples. Their descriptions are
  model-written, so they never enter rebuild-from-description tasks or router labels.
```

**Old text**
```text
4. **Seeds for the library**, admitted only after Foundry-side qualification.
```

**New text**
```text
4. **Seeds for the library**, admitted only after Foundry-side qualification.
5. **R-bench** (wild rung 2a): each item yields *translate* (from the original definition),
   *rebuild from intent* (from the author's original description and examples) and
   *improve* tasks, judged by an executable oracle on hidden scenarios with original-passes
   and broken-fails controls. Guards against recall: a memorisation probe per item,
   perturbed twins, a preference for items newer than the builder's training cutoff, and a
   source firewall that keeps R-bench families out of uses 3 and 4.
```

- **Rationale.** The owner agreed to curate agent frameworks ("maybe we should curate and add it ?") and proposed
  R-bench (synthesis §3.1, §3.7; critique A P0-4).
- **Owner decision.** None needed.

### R-29. ROADMAP §5 how each phase runs, insertion (lines 790–792)

**Old text**
```text
**How each phase runs:**
- Each phase ends with a **measured number against a simple baseline** and a
  `research/<topic>-<date>/REPORT.md`.
```

**New text**
```text
**How each phase runs:**
- Phases interleave. Work follows a dated plan (currently
  `research/review-20261007/00-SYNTHESIS.md` §5), not strict phase order.
- Each phase still ends with a **measured number against a simple baseline** and a
  `research/<topic>-<date>/REPORT.md`.
```

- **Rationale.** The plan runs construction (Phase 2), routing (Phase 5's selection), composition (Phase 6) and the
  wild ladder in the same weeks. The brief said "Phases 1→6 in order" (critique A P1-16).
- **Owner decision.** Needed: decision 15.

### R-30. ROADMAP §5.2 Phase 2 build and exit (lines 865–869)

**Old text**
```text
- the `executor` adapter for Claude Code headless and one more executor;
- the workflow corpus pilot (100–200 items, with oracles where possible).

**Exit:** C0 on Tier A families plus the corpus pilot, against B0 and B1, with
construction cost reported. Run the τ^τ-bench one-task feasibility gate.
```

**New text**
```text
- the `executor` adapter for Claude Code headless and one more executor, with isolation
  (§2.1) before any third-party text;
- the structured builder v0 (oracle discovery, strict lint, skeletons with typed slots);
- the workflow corpus pilot (100–200 items, with oracles where possible), the agent-framework
  slice, and the R-bench pilots (5 items, health-gated).

**Exit:** C0 sealed on the one-shot sealed families (builder model × method, B0, B1, B1-cc
if feasible), plus the R-bench pilot, against B0 and B1, with construction cost reported.
Run the τ^τ-bench one-task feasibility gate.
```

- **Rationale.** Synthesis §5 weeks 1–5. `sealed-3` is interactive and needs the env port.
- **Owner decision.** None needed.

### R-31. ROADMAP §5.6 Phase 6 exit (lines 907–908)

**Old text**
```text
- A multi-workflow task (e.g. the game-QA reference) runs with streaming findings,
  cancellation, and timers that wake after a restart.
```

**New text**
```text
- A multi-workflow task runs with streaming findings, cancellation, and timers that wake
  after a restart: `gridquest` until the env port and image inputs exist, then the game-QA
  reference.
```

- **Rationale.** `gameqa` is unaudited, and F workflows cannot run interactive beds without the env port
  (critique A P1-6).
- **Owner decision.** None needed.

### R-32. ROADMAP §6 operating rules (lines 936–937, 958–959)

**Old text**
```text
1. **README.md is the single entry point.** Update its status after every phase. Keep no
   parallel status documents.
```

**New text**
```text
1. **README.md is the single entry point.** Update its status after every phase. Keep no
   parallel status documents: a review synthesis is a review artifact that README links,
   and its status table moves into README.
```

**Old text**
```text
11. **Git:** a named feature branch per phase, small PRs, no force-push to `main`, no
    rewriting of `research/` history.
```

**New text**
```text
11. **Git:** a named feature branch per phase, small PRs, no force-push to `main`, no
    rewriting of `research/` history.
12. **Usage allowance.** At most 4 concurrent agents, and at most 2 for review or
    orchestration fan-out. While the 7-day meter shows a warning, only pre-registered runs
    already in flight continue. Heavy runs start just after a reset. Every plan week has a
    budget in percent of the weekly allowance, not only in list-price dollars.
13. **No new subsystem** without a pre-registered experiment that needs it.
14. **Engine freeze for comparisons.** No comparative run starts on an engine that is
    still changing (§4.3).
```

- **Rationale.** Rule 1: critique B P2-8. Rule 12: the allowance stopped all work once and has been at warning since
  10-07 (critique A P1-15; critique B P0-5). Rule 13: synthesis W12. Rule 14: critique B P0-4.
- **Owner decision.** Needed for rule 12: decision 13, because it overrides the owner's "Full speed". Rules 13–14
  and the rule-1 clause need none.

### R-33. ROADMAP §8 kickoff prompt (lines 984–985, 997–998)

**Old text**
```text
4. Then Phases 1→6 in order (ROADMAP §5). Each phase must end with a capability number against
   a simple baseline (B0, B0+N, and others as listed) and a research/<topic>-<date>/REPORT.md.
```

**New text**
```text
4. Then follow the dated plan; phases interleave (ROADMAP §5). Each phase must end with a
   capability number against a simple baseline (B0, B0+N, and others as listed) and a
   research/<topic>-<date>/REPORT.md.
```

**Old text**
```text
8. Use frontier and open-weight models within the budget. Frontier models construct; cheap
   models execute, assigned per node by measurement. Record every cost and 429.
```

**New text**
```text
8. Use frontier and cheap models within the budget. Cheap models (Haiku 5.5 today) construct
   from frontier-written templates, edit through replay-proven proposals, and execute,
   assigned per node by measurement; frontier models write the templates, build the most
   complex workflows and take escalations. Record every cost and 429.
```

- **Rationale.** Consistency with R-11, R-13 and R-29.
- **Owner decision.** Needed: decisions 3 and 15.

---

## Related changes outside `docs/` (for the week-0 docs commit)

### X-1. README.md

**Old text** (line 126, the "Local models (decided)" row)
```text
Haiku 4.5 is the cheap executor; Kev stays as the local typed-judgment engine.
```

**New text**
```text
Haiku 5.5 is the cheap executor and first-rung constructor; Kev is the candidate local typed-judgment engine, kept per port only where it beats Haiku 5.5 and rules.
```

Also, with no fixed old text:
- Add a status line linking `research/review-20261007/00-SYNTHESIS.md` and this file.
- Move the synthesis §2 status table into README's Status section.
- Bring the cost ledger up to date (about $88 of experiment calls at 08:45 on 10-08; orchestration noted as 25.8M
  subagent tokens across 28 completed workflows).
- Add the operational decisions (close C0 dev, the owner's tasks, the Haiku 4.5 stress arm, recurring tasks, Rust) to
  the decisions table.

- **Rationale.** ROADMAP §6.1 makes README the single entry point. The Haiku 4.5 line predates Haiku 5.5 (critique A
  P2-8; critique B P2-8).
- **Owner decision.** Decision 3, for the Kev wording; none for the rest.

### X-2. AGENTS.md

**Old text** (lines 10–11)
```text
workflows, then run, adapt, verify and selectively reuse them. Cheap open-weight models
execute what frontier models author. ARC and AMP are the harness; Foundry is the workflow
```

**New text**
```text
workflows, then run, adapt, verify and selectively reuse them. Cheap models (Haiku 5.5
today; open-weight models once a GPU route exists) construct from frontier-written templates
and execute. ARC and AMP are the harness; Foundry is the workflow
```

Also add `tools/` (developer tools such as the run-view prototype) to the layout paragraph.

- **Rationale.** The AGENTS.md objective repeats THESIS §1 (critique A P1-16; critique B P1-8). `tools/` is a new
  top-level directory (critique B P1-8, row 5).
- **Owner decision.** Decision 3. AGENTS.md is the owner's working-rules file, so the owner should approve the edit
  even though ROADMAP §6 takes precedence over it.
