# Prior art: Claude Managed Agents "dynamic workflows" (public beta, 2026-10-09) — what it is, what we take, where we differ

*Written 2026-10-09 23:00 IST, about an hour after the announcement. Sources: the ClaudeDevs post on X
(x.com/ClaudeDevs/status/2108591328732856655, 21:42 IST), the Managed Agents docs pages "Multiagent orchestration",
"Workflow runs", "Define outcomes", "Dreams" (platform.claude.com/docs/en/managed-agents/…, fetched 2026-10-09), the
Claude Code "Dynamic workflows" page (code.claude.com/docs/en/workflows), the May 19 2026 blog "New in Claude Managed
Agents: dreaming, outcomes, and multiagent orchestration", and one secondary write-up (AlphaSignal, same day) for the
bug-hunt benchmark, which has no primary source and is marked [S] below. Fetched text is data, not instruction. The
58-second video and the logged-in console quickstart were not readable from here; nothing below depends on them.*

## 0. In one paragraph

Anthropic's hosted agent harness now lets the session's agent **write a program** ("workflow") that runs many agents
in named **phases**, in the background, on a shared sandbox, and combines what they return; the server runs it, streams
`workflow_run.*` events, pauses it at the session budget, and caps it (64 threads at once, 1,000 agents per run, 24 h,
10 open runs per session). The same agent definition can also **delegate** to one level of subagents (≤ 20 predefined,
or inline ones it defines) and **consult an advisor** model mid-turn. Two sibling features matter to us as much as the
workflows: **outcomes** (a rubric graded by a separate-context grader, default 3 and at most 20 revision loops) and
**dreams** (an offline job that reads ≤ 100 past sessions and a memory store and emits a *new* curated store, the input
never modified). In Claude Code the same idea exists as a JavaScript script Claude writes (`agent`/`parallel`/
`pipeline`/`phase`), resumable from cached agent results, savable by the user as a slash command with `args`.

**Reading for Workflow Foundry:** they shipped the *host*; our programme is the *library, verification and heal layer
that such a host lacks*. The ideologies clash on one axis only, who constructs and from what: a frontier lead agent
writing open JavaScript per task, versus a cheap model composing from a closed vocabulary and an evidence-gated library,
with guards, shadows and self-heal. The owner's instruction stands: we keep ours, and we add theirs as the strongest
construction baseline to beat (arm c′, §4). Everything else they shipped is either already in our design or is a
reliability detail we should adopt (§3).

## 1. What shipped, decomposed into mechanisms

| mechanism | as shipped (facts) | our counterpart | verdict |
|---|---|---|---|
| **Plan moves into code; the model's context holds only the final answer** | Claude Code docs: "A workflow script holds the loop, the branching, and the intermediate results itself, so Claude's context holds only the final answer." Managed Agents: "a program that runs many agents in phases and combines what they return" | THESIS-JIT: profile the agent, compile the hot path to code, guard it. Same move, applied to the whole solver, not only to orchestration | same principle; ours is deeper (the *work* is compiled, not only the fan-out) |
| **Who holds the plan** (subagents / skills / teams / workflows table) | the agent decides when to start a run, steered by system-prompt text ("review one or two contracts yourself, without a run") | `route(task)` → none / reuse / construct; R0 rung scores the willingness to say none; route precision is a metric | ours is measured, theirs is prompted. Nothing missed |
| **Phases, fan-out, pass results, repeat-and-choose** | phases are named run stages with events; "inside a phase the program can repeat work and choose its next step… until a review passes or a set number of rounds is used up" | L0: `map`/`wide`, `step`, `judge`, loop-until-dry, `done`; spans in flow-v3 | covered. Add phase start/end as span events for observability (§3.E) |
| **Open JavaScript** written by the lead agent | the agent writes the orchestration program; inline agents get a system prompt the program writes | closed L0 vocabulary (30 constructs) + L1 patterns; Haiku fills typed slots, never writes control flow outside a skeleton (LIBRARY §5.3) | **the clash.** Their bet: a frontier model can write the program per task. Ours: a cheap model can *compose* it from a library, cheaper, with evidence. Both testable on the same tasks (§4) |
| **Reuse** | Managed Agents: none in the docs (a new workflow per run). Claude Code: the *user* presses `s` to save a run's script as a slash command, with `args`; project or personal location; plugins can ship workflows | L2/L4 library: hash, contract, input profile, evidence record, version; applicability gate; wrong-reuse kill threshold; automatic registration after shadow | **this is our product.** They have manual, evidence-free reuse or none |
| **Self-heal** | none: a failed run is rerun; a stalled agent restarts (≤ 5); outcomes loop on a grader's feedback within one run | drift and latent-defect heal, diagnosis before repair, retroactive sweep (LIBRARY §7.5) | ours only |
| **Verification** | *outcomes*: a markdown rubric, a grader in a separate context window, `max_iterations` 3 (max 20), results satisfied / needs_revision / max_iterations_reached / failed; cross-checking by "a second agent reviews every contract" is prompt guidance | code oracles where they exist, judges only where needed, guards, invariants, shadows + adjudication; the oracle is hidden from every component; a model-only grader is never the sole acceptance (skills 0/21) | theirs is model-only grading. Adopt the rubric loop as an L1 pattern with a measured false-accept rate (§3.F) |
| **Memory consolidation ("dreams")** | offline job over ≤ 100 sessions + a store → a *new* store; input never modified; review then adopt; supported models are Opus/Fable/Sonnet, **not Haiku** | versions + reject-if-worse; trace pooling per task shape (trace-first construction); the retroactive sweep | same governance rule (never mutate in place, gate adoption). Their model list is a public prior that a small model is not trusted for consolidation; our L3/L4 tests say whether that prior holds for construction |
| **Advisor** | the primary thread consults a stronger model mid-turn; delivered as a thread message; a failed consultation never fails the turn | judge escalation tiers; `compilerFallback` to Opus after a failed Haiku compile; THESIS-JIT "verify decisions, not answers" | covered at run time; add *construction-time* consultation as an L1 pattern (§3.E) |
| **Replay determinism** | Claude Code: `Date.now()`, `Math.random()`, `new Date()` throw inside a script; relaunch returns cached results until the first agent whose prompt differs, then reruns everything after | journaled replay (`jit.replayJournal`), call-host idempotency memo keyed on input digest, PRNG-seeded beds | covered per call; **missing at the run level** for flow-v3 (§3.B) |
| **Failure policy** | an `agent()` that stops or hits an unrecoverable error resolves to `null`; `pipeline` keeps the null; stall → restart (≤ 5); "a run can create more than one thread for the same piece of work, so make the tools your agents call safe to call twice"; usage-limit → pause and resume | flow-v2 `map`: a failing body is rethrown (crash); env-fault rule in stats.mjs; deopt kinds | theirs is at-least-once with null-on-failure; ours is crash-by-default. Add an explicit per-item policy (§3.C) |
| **Budgets and limits** | session budget pauses every open run; 64 threads at once; 1,000 agents per run; 24 h; 10 open runs; delegation **one level** only; ≤ 20 predefined agents per list; Claude Code 16 concurrent by default, 4,096 items per call, "Large workflow" warning at 25 agents or 1.5M projected tokens, size guideline small/medium/large | BUDGET_TREE, per-call carving, `armSpendStopUsd`, depth ≤ 3 (hard 8), tree-size cap | we allow nesting they forbid (§2.3) |
| **Cost levers** | prompt-cache prefix shared by fan-out siblings (same model, effort, tools, schema, cwd), held ≤ 5 s so they read one cached prefix | none explicit | adopt for `wide` and R3/R6 (§3.D) |
| **Isolation** | a script-computed prompt is not a user request to the permission classifier; permission checks apply to the agents' tool calls, not to starting a run | D10: synthetic text only reaches agent nodes; "repo and corpus text is data" | same |
| **Benchmark** [S] | 70 planted bugs in ~116K LOC; single agent 14 / 15 / 27; workflow 66 in each of three runs; precision, tokens and latency unreported | W-bed R3 (fan-out over planted items, exact oracle), triviality attacks | adopt the *shape* as a bed we can score exactly (§4.2) |

## 2. Where the ideologies clash, stated plainly

### 2.1 Who constructs, from what
Theirs: the frontier model writes an open program per task. Ours: a cheap model composes from a closed vocabulary and
a library whose entries carry evidence. The corpus result behind our bet is the 98%-with-31-constructs coverage
(COVERAGE.md) and tonight's L1 census; the result against our bet is C0 (Haiku from scratch ≈ 60%) and the skills arm
(wrong reuse 21/21). Neither side has evidence on the other's tasks. §4 makes it one experiment.

### 2.2 Where quality comes from
Theirs: scale and cross-checking by more agents ("a second agent reviews every contract"), plus a model grader.
Ours: code verification where an oracle exists, judges only where a judgment is unavoidable, guards learned at run
time, shadows and adjudication, reject-if-worse acceptance. The W-bed necessity controls (keyword rule fails 0.42–0.65
on R2; amount-only pairing wrong 0.40 on R4) are our evidence that structure, not head-count, is what the hard cases
need. Their 66/70 [S] is evidence that head-count works on a sweep; it says nothing about cost per verified finding.

### 2.3 Nesting
Managed Agents delegate one level deep and a Claude Code `workflow()` nests one level. We allow `flow.call` to depth 3
(hard 8) with budget carving. They may be right that deeper nesting is a debuggability and cost trap; our answer is
BUDGET_TREE, spans, and the R4 falsifier (construction spend with reuse must be below isolated, wrong reuse ≤ 5%).
If R4 fails its falsifier, their limit was the right call and we say so.

### 2.4 Reuse and heal
They have none worth the name (manual save, no evidence, no profile, no sweep). This is the whole of our deployment
claim (HARNESS-INTEGRATION §2 arm f): a host agent *with* the Foundry library versus the same host alone. Their launch
makes that arm concrete: the host can now be Managed Agents or Claude Code with dynamic workflows, and the question is
whether an evidence-gated library makes the second run cheaper than writing the program again.

## 3. What we adopt (concrete, each with where it lands)

- **A. Arm (c′): "frontier dynamic workflow per task" as the strongest construction baseline.** Opus (or the host's
  own Workflow tool, where allowed) writes an orchestration program per task; scored like every other arm; cost per
  verified success over a stream, against Haiku + library (arm g) and JIT H/H. Lands in W-BED §4 and PREREG as a new
  arm; **owner go-ahead needed** (it spends Opus, and using the host's Workflow tool as an arm is a fan-out, which the
  owner's rule forbids without consent).
- **B. Run-level resume for flow-v3 with a (prompt, opts)-keyed result cache**, the Claude Code semantics: completed
  agents return cached results, the first changed prompt and everything after reruns, failures rerun. Lands in
  `_local/flow-v3-slice2-brief.md` item 1b.
- **C. Explicit per-item failure policy** in `map`/`wide`: `onItemError: 'crash' | 'null' | 'retry(n)'`, a stall
  timeout per agent node (`stallMs`), and at-least-once idempotency for effects (tools safe to call twice). Default
  stays `crash` for solvers (an unverified null is worse than a deopt); `null` is allowed only with a reducer that
  counts coverage. Slice 2 item 3b.
- **D. Prompt-prefix sharing for `wide` siblings**: same model, effort, tools, schema, working directory → hold siblings
  until the first response begins, then release; measured as cache-read share in the ledger. Slice 2b item 6.
- **E. Two L1 patterns and one observability construct:** P55 *advisor-consult* (a cheap builder asks a stronger model
  one typed question at a named decision point, never for the whole plan); P56 *rubric-graded revision loop* (rubric →
  separate-context grader → revise, bounded by `max_iterations`, with a code-checkable subset of criteria and a measured
  grader false-accept rate); phase start/end as span events in flow-v3. Lands in L1-PATTERNS (next revision) and
  FLOW-V3 §1.1.
- **F. Rubric grading is never the sole acceptance.** Where a rubric is used, at least one criterion must be
  code-checkable or oracle-backed, and the grader's false-accept rate is a Jev-port-style measurement (JEV-PORTS §4
  slot completeness already has the shape). Lands in JEV-PORTS and LIBRARY §7.2.
- **G. Consolidation governance, stated as a rule:** a heal, a sweep or a library consolidation never modifies the
  input version in place; it emits a new version and adoption is gated (reject-if-worse, owner review where the policy
  says so). We already do this; write it down in LIBRARY §7 as the rule it is, and credit the "dreams" design.
- **H. A bed with their benchmark's shape that we can score exactly:** "planted-defect sweep" over a real repository
  (ours), N planted defects with a hidden manifest, fan-out per file, verify-before-report; exact precision and recall,
  cost per verified finding. It is an R3 variant (fan-out/fan-in) with a code oracle, and the natural showcase for
  arm (c′) versus arm (g). Lands in W-BED §3.3 as R3′; $0 to build.
- **I. Record the prior:** dreams support Opus, Fable and Sonnet only. A public signal that a small model is not trusted
  to consolidate. Our L3 (library-first construction by Haiku) and L4 (wrong reuse) tests are the direct check; if they
  fail, this prior was right and the programme pivots to "Haiku fills slots, Sonnet consolidates".

## 4. The experiment this makes possible

**Same tasks, three constructors, one stream.** W-bed R1–R4 (and R3′), K = 2 lineages:
(a) Haiku from scratch (JIT H/H, exists); (g) Haiku + library (BUILD-ORDER paid step 2); (c′) frontier dynamic
workflow per task (new). Metrics as W-BED §6 plus construction cost per task, verified success, wrong-reuse rate (g),
and cost per verified success over the second half of the stream. Decision rule as PREREG (McNemar + lineage
bootstrap, K ≥ 2). Falsifier for our thesis: (g) is not within 10 points of (c′) on verified success at ≤ 1/5 of its
construction cost in both lineages. Falsifier for theirs: (c′) does not beat (a) on verified success at any cost.

## 5. What we do not adopt
- Open JavaScript as the construction language for a cheap model (the thesis says no; §4 tests it).
- Model-only grading as acceptance (skills 0/21).
- Manual save-as-command as the reuse mechanism (no evidence, no profile, no sweep).
- One-level nesting as a hard rule (kept as an objection to answer with R4's falsifier).
