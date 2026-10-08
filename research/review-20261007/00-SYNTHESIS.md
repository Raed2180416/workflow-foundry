# Foundry review: where we stand and what to do next (synthesis, 2026-10-08)

*The one document for the owner. Written 2026-10-08, about 08:30 UTC, at HEAD `c7149b6`. It merges the seven review
lanes in this folder with the latest P1 and C0 numbers. Status: **development and diagnostic**. Nothing here is a
sealed or claim-bearing result. P1, the agent-framework corpus curation and the replication pilot were all still
running when it was written, so numbers that can move carry a time.*

**Tags.** **[M]** measured: a command was run and its source is named. **[D]** documented: someone wrote it down in
the named file and it was not re-run here. **[I]** inferred: my reasoning, shown or pointed to.

**Source keys**

| Key | What |
|---|---|
| L1–L7 | lane docs in this folder: `01-requirements.md`, `02-ir-expressiveness.md`, `03-swarms-frontier.md`, `04-efficiency-rust.md`, `05-router-constructor.md`, `06-ui.md` (+ `tools/run-view/`), `07-context-subagents-audit.md` |
| P1 | `node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl`, run here at 08:20 UTC: 201 of 288 planned trials, $16.63 spent (pre-registered kill rule $60). Pre-registration: `research/core-20261006/PREREG.md` |
| C0 | `node experiments/c0/analyze.mjs experiments/runs/c0-dev`, run here at 08:20 UTC: 2 of 5 dev families (`records`, `codefix`), d3, 4 test tasks × K = 2, one construction per arm (K_c = 1), about $35 spent |
| DX | `research/construction-20261006/diagnosis/F-haiku-{records,codefix}.md` (failure diagnoses; these test seeds are now inspected) |
| AG | agent-framework corpus being curated: `/var/tmp/foundry-work/corpus-agentic/*.jsonl`, counted here at 08:18 UTC (199 items from 18 frameworks; extracted by Sonnet agents; not audited; in progress) |
| KEV | `research/kev-20261007/JUDGE-PROGRAM.md` (rev. 2) |
| T/R | `docs/THESIS.md`, `docs/ROADMAP.md`, `README.md` |

---

## The 10 points that matter most

1. **The core bet has its first number. It is good, but narrow.** On held-out `records` d3–d4 tasks, the
   hand-written workflow on Haiku 5.5 passes **23/24 at $0.016 per trial**. A Sonnet 5.5 single call passes 18/24 at
   $0.23, and a Haiku 5.5 single call passes 18/24 at $0.03 [M P1, partial]. The setup favours us: one synthetic
   family, and an Opus agent wrote the workflow after studying that family. So this is a *ceiling*, not evidence
   about construction or generalisation.
2. **When Haiku builds the workflow itself, it falls short.**
   - Foundry workflows built by Haiku: 11/16. Built by Opus: 16/16.
   - Plain scripts built by Haiku: 16/16 [M C0, 2 dev families, K_c = 1].
   - All 5 failures of the Haiku-built workflows are construction defects: one decisive judgment with no check, and
     one wrong check [D DX].
3. **Foundry's own verdict said "pass" on every one of those failed runs.** All 7 workflows constructed so far
   accept as soon as "an answer exists" [M L5 §1.2; D DX]. The top fix is to make acceptance gate: a lint, plus an
   oracle-discovery step during construction.
4. **The ground moves under us.** On the same P1 tasks, a Haiku 4.5 single call passes 0/25 and a Haiku 5.5 single
   call passes 18/24 [M P1]. Each model release shrinks the set of tasks that *need* a workflow. The router has to be
   tied to the executor model and cheap to re-fit.
5. **"~100% coverage" can be reached, but only as a *declared* number, and only on the original corpus.**
   - The plan: 1,340 of 1,342 items declared after 19 new constructs, about 125–190 engineer-days.
   - Today: 476 (35%) declared, **0 compiled, 0 executed**.
   - On the new agent-framework slice (199 items), those 19 constructs reach only **35%** declared. About 17 more
     agentic constructs are needed. Most map onto mechanisms already planned, and a few should be refused by name
     [M L2; M AG].
6. **Swarms, subagents and a shared board are in scope, as bounded patterns over the IR, not as subsystems.** Each
   one must beat a simple baseline before it is built out: best-of-K with the same verifier; plain edge passing; and
   Claude Code alone [L3, L7].
7. **The slider is the dollar value of one verified success.** Whether a task "needs a workflow" depends on the
   executor model, how often the task recurs, what success is worth and whether a cheap verifier exists. Hard
   requirements override the slider. First measure whether there is any headroom to route for (RX1, about $85 for
   the pilot). If there is none, don't build the router [L5].
8. **Efficiency.**
   - In real runs, Foundry's runtime takes 1–3% of wall time and model calls take 76–81% [M L4].
   - Fix these: two CLI environment flags (−17 to −31% cost per call, +59% throughput); per-node store rows (10–54×
     faster at fan-out); the scheduler; the sandbox launcher.
   - **Do not port to Rust now:** about 19 person-weeks for at most a 3% gain [M/I L4].
9. **Four holes must be closed before any third-party content is executed** [M L7]:
   - **Control-flow taint.** Today the validator accepts an effect gated by a condition on untrusted data.
   - **Construction-time injection.** Nothing tests it.
   - **Executors.** Their network is open and the CLI login is readable inside the sandbox.
   - **The hash chain.** Model responses are not bound into it.
10. **The next four weeks, in order:**
    1. Finish P1 and make the verdict honest.
    2. Give Haiku a structured way to construct.
    3. Run the C0 sealed round and a "wild" tier: corpus replication and tasks the owner writes.
    4. Build `call` and error handling, then the bounded executor.

    **Stop for now:** Rust, triggers and sessions, a full board, a swarm subsystem, training a generator, and further
    review lanes.

---

## 1. The ambition, and what Foundry is and is not

**The ambition, in your terms.**
- **What it is.** A *mini harness*: a way to describe any workflow that does not depend on any one harness, and to
  quickly build "the best possible workflow for any task" as a focused system that executes it.
- **Who builds and runs it.** A "dumb" model like Haiku 5.5 constructs, edits and runs these workflows from
  templates. Kev makes the quick semantic calls, including whether a task needs a workflow at all and how complex it
  should be, with a sensitivity slider.
- **What workflows can do.** They nest three deep, iterate, run in parallel or as swarms, spawn bounded subagents
  inside nodes, and share a board with shared state and private notes.
- **What it must be like.** Efficient and fully auditable. You can watch a run as a few nodes with breathing state
  dots, and click a node to see its conversation.
- **Later, in AMP.** Workflows working together "in all possible combinations".

Your sentence "it becomes essentially …" was cut off. My guess [I]: *a compiler and runtime for task-specific agent
systems that cheap models can drive*. Please finish it (decision 1 in §6).

| Foundry **is** | Foundry **is not** |
|---|---|
| A typed, bounded workflow language (the IR), plus a written semantics and a conformance suite, so any harness can run it [I L2 §2.7] | A general agent loop. Open-ended tool loops are delegated to vendor executors (Claude Code, Codex) inside a bounded `executor` node [D T §4; L7 §3.3] |
| A runtime with durable records, replay per node, sandboxed code, budgets and verdicts [D R] | A memory store. AMP owns memory, and Foundry keeps no cross-run "lessons" store [L7 §2.9] |
| A constructor: cheap models fill templates under checks, and frontier models write the templates [I L5 §3] | A visual builder. The UI is a read-only run inspector [L6] |
| A selection layer: direct call, template, construct, delegate or reuse, with a slider [L5 §2] | A model gateway or provider router. Model ids still come only from `policy/models.json` [D R §3] |
| A source of evidence: independence labels, locked oracles, hash-chained records [D T §6] | A clone of LangGraph, n8n or Temporal. It **expresses their control semantics** (measured) and ships none of their product surface: no connectors, hosting or editor [I L2 §9] |

**Infinite processes.** Every run is bounded. Anything long-lived becomes a *trigger* that the owner activates and
that starts bounded runs. This is the "bounded semantics" you agreed to: represent a workflow exactly, or reject it
with a named reason [I L2 §5].

---

## 2. Where we stand against the end-to-end vision

| Layer | Status | Evidence | Caveat |
|---|---|---|---|
| **IR: represent any workflow** | **Partial.** 9 node kinds. No `call`, triggers, error branches, signals, sessions or board | 476/1,342 corpus items (35%) declared native; **0 compiled, 0 executed** [M L2 §0, §7] | Declared coverage counts converter tokens; it compiles nothing |
| **Agent-framework slice** | Being curated | 199 items from 18 frameworks. 41 native (21%); 70 (35%) with the 19 planned constructs; 0 unsupported [M AG] | Sonnet-extracted, unaudited, still growing |
| **Runtime** | Built. Fast enough today; breaks at fan-out | Runtime 1–3% of real-run wall; a 1,000-item map adds 73–135 s of pure overhead [M L4 §0] | Measured on a shared 4-vCPU VM |
| **Cheap execution (P1)** | **First directional number** | fhand-haiku **23/24** at $0.016/trial. Sonnet single call 18/24 at $0.23. Haiku 5.5 single call 18/24 (thinking off) and 17/24 (thinking on). Haiku agent with tools 17/23 at $0.086. fhand-sonnet 24/24 at $0.21. Haiku 4.5 single call 0/25. CPS ratio fhand-haiku / Sonnet call 0.053 [0.043, 0.065] [M P1] | Partial (8 of 12 tasks per arm). One synthetic family, workflow hand-written by Opus. 5 of 7 thinking-on Haiku failures are timeouts. Under-powered for success gaps below ~35 points [D P1 PREREG §4] |
| **Construction by Haiku (C0 dev)** | **Partial** | Probes: all 8 constructions passed. Test: F-opus 16/16, F-haiku 11/16, B1-haiku (script) 16/16, B1-opus 12/16, B0-opus 16/16, B0-haiku 12/16. Execution CPS F-opus vs B0-opus 0.15 [0.06, 0.37] [M C0] | 2 families, K_c = 1, n = 8 per cell. Test seeds now inspected (DX) |
| **Honest run verdicts** | **Broken for constructed workflows** | Run verdict "pass" on all 5 failed F-haiku trials; acceptance is "exists" in 7/7 artifacts [M L5; D DX] | Independent oracles caught it; the runtime didn't |
| **Need-router and slider** | Design only | L5 §2 | Labels need paired runs |
| **Kev (typed judgments)** | Engine, bridge and program design built; **nothing trained** | Stock Kev-0.8B is at or below the rule baseline on 4 of 5 ports; CPU latency 2.5–13.7 s [M L1 gap 9]. Haiku 5.5 typed call ≈ 1–1.5 s and $0.0001–0.0005 [M L4 §8; D README] | Haiku 5.5 removed Kev's cost edge. GPU latency 22–28 ms was measured only on the laptop |
| **Laptop bridge** | Built, attacked, fixed | Commit `d5d0c1f` [D L1 #48] | First real round trip not recorded |
| **Reuse library** | Not started | — | Phase 5 |
| **Composition** (nesting by reference, parallel workflows, AMP) | Not started. Static nesting only (depth ≤ 6) | `src/validate.mjs:165` [D L2 §1] | — |
| **Subagents (`executor`)** | An adapter used by experiments; not an IR node | `src/executors/claude-code.mjs` [D L7 §1] | Network not isolated |
| **Board and private notes** | Not built | `grep board src/` finds nothing [M L3] | — |
| **Audit** | Hash chain, model journal and receipts exist; **gaps** | Responses, decisions and transcripts are not bound into the chain; no external anchor [D L7 §4.1] | — |
| **UI** | **Prototype** run view (`tools/run-view/`) | 19 unit tests and 74 browser checks pass. Answers 6 of 7 diagnosis questions in ≤ 2 clicks, against 3 of 7 for the existing UI [M L6 §7] | One run, counted by the author; **you have not seen it yet** |
| **Security** | Runtime labels, quarantine and sandbox exist; **gaps** | Probe B: an effect gated by `when` on untrusted data passes validation [M L7 A.3] | §7 below |
| **Evaluation validity** | **Weakest link** | Every bed is synthetic and written by Claude; sealed families have never been used; no external benchmark [D L1 gap 6] | The replication benchmark (R-bench) has only a selection script so far |
| **Efficiency** | Measured; fixes identified, **none applied** | L4 §6 | P1 is frozen, so engine changes wait for it |

**Spend so far [I].** About $85 at list price for experiment calls: the README ledger's $4.86, about $24 of
records-v3 dev pilots, P1 $16.6, C0 dev $35 and the Kev probe $2.5 (summed from L4's journal table and the
results files). The README ledger is stale. Orchestration by agents, the main driver of usage, is not itemised.

**Overall, my read [I]:**
- **Built:** the foundation (IR core, runtime, model layer, journal, sandbox).
- **Supported, directionally:** the central claim, "a good workflow lets a cheap model do it cheaply", on one
  synthetic family.
- **Barely started or unmeasured:** everything that makes this the vision rather than a demo:
  - verdicts you can trust;
  - Haiku constructing reliably on families it has never seen;
  - results on wild tasks;
  - composition and reuse;
  - the router.

**In one number, about a fifth of the way there. The hardest part, generalisation to arbitrary tasks, is
unmeasured.**

---

## 3. Answers to every question

Each answer gives the recommendation, the evidence and the experiment that would prove it wrong.

### 3.1 "Represent any and all workflows" and "why can't we get this to 100%? what are we missing?"

**Recommendation.** Target about 100%, defined so it can't be gamed: **every real workflow is either represented
exactly, or rejected with a named reason.** Only exact representation counts toward the number. Report three numbers
every time:
- **declared**: the constructs exist in the IR;
- **compiled**: it lowers to valid IR under the production label policy;
- **executed**: it matches the original's behaviour on fixtures.

The headline is *compiled and executed* coverage on a **fresh held-out sample** of about 300 items, collected after
the IR is frozen [L2 §8].

**What "100%" means on the original corpus** [M L2 §7]:
- The declared ceiling is **1,340 of 1,342** after 19 constructs.
- The 2 items left over are Node-RED dashboard UI state, not workflows.
- Today 476 are declared and 0 are compiled or executed.
- Nine constructs are each individually needed to pass 94%:
  - triggers (webhook, event, schedule);
  - error branches;
  - completion hooks;
  - adaptive retry;
  - `call`;
  - cross-run state;
  - agent tool loops.

**What is missing.** The 19 corpus constructs, in seven stages [L2 §3, §7]:

| Stage | Adds | Declared after the stage |
|---|---|---|
| S1 | `call` by hash, local flows, `self` | 43.6% |
| S2 | error routes, `finally`, adaptive retry | 53.4% |
| S3 | triggers, admission policy, a resume contract | 75.6% |
| S4 | signals, durable waits, queries and updates | 80.7% |
| S5 | state capability, chat sessions, agent tool loops | 92.4% |
| S6 | bounded `machine` for arbitrary cycles, streams | 97.2% |
| S7 | flow params, `expand`, `detach`/`await`, sagas | 99.85% |

Plus prerequisites (S0): the measurement pipeline, per-node store rows, a pure expression language, a sink-field
label policy, and the semantics spec with its conformance suite. **Effort: about 125–190 engineer-days** [I L2 §0].

**The agent-framework slice changes the picture.** You agreed we should curate it ("maybe we should curate and add
it?"). It now holds 199 items from 18 frameworks, among them LangGraph, CrewAI, AutoGen/AG2, OpenAI Agents SDK and
Swarm, Google ADK, Claude Code workflows, smolagents, Mastra and Strands [M AG].
- 41 are native (21%), and the 19 planned constructs bring it to **70 (35%)**.
- The rest need agentic constructs. Each is listed below with the number of items that use it and how I would
  handle it [M AG; I mapping]:

| Construct | Items | How to handle it |
|---|---|---|
| model-generated code execution | 40 | the sandbox, tainted output |
| supervisor delegation | 30 | `executor` or `call` |
| shared scratchpad | 26 | the run board |
| agent-as-tool | 25 | `executor` |
| handoff | 24 | routing; **refuse** handoffs that transfer the full history |
| LLM router | 23 | `role: route` |
| interrupt and resume | 20 | `human` or a signal |
| multimodal input and output | 16 | image inputs |
| partial-output stream | 15 | streams |
| guardrail tripwire | 10 | verify gating |
| group chat | 5 | **refuse**, by name |
| dynamic agent spawn | 5 | `expand` |
| checkpoint rewind | 4 | a `fork` verb |
| context compaction | 3 | a context policy |

- The greedy order reaches 75% after 7 of these and 95% after 12.

**Correction to an earlier answer.** "1,340/1,342" holds for the 27-platform corpus only. To claim "any workflow"
across agent frameworks too, the construct list must grow. Separately, harness independence means a written
semantics plus a conformance suite, not export adapters. Those adapters were deleted under D6, which contradicts an
earlier promise of interop adapters [D L1 #57].

**Blind spots that sit next to the number** [D L2 §8]:
- **Connectors:** 1,067 corpus items call external services, so "represented" does not mean "runs against the real
  service".
- Expression semantics.
- Sagas.
- Shared rate limits.

**Falsifiers.**
- An independent agent hand-lowers 30 random items. A mismatch above 10% invalidates the compiled number.
- If at least 20% of the agentic slice needs constructs outside the plan *and* outside the refusal list, then "any
  and all" is not yet defined [L2 §8.7; L3 idea #3].
- After S2, measure whether the larger IR helps a Haiku builder at all, against the S1 IR, on items that need the
  new constructs. If it does not, pause S3–S7 [L2 §7].

### 3.2 A workflow inside a workflow inside a workflow; recursion; iteration; composition edge cases

**Recommendation.** Yes, under the bounded semantics you agreed to. The lanes proposed different caps; this is the
reconciliation [I, from L2 §4–5, L3 §3.6, L7 §3.4]:

| Rule | Value |
|---|---|
| Static nesting inside one document | ≤ 6 (as today) |
| `call` depth | default 3, which covers your "three deep"; hard policy ceiling 8 |
| Runs per tree | ≤ 1,000 |
| Recursion | only through `self` or local flows, with `maxDepth`. Recursion **by hash is impossible**, because a document cannot contain its own hash |
| Termination | each child is carved a strictly smaller budget than its parent has left, so recursion ends even if the depth check is wrong |
| Iteration | `loop` ≤ 1,000 iterations, with convergence (`delta`, `patience`) and `onExhausted: best` (keep the best iteration when the cap is hit). Arbitrary cycles go in a bounded `machine` (≤ 1,000 transitions). 27 of the 46 corpus cycles have several entry points that a single `loop` cannot express [M L2] |
| Infinite processes | triggered runs (§1) |

**Edge cases already specified** [L2 §4]:
- budgets and deadlines are carved from the parent, with reservations;
- cancellation propagates; a non-idempotent child in flight becomes `uncertain`;
- sagas with compensation run in reverse journaled order;
- a `map` inside a `loop` inside a `call` composes frame keys and labels;
- composite nodes must never hold concurrency slots, or nested calls deadlock;
- runs talk only through handles: signals, queries, updates;
- a callee upgrade is a *proposal* checked by replay;
- the parent's chain commits to each child's head (a Merkle link);
- human steps deep in a tree surface at the root.

**Evidence.**
- Today's DAG plus bounded nesting cannot deadlock [I L1 W14].
- Nothing by reference exists yet [D L2 §1].
- The validator stays at ≤ 11 ms up to depth 5 [M L2 A.6]. The risk is the store, not the validator [M L4].

**Falsifiers.**
- A composition conformance suite: depth bombs, budget algebra, one writer per resource, cancellation storms, label
  laundering across `call`.
- The game-QA reference run as the end-to-end case [L1 W14].
- Recursive `call` against a flat `map` on long inputs (lane 3 idea #10). If recursion never wins, `call` is kept for
  reuse and composition only.

### 3.3 "Where are we against the complete end-to-end vision?"

See §2: about a fifth of the way [I]. The central claim has one favourable number; construction, honest verdicts
and wild-task evidence are the gap. That matches your own instinct ("once we have the core down, surely we can
iteratively test and do deep work on this"). The plan in §5 does exactly that: core first, then iterate against
harder and harder evaluation tiers.

### 3.4 Kev measuring whether a task needs a workflow, from extremely complex down to none, with a slider

**Recommendation.** Build a **two-stage router**, only if RX1 shows there is headroom to route for [L5 §2]:
1. **Hard requirements.** Code guards, plus Kev's task-property questions, force a workflow regardless of the
   slider when a task needs any of:
   - a durable wait;
   - a schedule or trigger;
   - human approval;
   - external effects with authority implications;
   - an audit trail.

   This guard can only *add* structure.
2. **Utility.** A small calibrated head, one per executor model, predicts success and cost for each mode and picks
   the best expected value. The modes, ordered by construction effort:
   - **direct**: one call;
   - **agent**: delegate to an executor;
   - **reuse**: a kept workflow;
   - **template**: one skeleton, slots filled;
   - **construct**: a bespoke workflow;
   - **construct+**: multi-stage or composed.

**Kev extracts task properties and does not make the decision.** The head is cheap to re-fit when the model changes,
which matters: Haiku 4.5 → 5.5 moved single-call success from 0/25 to 18/24 overnight [M P1].

**The slider, precisely.** It sets **V, the dollar value of one verified success**, on a log scale. Its five
positions run from **cost first** (V → 0: always the cheapest mode; a workflow only when hard-required) through
$0.10, **$1 (Balanced, the default)** and $10, to **reliability first** (V → ∞). With N expected uses, construct a
workflow when

    p̂_F − p̂_D ≥ (ĉ_F − ĉ_D + λ_t·Δt + Ĉ_F / N) / V

where:
- p̂ is the predicted success of the workflow (F) and of the direct call (D);
- ĉ is the cost per run, and Ĉ_F the one-off cost of construction;
- λ_t is what a minute of waiting is worth to you, and Δt the extra minutes the workflow takes.

**Risk aversion** is a second notch: use the lower confidence bound of p̂ instead of its mean. **Hard requirements
override both and say why.** Each slider position shows its *measured* operating point on held-out families: trigger
rate, success, $ per task and wait. Until it is calibrated, it says "uncalibrated".

**Evidence.**
- The worked example on `records` d3: a one-off task is best done by one Sonnet call, and a Haiku-built workflow
  pays off after about 7 runs, or never, depending on per-run costs [I L5 §2.2].
- C0 break-even: F-opus repays its construction after about 10.5 successes against B0-opus; F-haiku after about 486,
  which in practice means never [M C0].
- Construction itself takes 6–17 minutes [M L5].
- Corpus label traps: 461 of the 829 written descriptions leak graph features into the text [M L5 §2.6].

**Falsifiers.**
- **RX1 headroom sweep** (pilot $85; full $210). If the best per-task choice beats the best fixed mode by less than 3
  points of success and less than 20% of cost at every V and N, **don't build the router**. Ship the fixed policy
  plus the hard guards.
- RX2: if the router's headroom captured has a lower CI ≤ 0 on held-out families, it stays advisory.
- RX4 (sealed): if more than one slider position mispredicts its realised operating point, the positions become
  qualitative.
- **Agentic-coding examples** (you asked for these): `codefix` and `ownerci` supply measured labels. The agent mode
  is the default for open-ended coding unless the data say otherwise [L5 §2.7].

### 3.5 Haiku 5.5 as the workflow constructor: what else does it need?

**Recommendation.** Haiku is the **first rung of a construction cascade**. It builds the template and construct
tiers and escalates to Opus, as a logged event, if no probe passes within budget. Opus writes the library that Haiku
fills: operators, worked examples, a repair cookbook [L5 §3.1].

Haiku 5.5 cannot be fine-tuned by us (whether Anthropic offers fine-tuning for it is unknown), so its "training" is
structure and context, in order of expected value [L5 §3; L3 §3.8]:
1. **Construction as a Foundry workflow.** Twelve typed steps, with code owning the loop:
   - intake;
   - **oracle discovery**: invariants with mutation controls; this fixes vacuous acceptance;
   - shape: "single call" is an allowed answer, which hands the task back to the router;
   - skeleton retrieval;
   - slots, one group per call, schema-constrained;
   - nodes;
   - assemble and lint;
   - a smoke run on probes;
   - diagnose;
   - a patch to one node, proven by replay;
   - escalate;
   - hand-off.
2. **Executable operator skeletons (templates)** with typed slots and offline self-tests. Add **"conventions once"**:
   read per-task conventions once, check them, then apply them in code. Both `records` builders reinvented this
   [M L5 O2].
3. **Worked examples retrieved from other families.** Never the task's own family, which would leak answers.
4. **Strict construction lint as feedback.** Each rule below targets a failure already seen [M L5 §3.6; D DX]:
   - `ACCEPTANCE_EXISTENCE_ONLY` and `VERIFY_NOT_GATING`: acceptance in 7/7 artifacts is "an answer exists";
   - `ERROR_COLLECTION` becomes an error: the Haiku `records` workflow drops failed batches silently;
   - `REASONING_ON_EXTRACTION`;
   - `UNSCREENED_CLASS`: the Haiku builder put `codefix` on Sonnet and Opus without trying Haiku.
5. **A measured model card, a capability catalog and the expected recurrence N in the brief.**
6. **Replay of unchanged nodes during smoke runs.** Testing is 45–76% of a Haiku construction's cost [M L5 O1].
7. **Kev as an advisory selector:** task properties, shape, and the probe-failure cause, learned from injected
   faults.
8. **The "edit" half.** Haiku repairs a broken workflow from a failing run record, scored by replay. No experiment
   has tested editing yet [D L1 gap 3].

**Evidence.**
- Haiku built probe-passing workflows at 0.4× Opus's construction cost: $1.01 vs $2.47 on `records`, $0.90 vs $2.04
  on `codefix` [M C0].
- On test tasks it reached 11/16 vs Opus's 16/16 [M C0].
- Both failure causes are exactly what items 1 and 4 target [D DX]:
  - `records`: one Haiku node at low reasoning, with no check, decided a date order, and got it wrong;
  - `codefix`: a check flagged a correct default-value fix as a signature change, and a repair node then undid the
    fix.
- Trained weak constructors do work (W4S, FlowReasoner, MAS-GPT, WorkflowLlama), but every one of them was trained
    [D L5 §3.1, abstracts].

**Falsifiers.**
- **CX2** (free): do lint violations predict test failures? If not, lint is hygiene, not feedback.
- **CX3** ($55): the structured builder against the free agent builder, both on Haiku. If it is not better on
  success and not cheaper, drop it.
- **CX4** ($75): add one aid at a time. Remove any aid that helps no family.
- **C0 sealed kill rule:** if Haiku's construction success on sealed families is below half of Opus's, Opus stays
  the default constructor [L1 W4].

### 3.6 "So Haiku 5.5 is building the environment, the nodes? And why not give it tools?"

**Clarification.**
- **P1's single-call arm builds nothing.** Haiku gets the whole task in one prompt and writes the answer directly.
  It has no workflow and no tools.
- **In P1's workflow arm**, an Opus agent wrote the workflow beforehand, and Haiku only executes its narrow nodes.
- **Haiku building workflows is C0's F-haiku arm.** There Haiku *does* have tools: Claude Code in a sandbox, with
  shell, files, three probes, `/score` and a model gateway [D C0 PREREG-dev].

**Why not give the executing Haiku tools?** P1 tested exactly that: `b0agent-haiku` runs Claude Code with
Bash, Read, Write, Edit, Glob and Grep. It passed **17/23 at $0.086 per trial**, against **23/24 at $0.016** for the
workflow [M P1]. Here the tools did not help; letting code own the procedure did.

**Recommendation.** Tools come in three bounded forms:
1. `code` nodes for deterministic tools.
2. A capped `agent.tools` loop for short tool use: an allowlist, at most 16 turns, every turn journaled [L2 E3].
   This is needed to *represent* the agent tool loop, the most common agentic construct (123 of 199 agentic items
   [M AG]).
3. The **bounded `executor` node** for open-ended loops (debugging, multi-file edits, exploration), always followed by
   a `verify` node [L7 §3.2].

Lanes 2 and 7 disagree on point 2; I reconcile them [I] as follows. The IR *represents* `agent.tools`, and its first
implementation runs inside the executor adapter. A Foundry-native loop is built only if a measured family needs
replay or repair turn by turn [L7 §3.3].

**Falsifiers.**
- Lane 7 stage 4: on `codefix`, a workflow with an executor plus `verify`, against Claude Code alone, at equal spend.
  No gain means executors are only a fallback.
- Lane 3 idea #6: does a spawn depth above 1 help? If it adds less than 5 points, the default stays at 1.

### 3.7 "Toy workflows? Cheating? We need to say something arbitrary." And replicating niche workflows (R-bench)

**Honest answer.**

*Not cheating:*
- the experiment was pre-registered and frozen before any test task ran;
- the test seeds were never inspected;
- an independent host-side oracle scored every trial;
- negative results are kept.

*Not toy for a single call either.* `records` d3–d4 has 37–42 entities, five per-task conventions stated only in
prose, and planted namesakes. A 40-line heuristic passes 0/30 at d3, and a Haiku 4.5 single call passes 0/25
[D P1 PREREG §1; M P1].

*But it is a favourable setup:*
- a single synthetic family;
- Claude wrote the bed;
- an Opus agent wrote the workflow after studying the family on dev seeds;
- a Haiku 5.5 single call already gets 18/24.

So P1 is a *ceiling* result. **C0 already shows the drop once Haiku constructs the workflow itself**: 16/16 falls to
11/16, and the run verdict said "pass" anyway [M C0; D DX].

**Recommendation: a wild evaluation tier, in this order** [I, from L1 gap 6 and W5, L2 §8, L5 CX6]:

| Tier | What | Why it is harder to fool |
|---|---|---|
| T0 | dev beds (now) | — |
| T1 | **C0 sealed families** (4, by a separate author, never used) | never-seen families |
| T2a | **R-bench: replicate real workflows.** Corpus items with an executable oracle: 131 are eligible (redistributable, a usable description, oracle tier T1–T3), and 96 corpus items ship checks that run offline (tier T1); writing descriptions for 63 more T1 items would roughly triple the pool [D corpus COVERAGE §7–8]. Haiku gets only the *original* description and must build a Foundry workflow that reproduces the effect trace and output on fixtures. Score: replicated or not, cost to build and run, IR gaps hit, and **improvements found** (missing failure handling, checks, defects in the original) | humans spent real effort on these, and we never wrote them |
| T2b | an external benchmark that installs locally (TextWorld, IDoFT or AppWorld; check acquisition first) | not written by Claude |
| T3 | **10–20 tasks you write yourself**, sealed until the run | "say something arbitrary", literally |
| T4 | your real recurring tasks, from ARC and AMP logs (later) | real distribution |

**R-bench caveats:**
- Use only the 449 *original* descriptions; written ones leak graph features [M L5].
- Connectors are mocked, so this measures *logic* replication, not deployment. No real accounts are touched (AGENTS
  rules).
- Non-redistributable items can't be committed as fixtures.
- **Status:** at 08:14 UTC the pilot is one item-selection script (`/var/tmp/foundry-work/replicate/summ.mjs`); there
  are no results and no `research/replicate-20261008/` yet [M].

**Falsifier.** If F's advantage over B0 and B1 disappears on T2 or T3, the claim is a bed artefact [L1 W5]. The
pilot, about 10 items for $30–60, is report-only. The claim-bearing round uses a fresh sample frozen after the IR
freeze.

### 3.8 "Do we need to train a small LLM to pick nodes or templates?"

**Recommendation.** Only as a last resort, and in this order [I L5 §3.8; L3 §3.7]:
1. Retrieval plus templates.
2. Construction as a workflow (CX3).
3. The context ladder (CX4).
4. **Kev as the selector.** "Which skeleton, which shape" is a choice among N options, which is exactly Kev's format.
   Kev can be fine-tuned on your laptop.
5. Only then, a 7–8B open-weight generator that emits a *skeleton choice plus slots*, not whole IR.

**Evidence.**
- Trained small constructors work: W4S (7B, about one GPU-hour of RL), WorkflowLlama (8B, about 106K samples),
  MAS-GPT, FlowReasoner [D L5 §3.1, abstracts].
- We have 8 constructions with test outcomes [M C0]. That is nowhere near training data.
- The corpus graphs carry no success labels.
- Local generative models are parked on this CPU (268 s per call) [D README].

**Trigger to train.** Both must hold: after CX3 and CX4, Haiku's construction success on sealed families is still
below half of Opus's, *and* at least a few thousand executed (brief → skeleton plus slots → verified) rows exist.
**Kill rule:** if CX3 and CX4 bring Haiku within 3 points of Opus, don't train.

### 3.9 Swarms: are they in scope?

**Recommendation.** Yes, as **an operator family over the IR**:
- **`wide`:** a planner emits a bounded, typed subtask list; code checks it for overlap and gaps; a `map` of cheap
  typed workers; a code reducer; an independent `verify`.
- **Variants:** `panel` and `loop_until_dry`.

Not as a subsystem. **No 100–300-agent defaults** (cap around 32 without evidence), no free group chat and no
learned orchestrator. **Every swarm must beat B5**, best-of-K with the same verifier at equal tokens [L3 §3].

**Evidence.**
- Swarms buy breadth and wall-clock time, not depth: Kimi +17.8 points on BrowseComp; Anthropic +90% internally.
- Coding and sequential work: −2 to −15 points.
- About 15× the tokens.
- Independent agents amplify errors 17.2×; centralised ones 4.4×.
- Parallel subagents already exhausted our weekly limit once [D L3 §1.3; D README].
- Our own ceiling: the `claude -p` route manages 2.3–3.4 calls/s on 4 vCPU, and the store adds 73–135 s at 1,000
  items [M L4].

**Falsifier.** Lane 3 idea #1, $30–50. `wide` on Haiku against a Sonnet single call or agent, against B5, and
against a real Claude Code workflow script. It fails if any of these hold:
- it is more than 5 points worse;
- its cost per verified success is not ≤ 0.5× the baseline's;
- it loses to B5.

### 3.10 Claude Code dynamic workflows (and "ultracode") versus Foundry

**How they work** [D L3 §1.4]:
- Claude writes a deterministic JavaScript script using `agent()`, `pipeline()` and `parallel()`.
- Agents can be given schemas.
- Up to 16 agents run at once, 1,000 per run.
- Budget is a token pool for the turn.
- Resume **replays the longest unchanged prefix in start order**, so a failure mid-fan-out reruns siblings that had
  already finished.
- `workflow()` nests one level; subagents nest 3 levels.
- Ultracode writes a workflow for *every* substantive task.

**Same:** fan-out, structured outputs, journaled resume, caps, and the rule that a computed prompt is never consent.

**Different:** Foundry has:
- typed control fixed before untrusted data is read;
- narrow typed nodes instead of open-ended agents;
- replay per item;
- dollar budgets per node;
- independence labels;
- a model class per node.

**Recommendation.** Treat Claude Code workflows as **executors inside Foundry and as the baseline to beat (B1-cc)**,
not as something to rebuild. Note that C0's B1 is a sandboxed Node script, not a real Claude Code workflow [D L1 #32].

**Falsifiers.**
- Lane 3 idea #4 ($2, can run now): inject a failure at item k of a 16-item fan-out. Foundry should re-execute
  exactly 1 item; Claude Code's documented resume re-executes 16 − k + 1. If Foundry re-executes more than one, or
  its output changes, that is a replay bug.
- B1-cc as an arm in the C0 sealed round and in the `wide` experiment.

### 3.11 Subagents inside nodes: "am I overcomplicating?"

**Recommendation.**
- **For narrow nodes, yes, it would be overcomplicating.** `agent`, `code` and `verify` never spawn. The runtime
  spawns, through `map`, `call` or `expand`, so every spawn is journaled and budgeted.
- **For open-ended steps, no.** Use one node kind, `executor` [L7 §3; L3 §3.4]. It has:
  - nested agents set to 0 by default;
  - a budget reserved from the parent;
  - a timeout and heartbeats;
  - a transcript whose hash goes into the chain;
  - `egress: none` by default, through a host gateway;
  - effects marked `uncertain` when egress is on;
  - a mandatory `verify` afterwards.
- **Limits:** at most 2 executors running at once and 16 per run.

**Evidence.**
- Today the executor sandbox has no network isolation, and the CLI login is readable inside it. A nested
  `claude -p` call would run outside every ledger; only an after-the-fact transcript scan catches it [D L7 §3.4].

**Falsifier.** Lane 7 stage 4 and lane 3 idea #6 (§3.6).

### 3.12 Shared message board, shared state, private notes

**Recommendation** [L7 §2; L3 §3.5]:
- **A run-scoped board of typed facts, not chat.**
  - Topics have a schema, a reducer (append, set union, last-writer-wins with compare-and-swap, claim) and declared
    writers.
  - Nodes declare their reads.
  - Each read happens at one sequence number (`atSeq`), recorded in the receipt, so replay is exact.
  - "Shared understanding" means every node sees the same view at the same sequence number.
- **Private notes** are a per-node scratch space, never shared, journaled for audit. They leave only through a typed
  output field.
- **No Foundry store that persists across runs.**
  - Cross-run *knowledge* ("lessons") becomes a versioned workflow change proven by replay, or an AMP claim. **AMP
    owns memory.**
  - Cross-run *application state* (a cursor, a dedupe set, a chat session) is a typed state capability with
    compare-and-swap.
  - This amends ROADMAP §2.2's `workflow` scope (decision 5).

**Evidence.**
- Typed DAG edges already give single-writer shared state, enough for most workflows [D L7 §2.1].
- A board pays off only when many writers feed one stream, branches read each other sideways, results accumulate
  across iterations, or a person writes in mid-run.
- Free chat between agents is a top-three failure category (MAST) [D L7 §0].
- The pre-registered B0+N arm *is* a cross-run notes store, and it scored 16/33 in P1 [M P1].

**Falsifier.** Lane 7 stage 2, pre-registered on `gridquest` or `gameqa`. If the board is not at least 15% better per
dollar than the same workflow without it, park it and keep edges.

### 3.13 Auditability

**Recommendation.**
1. **Close the hash-chain gaps first:**
   - `requestHash`/`responseHash` on every model call;
   - decisions recorded as chain events;
   - executor transcript hashes;
   - a journal root and board root at seal;
   - run heads anchored in the committed experiment manifests;
   - `foundry verify RUN` [L7 §4.4].
2. **Then a flight recorder.** It is a pure fold over records that already exist: timeline, node cards, costs
   including cache efficiency, anomalies, and a "why-index". The run view from §3.17 is its face.

**Evidence.**
- Today an edited `model_calls` row does not break verification, because responses are not bound.
- Decisions sit outside the chain.
- Nothing anchors the chain outside SQLite [D L7 §4.1].
- The run view already answers 6 of 7 "what happened?" questions [M L6].

**Falsifiers.**
- Edit one journal byte: `verify` must fail.
- ROADMAP §2.10's exit criterion: you answer "why did this happen?" on 10 recorded failing runs in under 2 minutes
  each, with and without the view.

### 3.14 Efficiency, and should it be Rust?

**Recommendation.** Fix the algorithm and the model route, and keep Node. Ranked by measured gain [M L4 §6]:
1. **Two CLI environment flags**, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and `FORCE_PROMPT_CACHING_5M=1`:
   - −0.6 to −0.8 s per call;
   - −17 to −31% cost per call;
   - throughput at 6 concurrent calls from 1.89 to 3.01 calls/s.

   Adopt after P1 finishes, because P1 is frozen.

   The lanes agree once their numbers are put together. The CLI writes its prompt cache at the one-hour price (2×),
   which is why lane 7 found caching mostly costs money. The 5-minute cache beats both that default and turning
   caching off [M L4 §2.4; M L7 §5.2].
2. **Per-node store rows** instead of rewriting the whole run blob on every event:
   - a 1,000-item map from 89 s to a 1.65 s floor; 10–54× in general;
   - removes the event-loop stalls that freeze a UI running in the same process.
3. **A work-conserving scheduler:** −6.5 to −8.8% wall time on the real DAG.
4. **A native sandbox launcher** (115 lines of Rust, a reviewed security component): a code node from 212 ms to
   41 ms.
5. **Shorter outputs on extraction nodes.** Two nodes are 52% of the Haiku 5.5 spend.

**Rust: not now.**
- Porting the kernel is about 19 person-weeks (14–26) [I L4 §7.2].
- The gain on real runs is at most 1.5–3% of wall time.
- The design is still moving.

**Revisit only when all four hold** [L4 §7.5]:
- after the store fix, runtime overhead is still ≥ 10% of wall time or cost;
- the IR is frozen;
- a conformance corpus exists;
- there is a deployment reason, such as embedding in AMP's Rust daemon.

**Falsifier.** Lane 7 stage 1: per-event cost must stay flat (< 5 ms at 10,000 events), with replay conformance
unchanged.

### 3.15 Frontier research and OSS: the top ideas

Use them as **semantics and baselines, not dependencies**. Avoid Restate (BSL 1.1) and Inngest (SSPL) as dependencies
[M L3 §4]. Ranked by capability per unit of effort [L3 §5; L5 §4]:

| # | Idea (source) | Cost (list $) | Kill rule |
|---|---|---|---|
| 1 | `wide` operator plus a critical-path metric (Kimi, Anthropic) | 30–50 | loses to B5 or B0 (§3.9) |
| 2 | Need gate with a cascade baseline (MaAS, DAAO, Adaptive-RAG, RouteLLM) | reuses runs | no headroom (RX1) |
| 3 | Agent-framework corpus slice | ≈ 0–10 | ≥ 20% of items unplannable |
| 4 | Replay per item vs prefix replay (Claude Code) | ≈ 2 | Foundry re-executes more than one item |
| 5 | Verify panels with independence labels (vote > debate) | ≈ 20 | no panel beats single Sonnet at equal $ |
| 6 | Executor spawn-depth governance | 60–100 | depth > 1 adds < 5 points |
| 7 | Weaver-style ensemble of weak verifiers, distilled into Kev | ≈ 10 + GPU | ensemble ≤ best single verifier + 2 points |
| 8 | Run board vs isolated explorers (MetaGPT, agent teams) | 20–40 | board ≤ isolated, per $ |
| 9 | Per-node prompt search, GEPA/MIPRO-style in JS (DSPy, MASS: prompts before topology) | 15–30 | < 5 points at node level |
| 10 | Recursive `call` for long inputs (RLM) | ≈ 20 | never beats a flat `map` |

Semantics to adopt:
- Temporal child workflows and Continue-As-New;
- the DBOS `fork` verb;
- MetaGPT's "activate when all prerequisites are present";
- a CEL-like pure expression language.

**The 2026 signal:** small *trained* orchestrators (ToolOrchestra-8B, AgentFlow-7B, WideSeek-R1-4B) now beat large
general models. That strengthens the case for a trained Kev gate, and weakens any plan that relies on a *prompted*
small model orchestrating without checks [D L3 §4.9].

### 3.16 Later in AMP: parallel workflows working together, in all combinations

**Recommendation.** Phase 6–7, after `call`, `detach`/`await` and the board exist. The rules [L2 §4.10; L3 §3.6]:
- runs are addressed only by handle, never by an ambient run id;
- signals, queries and updates are journaled;
- a tree-scoped board;
- one writer per resource;
- a **central reducer plus a verifier** (independent topologies amplify errors 17.2×, centralised ones 4.4×);
- mandatory timeouts, plus a wait-for graph that reports suspected deadlock;
- composition *across* stores goes through MCP or A2A capabilities.

AMP integration stays an experiment (D4 deferred). AMP can back the context and state ports later.

**Falsifier.** The composition conformance suite, plus the game-QA reference run end to end (§3.2).

### 3.17 Node visualisation: breathing dots, a live line, click to open the chat

**Built as a prototype**: `tools/run-view/`. Screenshots are `ui-*.png` in this folder.
- Each node has a breathing coloured dot, a one-line live note, and a click that opens its transcript: prompt, typed
  reply, checks, escalations, costs and receipts.
- It replays recorded runs, or follows a live run through a read-only server. Commit-to-browser lag is p50 12 ms.
- A 1,000-item run folds in 45 ms [M L6].

**Two expectations to set:**
- The "chat" is a read-only transcript. A viewer that can act would hand authority to untrusted model text.
- A "visual understanding" node needs image inputs, which don't exist yet.

**Next step:** look at `ui-6-gameqa-escalation.png` and `ui-7-gameqa-transcript.png` and tell us whether the folding
level and the wording are right. **Kill rule:** if you can't answer "why did this happen?" on 3 real failed runs
within 2 minutes using it, fix the wording before moving it into `web/` [L6 §9].

### 3.18 "Deeply reason about worst cases; re-evaluate the entire concept"

See §4. The concept survives, with two corrections [I]:
- **The claim narrows:** "cheap models execute *checked* workflows that frontier models or structured Haiku
  construction produce, on tasks that recur or that need structure". Not "any task".
- **The verdict layer moves to the front:** a workflow that self-certifies "pass" on wrong answers is worse than none.

---

## 4. Worst cases for the concept

| # | Worst case | Current evidence | What settles it |
|---|---|---|---|
| W1 | **A single strong call or a plain agent keeps winning** | *Against:* fhand-haiku 23/24 vs Sonnet single call 18/24, at 0.053× the CPS [M P1]. *For:* the Haiku 5.5 single call already gets 18/24 [M P1]; in C0, F-opus only ties B0-opus on success (16/16 each) [M C0] | C0 sealed. **Kill rule:** if a single call matches F-haiku's success with the CPS-ratio upper bound ≥ 0.85 on 3 of 4 sealed families, shrink the claim to "rescuing a weak model" [L1 W1] |
| W2 | **Plain scripts, or Claude Code workflows, match F** | *For:* the Haiku builder's scripts 16/16 vs its F workflows 11/16. *Against:* with the Opus builder, F 16/16 vs scripts 12/16, and F's execution CPS is 0.21× [M C0] | C0 sealed with K_c = 2 and a B1-cc arm; F ablated without checks, escalation and verify |
| W3 | **Construction never pays for itself** | Break-even vs B0: F-opus about 10.5 successes; F-haiku about 486 (never); B1-haiku about 27.5 [M C0] | C0 amortisation curves; a census of how often your real tasks recur (needs ARC/AMP logs) |
| W4 | **Cheap constructors fail on unseen families** | 11/16 vs 16/16 on dev; failures are construction defects [M C0; D DX] | C0 sealed; CX3/CX4; **kill rule** below half of Opus |
| W5 | **We only win on tests our own model family wrote** | Claude wrote every bed, skill and builder prompt; audits keep finding bypasses [D L1 gap 6] | The wild tier (§3.7): R-bench, an external bed, your own tasks |
| W6 | **Self-certified success: judges and verdicts are wrong** | Run verdict "pass" on 5/5 failed F-haiku trials [D DX]; stock Kev ≤ rules on 4/5 ports [M L1]; the repo's earlier 0/21 skills arm had 21 false successes [D L1] | The acceptance lint plus oracle discovery; verdict-vs-oracle agreement reported for every arm |
| W7 | **Untrusted content takes control** | The validator accepts an effect gated by untrusted data [M L7 A.3]; construction-time injection untested; executor egress open; 40 of 199 agentic items execute model-written code [M AG] | §7 fixes, plus an injection slice in C0 sealed and R-bench. Requirement: zero effects or exfiltration through F |
| W8 | **Scale breaks it** | 1,000-item map: 73–135 s overhead; the CLI tops out at 2.3–3.4 calls/s; the weekly limit stopped all work twice [M L4; D README] | Store rows plus the flags; load tests (1,000-item map, 300 nodes, 10 concurrent runs) |
| W9 | **"Represents ~100%" means neither "runs" nor "covers agent patterns"** | 0 compiled; agentic slice at 35% with the planned constructs [M L2; M AG] | D/C/E reporting, a fresh held-out sample, the lowering audit |
| W10 | **Model churn invalidates the evidence** | Haiku 4.5 → 5.5 in one day moved single-call success from 0/25 to 18/24 [M P1] | Re-qualify frozen artifacts after each model or CLI change; re-fit the router head with ≤ 100 labels (RX5) |
| W11 | **Deciding costs more than it saves** | A Haiku zero-shot router call costs as much as the task it routes [I L5 §5] | Mixed stream: always-direct vs always-workflow vs router at 3 slider settings; one setting must dominate both |
| W12 | **Scope collapse: new asks eat the budget before numbers exist** | About 61K lines in about a day; this review ran 7 lanes on the same allowance [D L1 W12] | **Rule:** no new subsystem without a pre-registered experiment that needs it |
| W13 | **The labs absorb it** | Claude Code workflows plus ultracode shipped [D L3 §1.4]; plugin eval with with/without deltas [D L1 W13] | Differentiators to measure: replay per item (idea #4), independence labels, $ per node. Selection across vendors is untestable here: single vendor [D L1 gap 15] |
| W14 | **Composed workflows fail together** (deadlocks, double-counted budgets, two writers, spawn bombs) | No composition semantics exist yet [D L2] | The composition conformance suite |

---

## 5. Plan for the next four weeks (2026-10-08 → 2026-11-05)

**Constraints.**
- **Usage limit.** The 7-day plan limit is at warning until **2026-10-14 11:00 UTC** [D L1 #20].
- **Pause rule.** Any single experiment estimated above **$500** pauses for you. The self-imposed soft cap for the
  session is $1,500 at list price [D README].

**New usage rule** [I]:
- run at most 4 concurrent agents;
- while the 7-day meter shows a warning, only pre-registered runs already in flight continue;
- start heavy runs just after a reset;
- keep review and orchestration fan-out to at most 2 agents.

**Stage 0. Until the reset, 2026-10-14 11:00 UTC. No-spend work plus finishing what is in flight.**
- **Deliverables:**
  - P1 finished and written up as `research/core-20261006/REPORT.md`, the first Phase-1 capability number;
  - C0 dev `REPORT-dev.md` for `records` and `codefix`;
  - CX2 lint retro-audit (free);
  - lane 3 idea #4, replay per item vs Claude Code prefix replay ($2);
  - agentic slice frozen, with a lowering audit of 30 items;
  - R-bench protocol and pre-registration (no runs);
  - one docs commit: README status and cost ledger, model roles, the decisions below, negative results (records v2
    scriptable, the C0 preflight NO-GO, F-haiku diagnoses).
- **Number vs baseline:** P1 fhand-haiku vs the Sonnet single call (success and CPS, as pre-registered).
- **Cost:** about $10–15 list.
- **Kill rules:** P1's own (> $60 total or > $20 per arm). If the final CPS-ratio upper bound reaches 1, or
  fhand-haiku's success CI falls below Sonnet's, report "no directional support".

**Stage 1. 2026-10-14 → 10-20. Make the verdict honest and the runtime ready; structured construction.**
- **Deliverables:**
  - **One engine bump after P1:**
    - the two CLI flags;
    - per-node store rows and the work-conserving scheduler;
    - the reviewed sandbox launcher;
    - hash-chain binding and anchors;
    - control-flow taint;
    - the strict construction lint, with acceptance required to gate;
    - run-view fields G1–G4.
  - CX3 (structured vs free Haiku builder) and CX8 (replayed smoke runs).
  - RX1 pilot on `records` and `codefix`.
  - R-bench pilot: about 10 items, Haiku structured builder vs Opus free builder.
- **Numbers:**
  - per-node overhead before and after (1,000-item map, 89 s → target < 5 s);
  - cost and latency per call before and after;
  - CX3 test success and $ vs the free builder;
  - RX1 headroom over the best fixed mode;
  - R-bench replicated / attempted.
- **Cost:** about $175–205 (CX3 $55, CX8 $3, RX1 pilot $85, R-bench $30–60).
- **Kill rules:**
  - replay conformance must stay byte-identical, or the store change reverts;
  - CX3: no better and no cheaper → drop the structured builder;
  - RX1: < 3 points and < 20% cost headroom everywhere → no router; ship the fixed policy plus hard guards;
  - R-bench: lowering fails on > 50% of items for reasons other than missing constructs → fix lowering before
    scaling.

**Stage 2. 10-21 → 10-27. Claim-bearing construction and the wild tier.**
- **Deliverables:**
  - **C0 sealed round**, pre-registered, with these arms:
    - F-haiku with the winning builder;
    - F-opus;
    - B1 and B0;
    - **B1-cc**;
    - a CX5 cascade arm;
    - an injection slice.
  - Your 10–20 written tasks collected and sealed.
  - IR S0–S1: construct ledger, D/C/E pipeline, `call` with depth and budget carving, local flows. This gives the
    first *compiled* coverage number on the corpus and the agentic slice.
  - The `wide` operator vs B5 (idea #1).
- **Numbers:**
  - sealed success and CPS: F-haiku vs F-opus vs B1 vs B1-cc vs B0;
  - compiled coverage;
  - `wide` vs B5.
- **Cost:** about $380–400. The C0 sealed kill rule is $350, under the $500 pause rule; `wide` is $30–50.
- **Kill rules:**
  - Haiku construction below half of Opus's → Opus stays the constructor, and Haiku keeps only the template tier;
  - the W1 rule (§4);
  - B1 ≥ F for both builders → the typed IR is kept only where verdicts and replay are needed;
  - `wide` loses to B5 → no swarm default.

**Stage 3. 10-28 → 11-04. Bounded delegation, error handling, the second wild pass.**
- **Deliverables:**
  - IR S2 (error routes, `finally`, adaptive retry), then the capability check;
  - the `executor` node with `egress: none` through a gateway (needs decision 4) and the `codefix` experiment;
  - CX4 context ladder;
  - RX2 router v0 offline, only if RX1 found headroom;
  - Kev vs Haiku 5.5 on the probe items before any laptop nights, then Kev T1 only on ports where it wins;
  - R-bench grown to about 30 items;
  - first run of your sealed tasks.
- **Numbers:**
  - S2 IR vs S1 IR for the Haiku builder on items that need it;
  - executor workflow vs Claude Code alone at equal $;
  - the CX4 gain per aid;
  - your tasks: F vs B0 vs B1.
- **Cost:** about $220–265 (executor $60–100, CX4 $75, R-bench $60, Kev arm $5–10, S2 check $20).
- **Kill rules:**
  - S2 doesn't beat S1 → pause S3–S7;
  - the executor shows no gain over Claude Code alone → executors are a fallback only;
  - Kev doesn't beat Haiku 5.5 on accuracy, calibration and latency → that port uses Haiku or rules.

**Total:** about $785–885 at list price for experiment calls [I], plus orchestration, which is not itemised. No
single experiment exceeds $500.

**Stop or defer** (each with its reason):

| Item | Why |
|---|---|
| A Rust kernel port | ≤ 3% gain; the target is moving [M L4] |
| Triggers, durable waits, sessions, streams (IR S3–S6) | after the S2 capability check [L2 §7] |
| A full board (waits, summaries, cross-run scopes) | only the stage-2 experiment, and only if a bed needs it [L7] |
| A swarm subsystem; fan-outs above 32 | an operator plus B5 first [L3] |
| A Foundry-native agent loop (`delegate`) | executor first [L7 §3.3] |
| Training any generator, Haiku or 7–8B | §3.8 trigger not met |
| The full Kev wave-1 build (42 ports) | Kev's cost edge is gone; compare against Haiku 5.5 first [I L1 gap 9] |
| Moving the UI into `web/`; editing or approving from the viewer | after the C0 freeze; never an editor [L6] |
| New beds beyond the pending audits | wild-tier tasks instead |
| ARC/AMP integration | Phase 7 experiment (D4) |
| More review lanes | W12 |

---

## 6. Decisions needed from you (each has a default if you don't answer)

| # | Decision | Default |
|---|---|---|
| 1 | Finish "it becomes essentially …" | *"a compiler and runtime for task-specific agent systems that cheap models can drive"* |
| 2 | Define "~100%": represent exactly or reject with a named reason; the headline is compiled + executed on a fresh held-out sample, with declared reported alongside; the agentic slice is included | yes |
| 3 | Record the model roles: Haiku 5.5 constructs, edits and runs; Opus writes the library and is the escalation constructor; Opus and Sonnet build Foundry; local generative models parked; Kev is the local judge | yes |
| 4 | Executors get model access only through a host gateway (needs an API key in env), so `egress: none` is enforceable | no executors on untrusted third-party content until it is provisioned |
| 5 | No mutable cross-run store in Foundry: lessons go to AMP or to a replay-proven version; app state goes to a state capability (amends ROADMAP §2.2) | approve |
| 6 | D2 amendment: resume under a new engine when replay reproduces the checkpoint state hash (needed for any durable construct) | approve |
| 7 | Trigger activation: model-built workflows declare triggers; only you activate them, per (workflowHash, triggerId, specHash) | approve |
| 8 | Close the C0 dev round after `records` and `codefix` (plus `incident` if its audit finishes by 10-14); fold the lessons into the kit before the sealed round | yes |
| 9 | Slider default "Balanced" (V = $1, no wait penalty); allow 5–10% exploration on low-stakes tasks so labels stay unbiased | yes |
| 10 | Write 10–20 tasks yourself for the wild tier, sealed until run | if none arrive by 10-21, use R-bench and an external bed only |
| 11 | Rust: not now (triggers in §3.14) | confirmed |

---

## 7. Security and integrity fixes required before any untrusted third-party content is executed

None of these is optional for R-bench items, corpus fixtures, external beds or your real repositories. Items 1–8 land
in the Stage-1 engine bump. Items 9–14 land before the stage that first needs them.

| # | Gap today | Fix | Test | Source |
|---|---|---|---|---|
| 1 | **Control-flow taint is missing.** `when`, `until`, map count and waits on untrusted data can decide whether an effect fires; the validator says `valid: true` | Program-counter taint: the condition's labels join into every node it controls; an untrusted condition plus an effect needs approval or quarantine (`UNTRUSTED_CONTROL`) | Probe B must fail with `LABEL_POLICY`; the same for `until`, `map` and `wait` | [M L7 A.3, S2] |
| 2 | Label policy is all-or-nothing on effect arguments | **Sink-field policy.** Untrusted data may reach data sinks (row values, message body). Control sinks (recipient, path, URL, command, query) need approval or a quarantined endorsement | Honest compilation of "webhook → write row" items passes; an untrusted URL sink is rejected | [D L2 G3] |
| 3 | **Laundering by repetition.** A 64-bit quarantined output, mapped over 1,000 items, yields 64 Kbit of "trusted" data | A run-level declassification budget in bits; effect arguments built from declassified values must match an allowlist or enum | The 26-letter enum-spelling attack is rejected | [I L7 S3] |
| 4 | **Construction-time injection.** Builders read untrusted task text and write *trusted* workflow text | Provenance taint on workflow text derived from untrusted input; approval before such a workflow uses effects or egress; the router reads trusted fields only, and its hard guard can only add structure | An injection slice in C0 sealed and R-bench (instructions planted for the builder, the runtime and executors); zero effects or exfiltration through F | [D L1 gap 10; L7 S10; L5 §2.5] |
| 5 | **Executor isolation.** No `--net` namespace; the CLI login is readable in the sandbox; Bash is on by default; nested `claude -p` is only detected afterwards | `egress: none` by default (private network namespace plus a unix-socket gateway); no login inside the sandbox; per-node, budget-scoped, revocable gateway tokens; nested model use blocked up front | A canary file and a canary in task data never leave; a network probe shows no egress; token reuse from another node is rejected | [D L7 §3.4, S4, S5] |
| 6 | **Model-written code** (40/199 agentic items) | Run only as sandboxed `code` with no network; output labelled untrusted; never on the host | A planted escape attempt fails the sandbox suite | [M AG; I] |
| 7 | **Hash-chain gaps:** responses, decisions, transcripts and the journal are not bound; no external anchor | `requestHash`/`responseHash`; `decision.recorded`; `transcriptHash`; `journalRoot`/`boardRoot` at seal; heads anchored in committed manifests; `foundry verify RUN` | Edit one journal byte → verify fails | [D L7 §4.4] |
| 8 | **Self-certified success.** Acceptance reduces to "an answer exists"; failed batches are dropped silently | The construction lint makes these errors (`ACCEPTANCE_EXISTENCE_ONLY`, `VERIFY_NOT_GATING`, `ERROR_COLLECTION`); every report shows run verdict vs independent oracle | Re-run the 5 failed F-haiku trials: the verdict must not be `pass` | [M L5; D DX] |
| 9 | Triggers and long-lived authority | Model-built workflows *declare* triggers and never activate them; rate limits; mandatory wait timeouts; runs addressed only by handle | Activation without owner approval is rejected | [I L2 §5, §10] |
| 10 | Retry storms on rate limits | A shared per-provider backoff gate; a usage-limit pause instead of failure | 16 map items hitting a 429 retry once, in a staggered way | [I L7 §3.5; L3 §2.5] |
| 11 | The viewer becoming an actor | Keep it read-only: no approve, answer or resume buttons; strict CSP; sanitised text; redaction on export (regex redaction cannot catch secrets of unknown shape) | Already covered by 74 browser checks, including hostile text | [M L6 §6] |
| 12 | A swapped sandbox launcher | Review it as a security component before replacing the shell path; keep the old path as a logged fallback | The 15 sandbox tests plus escape tests beyond the suite | [D L4 §6, §9] |
| 13 | Corpus and R-bench sources | Treat them as inert data: never run install hooks; execute only against mocks; record licence and redistributability per item | Acquisition manifest check | [D AGENTS.md] |
| 14 | The laptop bridge | Keep the signed, allowlisted jobs; the `torch.load` path was closed and the bridge attack-tested; re-verify on the first real round trip | Bridge test suite | [D L1 #48, W7] |
