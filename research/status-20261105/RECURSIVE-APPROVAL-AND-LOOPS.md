# Recursive approval and loops: design note (owner idea, 2026-11-05)

*Status: designed, not built, not measured. Written by the orchestrator from repository evidence; inference is marked.*

## The idea, in the owner's words (shortened)

The meta harness builds the overall workflow. Every sub-node in it is asked whether it ever needs a sub-workflow (or
something else). At each depth, before anything is created, the sub-node asks the workflow's main agent for approval,
without interrupting the person. The main agent judges whether the sub-workflow serves the goal; if yes, the sub-node
goes ahead and creates it. Depth can be set by the person, or the meta agent can encode it. Also: loops of every kind,
for example a sub-agent of a node talking to a sub-agent of another node, or local to local across nodes, and anything
else the maximal vision needs.

## What we already know

| Evidence | What it says for this idea |
|---|---|
| SW-1 (`research/subworkflow-20261021/RESULT-SW-1.md` §1): when the parent directs a sub-workflow, the node passes 32/32 backlog nodes building it itself, 31/32 filling a template, 27/32 through the governing builder, against 11/32 for the node alone, at 0.31–0.54× the baseline's cost per task | A sub-workflow is a large gain **once someone decides one is needed**. The parent is a good decider |
| SW-1 §2: a node deciding on its own chose a sub-workflow on 6/32 nodes and passed 15/32 (no measurable gain over 11/32) | Cheap nodes **under-ask**. Waiting for a node to realise it needs help loses most of the gain |
| Swarm rung 1 (`research/swarm-20261021/RESULT-R1.md`): the Haiku lead started 0 workers in 8 of 8 sessions | Same lesson: cheap models do not delegate spontaneously |
| Tracker and judge studies (`research/tracker-20261021/RESULT-TRACKER.md` §11; arXiv 2609.22512, 2605.29800 in WHY-NOT-HIGHER.md) | A model reviewer catches a few things; model judges are correlated. A model should judge only what code cannot |
| Engine today: nested bodies (map and loop) to depth 6 (`src/validate.mjs:379` NESTING_LIMIT); loop `maxIterations`; run budgets for steps, cost, tokens and time; principals and segregation of duties for human nodes (`src/principals.mjs`); only a person approves outside effects; proposals are version-bound; state changes use compare-and-swap | Most of the safety rails exist. What is missing is the **propose → approve → instantiate** hook inside a running workflow |

## The design: code asks, the node proposes, the main agent approves, code enforces

1. **Code asks the question, not the node's whim.** At defined points, code asks each node a typed question: "do you
   need a sub-workflow, a tool, a person, or nothing?" The points are measured signals: the node's input is larger than
   its budget allows (rows, bytes, files), a check failed twice, the items are heterogeneous, or a capability is
   missing. This is the fix for the 6/32 under-asking.
2. **The node proposes a typed sub-plan.** The sub-plan is a small workflow in the same typed IR plus a contract:
   inputs, outputs, an acceptance check, a budget slice, the capabilities it needs, and its depth.
3. **Code checks it first** (free and deterministic):
   - strict validation and the construction lint;
   - its budget fits inside the parent's remaining budget;
   - its capabilities are a subset of the parent's grant;
   - it adds no new outside-effect target;
   - its depth is within the limit, and it creates no cycle.
4. **The main agent judges alignment only.** It returns a typed verdict (approve, reject, or amend) with a reason. A
   cheap model is enough because code has already checked structure, budget and authority. A model may veto; it never
   widens anything.
5. **The person is never interrupted, unless authority would widen.** The person is asked only when a proposal adds a
   capability or an outside effect, a recipient they never named, or more budget than was delegated. Those requests are
   batched into one approval.
6. **Practice before use.** The approved sub-workflow runs its own acceptance in isolation before its result flows
   upward, and the parent's acceptance still checks the outcome.
7. **Approvals become rules.** A proposal with the same shape, approved N times, becomes an audited code rule. Latency
   and cost then fall over time; this is where self-improvement enters, behind the gate (see
   `research/selfimprove-20261104/SELFIMPROVE-DESIGN.md`).
8. **Depth is budget first, number second.** Each level receives a slice of its parent's budget, so depth is naturally
   bounded. A hard cap applies on top: the engine's limit of 6, the person's setting, or a value the meta agent encodes
   per branch.

**The invariant that makes it safe:** authority only narrows. A child's grant is a subset of its parent's grant, and
only a person can widen one. This is capability attenuation, as in object-capability systems and macaroons (Birgisson et
al., NDSS 2014).

## Loops and connections

| Connection | When it helps | Risk | Rule |
|---|---|---|---|
| Vertical: child ↔ parent (ask, escalate, report progress) | Always: the main channel | Parent overload | Typed messages; summarise upward; batch |
| Sibling ↔ sibling | Two parallel parts must agree on an interface (e.g. a data shape) | Endless negotiation | One bounded contract-agreement round, then the contract is frozen |
| Diagonal: a sub-agent in node A ↔ a sub-agent in node B | B needs a fact that only A's sub-agent has | N² chatter, context pollution, lost audit | Do not chat freely. B posts a typed question to a run registry, and code routes it to the owner of that fact ("ask the owner") |
| Shared typed board (publish and subscribe by topic) | Many readers of the same facts | Stale or contradicting entries | Schema'd slots with an owner per slot; earlier measurement: small gain ([75]) |
| Self-loop (refine, critic, retry) | A narrow judgment that improves with feedback | Silent drift; "looks fine" loops | A counter, a budget, and a check that is not the producer |
| Cross-branch verification (B checks A) | Independent checking by construction | Correlated judges | Different model family or a code probe |
| Loop with the world (observe → act → probe) | Effects whose result must be confirmed | Duplicate effects | Idempotency keys; a probe after every effect |
| Loop with the person | Authority, taste, missing facts | Interruptions | Only when authority would widen; batched |
| Loop across runs (lessons, library) | Recurring work | Learning the wrong lesson | Lessons are proposals; only the code gate promotes |

**Rules for every loop:**
- **Declared, never implicit.** A loop or channel exists only if it is declared in the IR: a typed edge with a schema, a
  direction, a message budget, and who may read it. Undeclared connections are impossible. Every message is journaled,
  so runs replay exactly.
- **Bounded.** Every loop has a counter and a budget. Channels have message caps. Code detects cycles. A deadlock goes
  to the parent.
- **Requested like sub-workflows.** A channel added at run time goes through the same propose → check → approve path.

**Ideas worth testing** (inference; none measured here):
- **Speculative siblings with early cancel.** Run two strategies; the first to pass acceptance wins and the other is
  cancelled.
- **Budget allocation by bids.** Sub-tasks bid with cost estimates and the parent allocates budget, like the Contract
  Net Protocol (Smith, 1980).
- **Memoised sub-results.** Shared through the content-addressed blob store, so an identical sub-query runs once per
  run.
- **A scout sub-agent.** It measures the job (inventory, sizes, difficulty) before the others start. This is
  `skills/foundry-construct/references/scale.md`'s recon step, done as a node.
- **Hot-swapping a node's model mid-run.** This already exists as escalation.
- **Lessons across runs.** Kept as cue, lesson and evidence; promoted only by the gate.

**The main failure risk:** multi-agent systems fail mostly through mis-specification and inter-agent misalignment (the
MAST taxonomy, Cemri et al., arXiv 2503.13657). That is why every connection is typed, budgeted and declared, and why
code, not conversation, owns the procedure.

## What to build first

1. **Engine hook ($0).** Add a node-level `propose_sub` request to the run's main agent. It is code-checked as above,
   approved, then instantiated as an inline body (map or loop body semantics) with its budget slice and depth counter.
   Everything is journaled.
2. **Test on SW-1's bed** (`experiments/subworkflow`, stratum P), with these arms:
   - A0: the node alone;
   - A1F: the parent directs;
   - A3 (new): code asks, the node proposes, the main agent approves.

   Seed misaligned proposals to measure the veto rate. **Prediction:** A3 reaches A1F's capability at a lower parent
   cost. **Refuted if** A3 is not better than A0, or if the main agent approves the seeded misaligned proposals more
   than 1 time in 10.
3. **Channels ($0, then a small paid test).** Add a `channels` field to the IR (typed, budgeted) and check it in the
   validator, then test on the swarm bed (W-bed R6), where workers need each other's facts.
