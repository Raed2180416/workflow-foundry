# Foundry inside a host harness: the deployment shape (owner clarification, 2026-10-09)

*Owner, 2026-10-09: Workflow Foundry fits inside another harness (Claude Code, a Codex-like agent). Normal chats and
ordinary agentic coding need nothing; some tasks need micro-harness workflows, which are JIT-constructed when needed,
stored, and reused when a later task needs them. This note records what that fixes in the programme. It is design,
not evidence. THESIS §1 already states the placement ("ARC and AMP are the harness; Foundry is the workflow layer
inside it"; "a workflow constructor, used by agents through MCP"); W-BED.md and FLOW-V3.md are the construction and
primitive designs this note sits on top of.*

## 1. The surface the host sees

Three calls, exposed through MCP (ROADMAP §2.11), and one ingest hook:

| call | question the host asks | what answers it |
|---|---|---|
| `route(task)` | Does this need a micro-harness at all? Is there a stored one that applies? | shape inference from the task and any early trace (W-BED T1); the applicability gate over the library's input profiles and evidence records (THESIS §7 applicability port; FLOW-V3 `checkProfile`). Answers: `none` \| `reuse(hash, p)` \| `construct` |
| `run(hash, input, budget)` | Run the stored workflow under this budget | `call-host` (flow-v3 slice 1): nested compiled run, budget carved, typed return, refusal outside the profile, every event journaled |
| `construct(traces, spec?)` | Build one from the work already done | the compiler (compile.mjs) over traces; acceptance with reject-if-worse; registration in the library with profile and evidence |
| ingest (`SubagentStart/Stop`, `TaskCompleted` hooks; ROADMAP line 735) | — | every ordinary session is a trace; traces are segmented and pooled per task shape |

**Inside a harness the interpreter is the host agent.** The user already paid for that session. Foundry's own
sandboxed interpreter (`interpret.mjs`) is for experiments and for agent nodes (`flow.agent`, W-BED R5), not for
production demonstrations. Construction cost is therefore the compile alone; demonstration traces are a byproduct.

## 2. What this changes in the test programme

1. **The deployment arm is the inverted shape** (FRONTIER-GAPS G5; §3.14 Bet C arm 1; Prime Agent bet 1): *host agent
   with the Foundry library* versus *the same host agent alone*, on the same tasks, over a stream of sessions. The claim
   is cost at verified parity plus a library that improves (fewer compiles, more correct reuse, fewer wrong reuses) as the
   stream proceeds. It joins W-BED §4 as arm **(f)** and is the final claim of the programme; the construction arms
   (a)–(e) say whether Haiku can build the parts, (f) says whether a harness is better off owning them.
2. **The library is the product.** Per project (persisted like skills), keyed by task shape and contract, each entry
   carrying its solver hash, output schema, input profile (the domain it is proven on), evidence record (durability,
   silent-miss rate, shadow record, versions) and version. The per-arm registry in `experiments/jit/call-host.mjs`
   (`createRegistry`) is the prototype; generalising it to a per-project store is a path change, not a design change.
3. **Retrieval is a judgment, and it is where Jev earns or loses its place.** The 0/21 skills result was a false
   applicability judgment. W-BED T7 compares Jev's applicability probability, code profile guards and no gate on
   in-domain and out-of-domain reuse; wrong-reuse rate carries a kill threshold.
4. **Drift-and-heal is the headline** (W-BED R8 overlay; THESIS §6 "diagnosis before repair"). A stored workflow must
   survive schema drift, tool failure and adversarial content without a human, by classifying the fault first and
   recompiling second. The hand-curated graph's weakness is maintenance, not construction.
5. **"Normal chats need nothing" is a measured rung.** W-BED R0 (the no-workflow control) exists so the router's
   willingness to say `none` is scored, as THESIS §6 requires ("the router must be willing to say no workflow often").

## 3. What stays the same

Model ids from `policy/models.json` only; no component sees an oracle; budgets carved and journaled; replay from the
journal; pre-registration before any comparative claim; K ≥ 2 before any decision; negatives kept. No Workflow-tool
fan-outs: a compiled solver's budgeted judge calls inside one run are model calls, not Claude Code subagents (W-BED §11
item 3; this reading is adopted here and flagged for the owner).

## 4. First integration experiment (Phase 7 "ecosystem adapters, as experiments")

Claude Code as the host; Foundry as an MCP server with `route`/`run`/`construct`; ingest via hooks. Tasks: the W-bed
rungs first (exact oracles), then the owner's own recurring tasks. Metrics as W-BED §6 plus: route precision (how
often `none` was right), reuse rates, and the share of decisions made by code or a cheap judge (THESIS-JIT §6 item 6).
Gate before it runs: the inverted arm (f) on records with the frozen C0 solver, ~$6–10, which needs a seed range of its
own or a PREREG amendment to R0 (Prime Agent PRINCIPLES §5).
