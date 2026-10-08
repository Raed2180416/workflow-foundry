# Workflow Foundry: thesis

*Status: proposed 2026-10-06. Grounded in the eleven research reports in
[`research/landscape-20261006/`](../research/landscape-20261006/) (R01–R11 below).
Read this before [ROADMAP.md](ROADMAP.md), which turns it into a buildable plan.*

*Amended 2026-10-08 (design review): T-1 and T-2 (§1), T-3 (§2), T-4 and T-5 (§4), T-6 (§10),
as proposed in
[`research/review-20261007/ROADMAP-AMENDMENTS.md`](../research/review-20261007/ROADMAP-AMENDMENTS.md).
They apply the default owner decisions of
[`00-SYNTHESIS.md`](../research/review-20261007/00-SYNTHESIS.md) §6, with two exceptions
recorded in §10: the Kev row (D13) records the decision taken instead of the default pause, and
the usage rule (D14) is a proposal awaiting the owner, not adopted, because the owner chose
"Full speed".*

## 1. The answer in one paragraph

Foundry gives agents the ability to **construct small, bounded, typed workflows for a
specific task**, then run them durably, adapt them while they run, judge them against
contracts the workflow cannot game, and **keep only the few that earn reuse**. Code owns
procedure and models make narrow judgments, so these workflows let **cheap models (Haiku
5.5 today; open-weight models once a GPU route exists) do work that today needs a frontier
agent**, and they make agent work inspectable and repairable. The goal is the best possible
workflow for any task; for many tasks the best workflow is none, one call or one agent, and
the need router says so. **ARC and AMP are the harness. Foundry is the workflow layer
inside it.** It is not a giant meta-harness to evolve, a general agent loop, or a
LangGraph/n8n competitor.

**The owner's ambition (2026-10-07), in his words.** "a mini harness … something that can
allow us to build focussed systems to execute tasks", able to "represent any and all
workflows independent of a harness", with "the best possibel workflow for any tas" as "the
ultimate goal". A cheap model constructs, edits and runs the workflows from templates; Kev
makes quick semantic calls, including whether a task needs a workflow at all; workflows
nest, iterate, run in parallel or as swarms, and stay efficient and auditable. His sentence
"it becomes essentially …" is unfinished and is left open here until he completes it.

## 2. Terms

| Term | Meaning here |
|---|---|
| **Workflow** (micro harness) | A typed multi-node program built for one task or task family. It has nodes, edges, contracts, budgets and a model assignment. It is disposable by default. |
| **Harness** | The surrounding system that gives authority, durability, memory and context: **ARC + AMP**. Foundry does not try to be this. |
| **Node** | One step of a workflow: deterministic code, a narrow model judgment, a tool or effect call, a verifier, an async primitive, or a delegated executor. |
| **Executor** | A full external agent (Claude Code, Codex, OpenCode, a local loop) used as one node, or as the fallback for open-ended work. It is measured, not rebuilt. |
| **Typed judgment** | A bounded decision with a probability attached: yes/no, choose one of N, or an ordered score. Jev is the default engine. |
| **ARC** | The owner's agent runtime substrate (`~/.agentic-os`). It is unrelated to **ARC-AGI-3**, the ARC Prize benchmark. |
| **AMP** | The owner's memory and context authority, also called Hippocampus. It is not Sourcegraph Amp. |
| **Coverage** | How much of a corpus of real workflows the IR represents. *Declared*: the constructs exist. *Compiled*: the item lowers to valid IR under the production label policy. *Executed*: it reproduces the original on fixtures (measured only on items with an oracle). Every item is represented exactly or rejected with a named reason. |
| **Need router** | The selection step that decides whether a task needs a workflow at all, and how much: direct call, agent, reuse, template, construct, or construct+ (multi-stage). Hard requirements force structure; otherwise expected value decides. |
| **Slider** | The owner's setting for "how much is a correct result worth?", from cost first to reliability first. Underneath it is the dollar value of one verified success. |
| **Run board** | A run-scoped set of typed topics with reducers and declared writers and readers, read at a fixed sequence number. Not chat, and not memory across runs. |
| **Wild ladder** | Evaluation rungs that Claude did not write or tune on: sealed families, replication of real hand-built workflows (R-bench), external benchmarks, owner-written tasks, the owner's real recurring tasks. |

## 3. The state of the world (October 2026), and the problem left over

1. **Writing orchestration is commoditized.** The labs already let agents write and run
   dynamic workflows:
   - Claude Code dynamic workflows and Agent Skills;
   - Managed Agents with outcomes and budgets;
   - Codex `/goal` and subagents;
   - Google ADK 2.0 graphs;
   - Microsoft Agent Framework.

   OpenAI is even shutting down its visual Agent Builder on 2026-11-30. Making authoring
   more dynamic is not where the value is (R02).
2. **Generic scaffolding adds little on frontier models. Reliability and cost are what
   remain.**
   - Generic harness lift for frontier models is now about 2–5 points on coding.
   - Each vendor's own co-trained harness wins on its own model.
   - On Terminal-Bench 4.0, pass@5 − pass@1 is **12–27 points**, so the gap is about
     reliability.
   - Equal-accuracy entries differ **~5× in cost**.

   (R03, R05)
3. **Adapting the harness for each task while it runs works. Evolving one global harness
   doesn't.**
   - On ARC-AGI-3 (benchmark), agents that wrote tools, skills and hooks *during play*
     went **43 → 77.5** at matched budget.
   - Evolving one harness across a dataset gave **+1.2 / 0 / −1.4** on held-out tasks,
     and plain parallel sampling with a verifier beat it.

   (R03: 2607.12227)
4. **Cheap models fail at chaining, branching and long horizons, and succeed when code
   owns control.**
   - The best open model in AgentFloor matched GPT-5 on single calls but scored **0%** on
     long-horizon constrained planning.
   - Harnesses that move control into code lift small models dramatically: 9B goes
     19 → 45 on Aider Polyglot, and a 4B agent goes 6.7 → ~45 on WebArena-Verified at a
     fraction of the cost.
   - Small models collapse when asked to modify themselves (44 → 14).

   (R03, R09)
5. **Trust is unsolved.**
   - Self-improving loops game their graders: DGM disabled its detector in 2 edits, and
     HarnessX pasted answers into prompts.
   - About **55%** of rejected self-edits broke something that used to work.
   - Free-running agents that read untrusted data can be steered by it.

   (R03, R04)
6. **The owner's thesis is this exact gap.** ARC's README states the goal as
   frontier-class outcomes from a small local model through *"harness brilliance (not
   bigger weights)"*. The surrounding docs say: *"the substrate determines what is
   admissible; the model proposes; Jev ranks/chooses within the admissible; code commits;
   the witness verifies"* (R06). Foundry is where that becomes concrete, task by task.

## 4. What Foundry is, and is not

**Is:**
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
- a **typed judgment layer**;
- a **verdict and repair system**;
- a **selective library** that keeps only workflows that have earned reuse.

**Is not:**
- a global harness to evolve;
- a general agent loop (use the vendors');
- a visual builder or connector catalog;
- a memory store (that is AMP). Cross-run application state (a cursor, a dedupe set, a chat
  session) is a typed state capability behind the ContextPort; cross-run lessons become a
  replay-proven workflow version or an AMP claim;
- a provider/model gateway. (A minimal host-side egress proxy for executor model calls, with
  no routing and no provider choice, is a security boundary, not a gateway.)
- a second authority, lifecycle or completion system (that is ARC);
- a LangGraph, n8n or Temporal replacement.

**Lifecycle.** Every workflow lives somewhere on this path:

| Stage | What happens |
|---|---|
| Ad hoc | Constructed for a one-off task and deleted afterwards unless it earns more. |
| Adapt | It restructures itself mid-run within budget: a strategy switch, a bounded expansion, escalation, or delegation to an executor. Every change is recorded. |
| Crystallize | Similar tasks recur, so a parameterized version is distilled from verified runs. It carries hard and judged preconditions, a contract and a model assignment. |
| Reuse | Selection matches new tasks to kept workflows, usually on cheaper models. |
| Heal | A failure is classified first. Only real workflow defects are patched, and patches are proven by replay before promotion. |
| Retire | Stale, unused or out-competed workflows are deleted. |

## 5. Design principles

Each principle is a bet backed by evidence, not a preference.

| # | Principle | Why |
|---|---|---|
| P1 | **Code owns procedure, models own judgment.** Chaining, branching, termination, bookkeeping and constraint tracking live in the runtime. Each model call is a single, tier-A decision. | Small-model failure modes (R09 §C3); control-in-code lift (R03 §3.4) |
| P2 | **Every judgment is narrow, typed and checked.** Constrained decoding, per-node checks, deterministic checks first, and models as high-recall filters, not final judges. | Constrained decoding gives 100% schema validity (R09 §C2); one reference frame lifts an 8B VLM to GPT-5's F1 (R08 §2) |
| P3 | **Construction is grounded.** The builder probes the real environment and executes before trusting anything. | Self-authored skills from priors add ~0 (SkillsBench, R01); grounded, execution-gated skills work (R01 §1.6) |
| P4 | **Evidence before reuse.** Verify before storing, from a reset environment, with an independent oracle; compare with and without on the same instances; set a risk-bounded admission threshold. | Verify-before-store was PreAct's dominant mechanism; the selector did not matter (R01) |
| P5 | **Disposable by default; reuse must pay.** | The utility problem: libraries slow systems down, and on diverse work reuse rarely triggers (R01 §1.5). Big savings come only where whole tasks genuinely recur (R01 §1.7). |
| P6 | **Adapt per task at run time. Never evolve one global workflow.** | R03 §0.1–0.2 |
| P7 | **Graders are locked. Adaptations are proposals. Every promotion replays the failures plus a regression slice.** | Objective hacking and collateral breakage (R03 §2.4, R04 §3) |
| P8 | **Private context by default.** Share decisions and artifacts, never transcripts. One writer per artifact. Verifiers get a clean context. Nothing implicit. | Anthropic, Cognition and Restate converge on this; context rot hits small models hardest (R09 §A) |
| P9 | **Control flow is fixed before untrusted data is read, and data carries labels.** | CaMeL/FIDES-style structural injection resistance (R04 §2.4) |
| P10 | **Executors are interchangeable.** Measure them, choose between them and keep evidence on them; don't rebuild them. | The labs co-train their own loops (R02 §e) |
| P11 | **Proportional assurance.** Ceremony only where it protects users or evidence. Every milestone must produce a capability number against a simple baseline. | AMP's own rule: *"a system that passes guards while ordinary agents cannot accomplish work fails acceptance"* (R06 §3) |

## 6. Is it valuable, and is it new?

**Already claimed (don't pitch these as new):**
- **Compiling traces into deterministic procedures with guards and fallback.** PreAct
  (GUI), GAC (tool workflows), Microsoft's Progressive Crystallization (production IT
  ops, >70% cost reduction), Skyvern (web), etchplan (built from Claude Code, Codex and
  opencode traces), and the ICML 2026 paper "Agent JIT Compilation" all do this. The
  "agent JIT" vocabulary is taken, and the idea goes back to STRIPS/PLANEX (1972) and
  Soar chunking (R01).
- **Agents writing dynamic workflows:** Claude Code workflows (R02).
- **Procedural memory as text and skills:** AWM, Memp, ReasoningBank, Agent Skills, Letta
  (R01).
- **Searching for global harnesses:** Meta-Harness, AHE, DarwinX, HarnessX (R03).
- **Routing between models:** RouteLLM, GPT-5's router, OpenRouter (R04).

**Unclaimed, as far as these searches found, and where Foundry should compete:**
1. **Agentic workflows built for each task, typed and statically checked.** The workflows
   keep model, search and verify nodes, which suits exploratory and judgment-heavy work
   such as testing, debugging and game loops. These are exactly the cases trace compilers
   refuse to touch (R01 §3; R02 W3).
2. **Diagnosis before repair.** Classify each failure, as a flake, model variance, a
   workflow defect, an environment change or an impossible task, before trying a fix.
   Confirm the cause by replaying with one input changed. Use explicit verdicts:
   `finding`, `inconclusive`, `harness_fault`, `env_fault`, `uncertain`. Promote a repair
   only after replaying the regression slice. Each competitor has one piece; none combine
   them (R01 §3, R02 W4, R08 §6).
3. **Procedure distillation.** A frontier model writes the workflow, then a search finds
   the cheapest model that qualifies for each node, with escalation rules. This is the
   owner's small-model thesis made measurable (R09 §C5; LATM/AgentDistill precedent in
   R01).
4. **Performance records and outcome-based selection across vendors.** Selection chooses
   between workflow versions and executors (Claude Code, Codex, local) using *your*
   outcomes, with logged propensities and off-policy evaluation. No lab will route work to
   a rival (R02 W1–W2, R04).
5. **A typed judgment layer with a calibration loop labelled by oracles.**
   - Jev answers applicability, drift, choice and failure-class questions with
     probabilities.
   - Every judgment is later labelled by execution oracles and replay.
   - Those labels measure calibration and can train a fine-tuned judge.
   - No orchestration system treats judgments as typed, calibrated and auditable (see §7).
6. **Evidence semantics as a portable package.** Each piece of evidence carries an
   independence label, construction is qualified separately from outcome, graders are
   locked, and a user-owned, vendor-neutral audit ledger records it all (R02 W5–W7).
7. **Checked composition of many workflows**, using call-by-hash and budget and effect
   algebra, plus a rule of one writer per resource (R01 §3, R02 d.17).

**Rivals to track and beat:**
- **Closest:** HarnessX (typed processors and per-task variant routing, but global and
  in-distribution), etchplan, SIGIL (typed IR compiled from prose skills), PreAct and
  Progressive Crystallization.
- **Platform baselines:** Claude Code workflows with plugin eval, and Managed Agents
  outcomes.

**Risks, from the red team (R07), and the answers:**
- **The labs absorb it.** Resume, outcome gates and per-vendor routing will likely land
  inside 12 months (R02 §c). *Answer:* compete on what they won't build: cross-vendor
  selection on private outcomes, user-owned evidence, cheap-model execution, and
  independence semantics.
- **Brittleness and false reuse.** The repo's own ledger has a skills arm at 0/21 with 21
  false successes. *Answer:* typed applicability gates, verify-before-store, and
  wrong-reuse rate as a headline metric with a kill threshold.
- **Measurement cost and power.** *Answer:* tiered beds with power tables. Measure cost at
  verified parity, and success-rate lift only where it is affordable (ROADMAP §5).
- **Solo bandwidth on three unproven substrates.** *Answer:* standalone runtime,
  contract-level integration, capability-first ordering (§8).

**Verdict.** The vision is valuable if it is pursued as **reliability, cheap-model
execution and trustworthy evidence for task-scoped agentic workflows**. It is not a new
orchestration paradigm and should not be pitched as one. The assets that last are the
contracts and verdict semantics, the calibration and outcome data, the evaluation
discipline, and the procedures distilled from the owner's own work.

## 7. Typed judgments and Jev

The repo's sharpest failure was a judgment failure: "does this procedure apply to this
task?" answered with false confidence (0/21, all false successes). Free-text LLM judges
are weak at exactly this. Jev answers typed questions (noul, choice, score) with
probabilities in one call. **Judgment ports** (ROADMAP §2.4):

| Port | Question | Who consumes it |
|---|---|---|
| Applicability | Does this task satisfy workflow W's semantic preconditions? | selection; abstain or hand off to an executor when the probability is low |
| Drift / expectation | Is the observed state what step k expects? | adaptation ladder, level 2 |
| Choice | Which candidate workflow, strategy or executor? | selection. The distribution *is* the logged propensity. |
| Failure class | flake / variance / defect / env / impossible / finding | healer. Orders the interventions; replay confirms. |
| Verifier | ordered score against the contract | `verify` nodes, labelled `different-model` |
| Quarantined read | a bool or enum about untrusted content | security. Low-capacity outputs cannot carry injected instructions. |
| Context selection | which shared items this node needs | context compiler (AMP already uses Jev this way) |

**Rules.**
- **Jev ranks and gates. It never holds authority.** Oracles, replay and ARC decide.
- **Every judgment is logged with its later verified outcome.** That produces calibration
  curves per port, and a labelled dataset for a **fine-tuned Foundry judge**, which is a
  concrete, narrow form of the Neural Core's "learned faculty".
- **Jev must beat simple baselines per port before it gates anything.** The baselines are
  code guards and embedding thresholds. AMP's Jev arms have not yet shown lift (R06 §4),
  so Foundry is where this gets proven or disproven.

## 8. Place in the ecosystem, and the integration question

**Division of labour** (the owner's own phrasing, R06 §1, made precise):

| Component | Owns | Foundry's relation |
|---|---|---|
| **ARC** | protected intent, capability grants, effects (`runEffect`), lifecycle, completion | Foundry requests effects through an EffectPort and never declares completion. Its outputs carry `grantsActionAuthority:false` and `establishesCompletion:false`. |
| **AMP** | canonical memory: admission, currentness, retrieval, contradiction. Also the turn-time **context compiler** with receipts. | Foundry's per-node context compiler implements a **ContextPort shaped like `compile_context`**. AMP Patterns are keyed by workflow hash, with the I35 fields; Foundry's ranking is only a prior. |
| **Jev** | typed bounded judgments | Foundry's judgment ports go through the shared typed-evaluation boundary, not a parallel controller (AMP PC:1000-1010). |
| **Neural Core** | future learned construction and judgment | It trains on Foundry's versioned decision and trace logs, which carry credit labels. |
| **Foundry** | how to do *this* task: workflow artifacts, run records, verdicts, model assignments | — |

**Procedural memory split (decision D3, recommended):**
- Foundry owns the immutable workflow artifacts and raw run records, as operational state.
- AMP owns the *claims* about them: which pattern, its applicability, its falsifier, its
  outcomes.
- Without this split there would be two canonical procedural stores, breaking AMP's
  HP-AUTH-01.

**Should Foundry be built standalone first, or against ARC and AMP from day 1?**
**Standalone at runtime, integrated at the contract level from day 1.**

**Why not fully integrated now:**
- ARC's effect transaction is not installed (its P0).
- AMP has 0/72 obligations accepted, and a context compile takes 2.6–19 s.
- Coupling would make Foundry's experiments impossible to attribute.
- The cloud session cannot reach either system.
- The owner's own pattern is to extract an organ, make it standalone, then reconnect it
  through one port (R06 §1, §6).

**Why not ignore them until later:**
- Joins: AMP only accepts exact identity joins, so runs without shared identities can
  never count as learning or transfer evidence.
- Migration: a standalone library would become a second procedural store that loses its
  standing on import.
- Drift: workflow formats and authority vocabularies would diverge.
- Training data: Neural Core needs credit-labelled logs from the start.

(R06 §6)

**Contracts to fix now** (expensive to retrofit):
1. An **identity envelope** on every workflow, run, outcome and decision. It carries
   Foundry hashes, plus optional ARC TaskId/TaskSpec digest/event cursor and AMP
   project/capsule/goal/attempt/context-receipt ids.
2. An **outcome and authority vocabulary** mapped to ARC's
   supported/refuted/unresolved/in-doubt states and AMP's verification states.
3. The **procedural split** above, recorded as a decision.
4. An **effect and oracle port** that Foundry native, ARC `runEffect` and AMP's witness
   can all implement, with independence labels and five-cell oracle controls.
5. A **versioned decision and trace schema** carrying public rationale only, credit
   labels, untrusted-span provenance and propensities. It doubles as the Neural Core data
   spec.
6. A shared **glossary**, covering "foundry", "pattern" and "ARC" vs "ARC-AGI-3". Record
   D3/D4 in ARC and AMP canon too: today neither one mentions Foundry.

**Integration is an experiment, not a dependency.** Once Foundry shows lift on its own,
run two A/Bs:
- Does AMP context improve construction and selection?
- What does ARC authority cost in latency and utility?

Foundry is the cleanest place to give AMP its first measurable lift.

## 9. Lessons from the sibling projects

These failure patterns recur across ARC, AMP, Neural Core and the Foundry repo itself
(R06 §5):
- Proof plumbing has displaced usefulness.
- The researcher supplies the hard decision.
- No learned layer has yet beaten a simple, host-side baseline.
- The effect "last mile" is unfinished everywhere.
- Scope keeps growing.

**Countermeasures:**
- Every phase in the roadmap ends with a capability number against a simple baseline.
- Assurance is proportional (P11).
- The hardest decision, what success means, is made part of the system: construction
  includes contract identification, with known-good and known-bad controls.
- One recurring finding should be kept: **host-side contracts carry the gain**. Foundry's
  best validated result, ARC's oracle law and AMP's witness all point the same way. The
  contract layer is the shared asset.

## 10. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | Budget envelope and model mix (frontier + open-weight) per phase | Approve Tier A (~$1–3K) now; Tier B after its gate (ROADMAP §5) |
| D2 | Engine migration vs strict `ENGINE_DRIFT` | Keep strict; allow migration only when replay proves equivalence |
| D3 | Procedural split (§8) | Approve as written |
| D4 | ARC integration branch; AMP connector profile (`foundry` vs `arc`) | Defer until a Phase 7 A/B |
| D5 | Container image pulls and local model downloads in the cloud and locally | Allow, within a disk/size cap |
| D6 | Delete the LangGraph/n8n export adapters (serial subsets, no role in the vision) | **Decided 2026-10-06: deleted** (owner delegated the call); git history keeps them |
| D7 | Jev access for the cloud session (API key via env), and permission to fine-tune a judge | Provision; fine-tuning after Phase 4 data exists |
| D8 | Coverage goal: ~100% of real workflows, exact or rejected with a named reason; headline = compiled + executed (executed ÷ oracle-eligible) on a fresh held-out sample after the IR freeze; declared reported alongside; agent frameworks included | Approve (default; applied 2026-10-08) |
| D9 | Model roles: Haiku 5.5 runs, constructs from templates and edits by replay-proven proposals; Opus writes the library, builds `construct+` and takes escalations; local generative models parked; Kev is the candidate local judge, kept per port only where it beats Haiku 5.5 and rules | Approve (default; applied 2026-10-08) |
| D10 | Executor model access through a host-side egress proxy, which likely needs an owner-provisioned API key | Default **no** (owner rule against new authentication; applied 2026-10-08): no executor reads third-party text; R-bench uses the in-runtime structured builder |
| D11 | No mutable cross-run store in Foundry (amends ROADMAP §2.2 and the §3 wording) | Approve (default; applied 2026-10-08) |
| D12 | Keep building toward ~100% representation even if new constructs don't help a cheap builder | Yes, at lower priority than the wild ladder (default; applied 2026-10-08) |
| D13 | Kev while Haiku 5.5 answers typed calls in about 1–1.5 s for under $0.001 (ROADMAP §2.4) | **Recorded 2026-10-08, instead of the default pause:** Kev dataset building continues; laptop training waits for the Kev-vs-Haiku-5.5 comparison; the hosted spend approval (up to $450) is held, not spent, until then |
| D14 | Usage rule: ≤ 4 concurrent agents (≤ 2 for review or orchestration fan-out); under a 7-day warning only in-flight pre-registered runs; heavy runs after resets; weekly allowance budgets | **Proposal awaiting the owner; not adopted.** The owner chose "Full speed", and this rule would override that choice, so it applies only if he adopts it (ROADMAP §6) |
| D15 | R-bench enablers: builders may read third-party task text under provenance taint with no effects, no egress and mocks (ROADMAP §2.9); R-bench oracles up to 60 s per scenario and a runner shim | Approve (default; applied 2026-10-08) |
| D16 | Phases interleave in a dated plan instead of running 1→6 in order | Approve (default; applied 2026-10-08) |

D8–D16 are the design review's decisions 2–7, 13, 14 and 15
([`00-SYNTHESIS.md`](../research/review-20261007/00-SYNTHESIS.md) §6), in that order. Its
operational decisions (finishing the ambition sentence, closing C0 dev, the owner's own tasks,
the Haiku 4.5 stress arm, recurring tasks, Rust) are in README's decisions table.

## Sources

- R01 [Novelty: procedural memory and trace compilation](../research/landscape-20261006/01-novelty-procedural-memory-and-trace-compilation.md)
- R02 [Orchestration products and protocols](../research/landscape-20261006/02-orchestration-products-and-protocols.md)
- R03 [Harness search, self-improvement, harness lift](../research/landscape-20261006/03-harness-search-and-self-improvement.md)
- R04 [Routing, allocation, verification, security](../research/landscape-20261006/04-routing-allocation-verification-security.md)
- R05 [Verification beds and task families](../research/landscape-20261006/05-verification-beds-and-task-families.md)
- R06 [Owner ecosystem: ARC, AMP, Neural Core](../research/landscape-20261006/06-owner-ecosystem-thesis-arc-amp-neural-core.md)
- R07 [Red team](../research/landscape-20261006/07-red-team.md)
- R08 [Worked example: AI game QA](../research/landscape-20261006/08-worked-example-ai-game-qa.md)
- R09 [Context contracts, async semantics, cheap models](../research/landscape-20261006/09-context-async-cheap-models.md)
- R10 [ARC interface map](../research/landscape-20261006/10-arc-interface-map.md), R11 [AMP interface map](../research/landscape-20261006/11-amp-interface-map.md)

Every claim in R01–R09 carries a URL and a verified/recalled tag. arXiv IDs from 2026 that
are cited here were fetched by the research agents on 2026-10-06. Re-verify any number
before publishing it.
