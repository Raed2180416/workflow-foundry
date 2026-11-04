# Memory model: what is shared, what is kept private, and how we will know it works

**Requirement.** Coverage row D4 ([REQUIREMENTS-COVERAGE-20261021.md](../REQUIREMENTS-COVERAGE-20261021.md)). The owner asked [70]:
"deeply explore how memory is shared, what memory is kept to itself ... do deep research as of today", and "we need to draw a
very fine line between necessary complication and unnecessary complication". Earlier he asked [20]: "a shared message board,
with shared understanding of state, some private notes? ... auditability and efficiency is a huge huge part"
(`research/requirements-20261021/OWNER-MESSAGES.md:463`, `:196`).

**Status: revision 2, after the design review.** Design, a $0 run-board prototype and $0 mechanism measurements. **This is
development and diagnostic evidence only. There is no capability number yet.** D4 stands at "B: built at $0, no capability
number". The two measurements are:
- MEM-0b, rebuilt: attack resistance, honest-operation costs and replay, for five designs, Foundry today (E0) among them;
- MEM-0c: what a peer read costs, against a pool of shared transcripts and against plain edges.

The capability experiment (MEM-1, §7) is designed but not frozen and not run. Revision 1 (commit `8a42d7a5`) was reviewed.
§9 applies or answers every blocker and major finding, and revision 1's battery numbers are superseded (§6.4).

**When and where.** Written 2026-11-04 in worktree branch `worktree-wf_0f86d12b-ab5-6`, which is based on
`claude/intelligent-hamilton-vg1f9a` at `a25087e4`. Cost: $0, no model calls. Web research used WebSearch, WebFetch and Exa.
No credential file was read. Nothing under `beds/sealed/` and no AutomationBench devCheck or test task was read. The gameqa
tasks used (host-side only) are dev-split seeds 2001–2090, outside every range of `research/jit-20261008/SEED-LEDGER.json`
that covers gameqa.

**Tags.**
- **[P]** A primary page I read today (2026-11-04). The URL and date are in Appendix A.
- **[S]** A search-engine or secondary summary that I did not check against the primary source.
- **[V]** Checked in this repository at the cited path and line.
- **[M]** Measured here at $0. The command is in §5.
- **[I]** My inference or design decision.
- **[arith]** Arithmetic, with its assumptions stated.

---

## 0. The answer in one page

**The principle [I].** Memory travels with authority and evidence, not with convenience. The 2026-10-15 design
(`research/architecture-20261014/MEMORY-ROUTING-RECURSION.md` §3.2, lines 290–358) gave the first half of this rule. The other
half comes from this year's literature, and it is the main finding of the research:

> Shared agent memory is a governed distributed-systems problem, not a retrieval problem.

Every 2026 system that measured shared memory converged on the same machinery: typed and validated writes, declared writers,
provenance on every item, snapshot or versioned reads, invalidation instead of deletion, and labels that the kernel assigns and
the data never sets (PatchBoard [P], Governed Shared Memory [P], Letta's git-backed MemFS [P/S], Claude Code agent teams [P],
Zep's bi-temporal facts [S], FIDES [P]). Foundry already owns most of it: append-only hash-chained events, compare-and-swap,
one-writer slots, integrity labels, context receipts and replay.

**What is adopted now.** Only what Foundry already does, written down as the rule. It costs $0 and changes no runtime code.
1. **Private by default.** A node's transcript, scratch notes, tool outputs and workdir stay in the node. They leave only as its
   typed output, or as a full copy for a repair or escalation of that same node. Agent nodes are single typed calls
   (`history: "none"`), and executor sessions run with an empty hidden `HOME` [V].
2. **Typed edges are the sharing path.** A node reads an upstream node's typed output by `$ref`, labelled by the runtime.
3. **Cross-run application state is a typed state slot** (`src/state.mjs`): declared writers, compare-and-swap, a label
   ceiling, journaled [V].
4. **Cross-run lessons** become a replay-proven workflow version or an AMP claim (R-10, THESIS D11). Nothing else written during
   a run outlives it.

**What is an experiment, not a decision: the run board.** A board shared within one run, for the one case edges cannot serve:
parallel explorers that should learn from each other mid-flight. It is a $0 prototype and the instrument of MEM-1. It stays in
`experiments/` unless MEM-1 shows it beats plain edges by at least 15% per dollar (ROADMAP R-10).

**What is deferred** (ROADMAP §6 rules 5 and 12, and the owner's "fine line"). No preregistered experiment needs these, so they
are not built:
- a node-scratch class (rule 1 above already holds without it);
- workflow-version notes (MEM-2);
- an org-memory stand-in (MEM-3; AMP owns org memory);
- a confidentiality label axis. No bed has secrets yet. When one does, the axis belongs to the runtime's labels for edges,
  state and board alike, not to the board.

Revision 1 built all four. The code is in commit `8a42d7a5` (`experiments/memory/board.mjs`).

| Scope | What it holds | Who writes | Who reads | Lifetime | Status |
|---|---|---|---|---|---|
| **Node-private** | Transcript, scratch, tool outputs, workdir | The node | The node; a repair or escalation copy of it; auditors. **No other prompt** | One attempt; kept as evidence | Adopted (the runtime today) |
| **Typed edges** | Typed outputs | The node | Wired downstream nodes, by `$ref` | The run | Adopted (the default) |
| **State slots** | Keyed cross-run state | Declared writers, with compare-and-swap | Nodes of the workflow; a read carries the slot label | The workflow | Adopted (the runtime today) |
| **Run board** | Typed topics | Declared writers, through the kernel | Declared readers, at one pinned seq, in fair pages | One run | **Experiment (MEM-1)** |
| **Version notes** | Lessons bound to one workflow version | The promotion ladder | Runs of that version | The version | Deferred (MEM-2) |
| **Org memory** | Claims | AMP | Through AMP's query | AMP's | AMP's; the stand-in is deferred (MEM-3) |

**The board's kernel rules.** Each is a check in `experiments/memory/board.mjs` and a test (§5).
1. **Writes are declared.** Only a topic's declared writers write. A write must be schema-valid, within its size and within the
   topic and per-writer quotas. A keyed (`lww`) write must pass compare-and-swap (`expectSeq`).
2. **Labels come from the kernel, never from the data.** A value that carries `security_label: {integrity: "trusted"}` is just
   data: the label-forgery primitive APIsec reported in the FIDES middleware [P].
3. **No write-up of taint.** A topic's label ceiling refuses data more tainted than the topic admits, and a view's label is the
   join of every write in the topic.
4. **Reads are declared and pinned.** A node reads only declared topics, at one sequence number, recorded in the receipt
   (`sourceRef: board:<topic>@<seq>`).
5. **A view is never silently cut.** A view over its cap is **paged fairly** across the topic's declared writers: each writer
   with items left gets an equal token share of the page first, and the rest goes round-robin. Every page states what it
   omitted, per writer, and how to continue (revision 1 refused the view instead; that lost availability, review #2 and #3).
6. **Compaction is a fold, not a summary.** It is exact. Labels, quotas, versions and provenance survive it.
7. **An echo is not a second source.** Provenance is **derived by the kernel** from the reads the writer made through the board
   and from the context receipt it presents. Declared sources can only add ancestry, never remove it (revision 1 trusted
   declared sources only, review #5). Two posts of the same external item count as one source.
8. **The board dies with the run.**

**What it buys, measured at $0 [M]** (§6). This is development evidence. The battery has 17 attacks and 10 honest workloads,
uses real gameqa typed findings as payloads, and gives every design the same 2,000-token budget per read.
- **Attacks that reach their goal:** simplest shared notes (N0) 17 of 17; a FIDES-like labelled store (N2) 12; **Foundry today
  (E0: typed edges plus state slots) 5; the board 3.**
- **The board's marginal gain over E0 is narrow:**
  - it stops three echo and common-source attacks that E0 cannot stop, because E0 counts every upstream output that carries a
    claim;
  - its fair pages let a reader reach all 40 findings of an over-budget topic in 3 reads. E0's static per-input caps hide 23 of
    the 40 and offer no way to continue. In the flood scenarios the same caps drop 1 of 10 honest findings even with no
    attacker.
- **It costs one honest workload that E0 passes.** An honest reproduction made after reading the claim counts as an echo (H10).
- **Neither design stops:**
  - a secret leak (A10, A11). Only N2's confidentiality labels stop it;
  - a sybil flood by 18 of 20 declared writers, sized against the page (A13c);
  - the residual A14, an injection that steers a quarantined judgment inside its enum. It beats every design.
- **Replay.** Every design replays exactly from its journal: 0 of 200 differ. The board's edge is that a read journals a
  20-byte reference instead of the content (164 bytes in the test, about 2.5 KB at the d5 view size). Without its journal the
  board is as order-dependent as shared notes (200 of 200). E0 is deterministic only because it has no mid-flight read.
- **Cost of a peer read (MEM-0c, gameqa dev).** The board's typed view costs 227 / 376 / 635 tokens at d3 / d4 / d5. A pool of
  shared transcripts costs 25.5K / 48.5K / 100.6K, a per-task median of 112× / 121× / 152×. That pool is a lower bound, and
  nobody proposes it.
- **Against plain edges the board adds cost.** Reading the full view on every turn adds at most $0.0034 / $0.0056 / $0.0095 per
  explorer session: 0.6% / 0.9% / 1.6% of a $0.60 session. To clear R-10's 15% per dollar at d5, the board must therefore find
  about 16.8% more bugs [arith: 1.15 × 1.016].

**What it does not show.** That a board helps any task. That is MEM-1 (§7): about $80–160 with a $200 cap, after a $0 ceiling
check and a $5 pilot.

---

## 1. The question, from first principles

Here "memory" means **any byte that can influence a model call or a control decision, other than the node's immediate typed
inputs, and that outlives the step that produced it** [I]. Five properties govern each piece of memory:
1. **Authority**: who may write it.
2. **Visibility**: who may read it.
3. **Lifetime**: how long it lives.
4. **Trust**: what label it carries, and whether a reader can tell who said it and from what.
5. **Cost**: tokens per read multiplied by readers and turns. Memory is a cost *multiplier*: one byte on a shared board is paid
   by every reader on every turn.

Three facts from today's research make these properties concrete.

**1. Long context does not replace memory discipline.**
- Chroma's context-rot report: all 18 models tested degrade as input grows, even when the added content is relevant, and a
  single distractor already hurts (July 2025) [S].
- Anthropic's context-engineering guidance (2025-09-29): "the smallest set of high-signal tokens". Compaction, structured
  note-taking and sub-agents that return "a condensed, distilled summary of its work (often 1,000-2,000 tokens)" [P].
- A 2026 testbed: a full-context baseline *underperforms* a compressed memory, and "compression precision rather than context
  volume determines LTM accuracy" (Wolff & Bennati, arXiv 2601.07978, 2026-01-12) [P].
- So sharing transcripts is both expensive and harmful. Share decisions.

**2. Memory is where injection persists.**
- MINJA poisons long-term memory through ordinary queries: over 95% injection success, over 70% attack success (2025) [S].
- AMIA (Findings of EMNLP 2026, October 2026) scales query-only injection "to multi-agent shared memory, and to three
  production-oriented memory architectures (Mem0, A-MEM, MemoryOS)" [P].
- Semantic Norm Drift (arXiv 2605.22842, May 2026) uploads one policy-formatted document to a shared store. Agents cite it "as
  normative authority" in 59 of 65 valid entries. Four classifiers detect nothing across 510 checkpoints. The attack is then
  misattributed to the model in all 64 documented failures [P].
- The defence that worked there was "Memory-Persistent Information-Flow Control", which blocked 97% *at the cross-session
  boundary* [P]. That is board rule 8 and adopted rule 4 (§0).
- An agent's own wrong outputs also persist: retrieved erroneous records are "replicated and even amplified". Selective addition
  with quality checks gives about 10 points absolute (Xiong et al., arXiv 2505.16067, v2 Oct 2025) [S]. Any cross-run lesson store needs such a
  gate: version notes are deferred until MEM-2 can test one (§4.4).

**3. Coordination fails on state, not on intelligence.**
- MAST attributes multi-agent failures mainly to "system design issues and inter-agent misalignment", including information
  withholding (FM-2.4) (arXiv 2503.13657) [S].
- Claude Code's own agent teams use a shared task list with *file-locked claims* and JSON mailboxes, and document that "task
  status can lag" [P].
- Letta's shared-memory docs give a concurrency table: `memory_insert` is append-only and safe; `memory_rethink` is
  last-writer-wins and loses updates. They recommend designating "one agent ... as the owner for heavy edits" [P].
- These are the classic distributed-state failures, and the classic fixes apply: one writer, compare-and-swap, an append-only log.

---

## 2. State of the art as of 2026-11-04

### 2.1 Shared memory and blackboards in multi-agent LLM systems

| Work (date) | What it does | Evidence | What Foundry takes |
|---|---|---|---|
| **PatchBoard**, arXiv 2605.29313 (May 2026; the HTML the indexer dates 2026-09-23) [P] | Agents mutate a shared JSON state with **validated JSON Patch**, never dialogue. An Architect writes a schema, worker read/write paths and budgets. A **deterministic kernel** validates syntax, authorization, schema and invariants, commits transactionally, **logs rejected patches** and writes replayable transaction logs | 630 matched ALFWorld episodes: **84.6%** success vs LangGraph 30.8% and Flock 61.6%. **Tokens per success: 45.5k** vs 368.3k and 64.2k | The closest published match to Foundry's board. It supports typed views plus kernel validation. Caveats [I]: one paper, one bed, a LangGraph baseline whose configuration I did not check |
| **Salemi et al.**, arXiv 2510.01285 (v2 2026-01-31) [P] | A main agent posts requests to a blackboard; helper agents **volunteer**. Responses go to a *separate response board* "to prevent cross-influence of sub-agents" | 13–57% relative end-to-end gain on data-discovery benches (KramaBench, DSBench, DA-Code variants) | Separate request and response topics. A worker cannot see its peers' answers before it commits its own, which keeps their evidence independent (rule 7) |
| **LbMAS**, Han & Zhang, arXiv 2507.01701 (2025-07-02) [P] | Agents share everything on a blackboard; a control unit picks who acts; the loop runs to consensus | "Competitive" with SOTA MAS, "spend less tokens". The abstract gives no numbers | A design reference only |
| **Governed Shared Memory** (MemClaw / ArgusFleet), arXiv 2606.24535 (2026-06-23) [P] | Four failure modes: **unauthorized leakage, stale propagation, contradiction persistence, provenance collapse**. Scoped retrieval, temporal supersession, provenance, policy-governed propagation | One production service, no baseline. Provenance reconstructed on 50 of 50 depth-4 chains. Two real defects: **a GET-by-id path skipped sub-tenant scope**, and **a synchronous dedupe gate pre-empted the asynchronous contradiction detector** | Every read path goes through one check (the battery tests the read path itself). The order of checks matters, and refusals are logged |
| **Terrarium**, arXiv 2510.14312 (2025-10-16) [P] | A blackboard testbed for attacks: misalignment, malicious agents, compromised communication, data poisoning | Framework only | The attack classes behind A4, A6, A8 and A13 |
| **Multi-agent memory as computer architecture**, arXiv 2603.10062 (2026-03) [P] | Shared vs distributed memory. Names **consistency** the most pressing open problem, plus missing access control and cache sharing | Position paper | A pinned-seq snapshot read is the consistency model (§4.6) |
| **Mesh Memory Protocol**, arXiv 2604.19540 (2026-04) [P] | Lineage through content-hash parents, so a returning claim "is recognised as [an] echo of the receiver's own prior thinking" | Production deployments, no benchmark | Rule 7, `independentSupport` |
| **G-Memory**, NeurIPS 2025, arXiv 2506.07398 [S] | A three-tier memory graph (insight, query, interaction) for MAS | Up to +20.89% embodied success and +10.12% knowledge QA (abstract) | Cross-run *insights* exist in Foundry only as a replay-proven workflow version or an AMP claim (version notes deferred, MEM-2) |
| **Collaborative Memory**, arXiv 2505.18279 (2025) [S] | Private and shared tiers, **immutable provenance per fragment**, time-varying bipartite access graphs | No experiments in the abstract | Multi-principal walls belong to AMP and ARC (THESIS §8) |
| **MIRIX**, arXiv 2507.07957 (2025) [S] | Six typed memories (core, episodic, semantic, procedural, resource, vault), each with a manager agent | Better multi-hop and temporal QA | Typed memories, yes. Model-run memory managers, no: memory writes are code-owned in Foundry |
| **LatentMAS**, arXiv 2511.20639 (v4 2026-08) [P] | Shared *latent* working memory (hidden states) | Up to +14.6% accuracy, 70.8–83.7% fewer output tokens | Out of scope. API models expose no hidden states |

### 2.2 Memory systems and frameworks: how each one shares and isolates

| System (as of) | Private | Shared | Persistence and versioning | Note for Foundry |
|---|---|---|---|---|
| **Claude Code subagents** (docs, read 2026-11-04) [P] | "Each subagent starts with a fresh, isolated context window"; no parent history | Returns only its result. CLAUDE.md and AGENTS.md are loaded; a fork inherits the parent conversation | Optional `memory: user\|project\|local` directory. The first 200 lines or 25 KB of `MEMORY.md` go into its prompt | Matches "private by default". **Agent memory directories are an accidental cross-run channel** (§4.7) |
| **Claude Code agent teams** (experimental) [P] | Own context window per teammate | Shared task list with dependencies and **file-locked claiming**; JSON mailboxes | The task list stays on disk after the session | A message between agents is marked as not from the user and cannot carry consent. Same rule as Foundry's "untrusted peer" |
| **OpenAI Agents SDK** [P/S] | Local `RunContextWrapper` context is "not sent to the LLM" | Conversation via sessions | `OpenAIResponsesCompactionSession` compacts stored history via `responses.compact` after a turn (default trigger: 10+ candidates) | Splits *code state* from *LLM context*, as Foundry's state slots and context compiler do. Its compaction is a model summary, which is lossy |
| **Google ADK** state [S] | `temp:` (one invocation; sub-agents share it) | Session state (no prefix); `user:` across a user's sessions; `app:` across all users | DB or Vertex backends persist; InMemory loses everything on restart | Scope by **key prefix** keeps the scopes visible in the program. Foundry declares scopes per topic |
| **LangGraph** [P/S] | Per-thread checkpoints (short-term) | `Store` for cross-thread long-term data; channels with reducers | "Prune old checkpoints periodically or set a retention policy" | Reducers per channel, as Foundry's topic reducers. Retention is left to the user |
| **Letta** [P/S] | Each agent's own MemFS | **Shared memory blocks** (deprecated) → shared **git-backed MemFS** repositories | "Each memory edit gets committed"; memory subagents write through git worktrees | Even a memory-first vendor moved to an append-only, versioned, committed store |
| **Zep / Graphiti** [S] | — | Temporal knowledge graph | **Bi-temporal**: `valid_at`/`invalid_at` (world time) and `created_at`/`expired_at` (ingestion time). Old facts are invalidated, not deleted | An org-memory query should take `asOf` and be receipted (AMP's design; the stand-in is deferred, MEM-3) |
| **A-MEM**, NeurIPS 2025 [S] | — | Zettelkasten notes with links | **Memory evolution**: new notes rewrite linked old notes | Rewriting past memory is "provenance collapse". Foundry never rewrites; it supersedes |
| **Mem0 / graph memory** [S][P] | — | Extracted facts (vector and graph) | LOCOMO numbers are disputed between vendors [S] | Independent testbed: plain RAG matches mem0 at **8.4× lower TCO**; Graphiti and cognee 55–56% vs 77–81% [P]. Cost discipline beats memory products |

### 2.3 Context engineering (2025–2026)

- **Anthropic** (2025-09-29) [P] names three techniques:
  - compaction ("overly aggressive compaction can result in the loss of subtle but critical context");
  - structured note-taking (NOTES.md, the memory tool);
  - sub-agents returning 1–2K-token summaries.
- **Anthropic's context-management announcement** [S] reports gains of +39% (memory tool with context editing) and +29%
  (context editing alone) on an internal evaluation. These are vendor claims.
- **ACE** (arXiv 2510.04618, ICLR 2026) [S] treats contexts as **evolving playbooks** updated by incremental deltas. It names
  "**context collapse**": monolithic rewriting by an LLM "degrades into shorter, less informative summaries". This is why
  compaction here is a fold, never a rewrite.
- **MemoryAgentBench** (arXiv 2507.05257, ICLR 2026) [S]: every memory agent tested fails on conflict resolution and selective
  forgetting, down to 7% on multi-hop. Overwriting facts is the hard part, so supersession must be explicit (lww with CAS,
  bi-temporal claims) and never left to a model.

### 2.4 Provenance, taint and information flow

- **CaMeL** (arXiv 2503.18813, 2025) [S]: capabilities on values, a privileged planner and a quarantined model. It reports 77%
  of AgentDojo tasks solved with provable security, vs 84% undefended.
- **FIDES** (arXiv 2505.23643; Microsoft Agent Framework, 2026-05-20) [P] uses two label axes:
  - integrity: trusted / untrusted;
  - confidentiality: public / private / user_identity.

  Joins are most-restrictive; sink policies use `max_allowed_confidentiality`; `auto_hide_untrusted` swaps content for variable
  references.
- **APIsec's finding** [P]: the middleware read `security_label` dicts out of tool *arguments*. `ContentLabel.from_dict()`
  defaults to trusted, so an attacker-written key flipped a blocked `wire_transfer` to executed.
  - MSRC triaged it as Moderate, then closed it as "Defense-in-Depth" with no CVE. It confirmed the forgery primitive as "real
    and deterministic".
  - **The forgery works in every configuration. The full policy-gate bypass is conditional:**
    - it needs a tool that declares no `source_integrity`;
    - the clean PoC ran with `auto_hide_untrusted=False`, which is not the default;
    - a forged trusted label cannot restore trust to a context that is already untrusted.
  - The tested versions are `agent-framework-core` 1.11.0–1.15.0; the article is dated 2026-09-01.

  **Lesson: labels must be kernel metadata.**
- **Foundry today** [V]:
  - integrity labels with joins: `src/context.mjs:9-30`;
  - inheritance by ref prefix: `inheritedLabel`, `:27-30`;
  - control-flow (program-counter) taint: `src/validate.mjs:113-147`, `src/runtime.mjs:111-115, 598-626`;
  - quarantined declassification to bounded values: `src/context.mjs:73, 127-134`;
  - state slots with a label ceiling: `src/state.mjs:30-31`.
  - **Not there: a confidentiality axis.** Revision 1's prototype added one at the memory layer. Revision 2 removed it: it is
    deferred until a bed has secrets, and then belongs to the runtime's labels (§4.5).

---

## 3. Where Foundry stands today (mapping)

| Concept | In the repository [V] | Gap |
|---|---|---|
| Private node working memory | Agent nodes are single typed calls (`schemas/workflow.schema.json:92` allows only `history: "none"`; `src/context.mjs:70`). Executor nodes run in a sandbox whose `HOME` is a hidden empty tmpfs (`src/executors/claude-code.mjs:95-126`) | None that an experiment needs. ROADMAP §2.2 lists `scratch` in the contract (`docs/ROADMAP.md:294`); a scratch class is deferred (§0) |
| Typed edges | Outputs by `$ref`, with labels joined over data and control (`src/runtime.mjs:598-626`) | — (the default sharing path; E0 in the battery) |
| Run board | **None in `src/`.** ROADMAP §2.2 (`docs/ROADMAP.md:326-343`) specifies `board_events`, topics, reducers, writers and `expectSeq`, gated behind an experiment and its injection, confused-deputy and flooding tests | Prototype revision 2 in `experiments/memory/board.mjs`; the gate tests are MEM-0b (§6) |
| Context receipts | `context.compiled`: prefix hash, `sourceRef`, `sourceHash`, label and truncation per input (`src/context.mjs:130-136`). The replay key is built from the prompt hash, which covers the rendered inputs (`src/models/port.mjs:185-188`) | Board reads plug in through `sourceRef: board:<topic>@<seq>[#cursor]` without changing the compiler (tested, §5) |
| Journal and seal | `model_calls` journal-before-observe (`src/journal.mjs:1-3`); hash chain, Merkle journal root at seal (`src/audit.mjs`); ROADMAP §2.10 wants "a board root once a board exists" (`docs/ROADMAP.md:713`) | `Board.root()` gives `{declHash, seq, head, statesHash, checkpoint}` to bind at seal |
| Cross-run application state | `src/state.mjs` slots: declared writers (`src/validate.mjs:332`), CAS (`src/state.mjs:228-229`), TTL, bounded, typed, journaled, replayed, a drift hash, a label ceiling (`src/runtime.mjs:1382-1383`) | — (E0 runs the real `StateStore`) |
| Cross-run lessons | None in `src/`. THESIS D11: "no mutable cross-run store" (`docs/THESIS.md:358`). R-10: lessons become a replay-proven workflow version or an AMP claim (`docs/ROADMAP.md:338-340`) | Version notes deferred to MEM-2 (§4.4) |
| Org memory | The AMP seam is specified (`docs/ROADMAP.md:354-356`; THESIS §8) | AMP's; the stand-in is deferred to MEM-3 (§4.4) |
| Confidentiality | **None** (integrity labels only) | Deferred until a bed has secrets; then a runtime label axis, not a board feature (§4.5) |
| Accidental memory | ModelPort CLI calls run with `--safe-mode`, `--no-session-persistence` and a throwaway cwd (`policy/models.json:36-45`; `src/models/providers/claude-cli.mjs:164-170`); the executor adds `--strict-mcp-config` with no servers (`src/executors/claude-code.mjs:302-303`). The leak scan exists (`experiments/memory/leak-scan.mjs`) | The `--safe-mode` help text (read from the image CLI, 2.1.318) does not name auto memory. The canary probe is unrun (§4.7) |

**Prior design, reconciled.** The 2026-10-15 design (§3.2, seven memories, rules R1–R10, holes M1–M6) stands. This document:
1. gives the run board exact semantics and builds it as a tested prototype, still **not** wired into the runtime;
2. adds fair paging, derived provenance and exact compaction to the board;
3. measures the board against Foundry today (E0) and three framework-style baselines (MEM-0b), and prices a peer read
   (MEM-0c);
4. designs the capability experiment (MEM-1).

Its "do not build: a run board" stays true for `src/`.

---

## 4. The run board, precisely (experiment only)

The prototype is `experiments/memory/board.mjs` (revision 2, model id `foundry-board/2`). Every rule below is a check in that
file and a test in `experiments/memory/test/board.test.mjs`.

### 4.1 Declaration (code-owned, static)

Each topic declares:
- a `reducer`: `append`, `lww(key)`, `setUnion`, `max` or `counter`;
- an optional `schema`;
- its `writers` and `readers`, as node ids;
- a `label`, which is the integrity ceiling;
- `maxEvents`, `maxEventsPerWriter`, `maxEventBytes` and `maxViewTokens`.

**A model never chooses at run time what it may read or write** (the rule in the 2026-10-07 review,
`research/review-20261007/03-swarms-frontier.md:632-641`). A static check guarantees that every single event, plus the page
frame, fits one page of its topic. So paging always makes progress.

### 4.2 Writes

The kernel checks, in order:
1. the topic exists;
2. the writer is declared;
3. the label flows into the ceiling;
4. the size;
5. the schema;
6. the topic quota;
7. the per-writer quota;
8. reducer typing;
9. for `lww`, compare-and-swap on the key's version.

A refusal is typed (nine codes), changes no state, and is kept in `refusals` with the head it was evaluated against.

An accepted event `{seq, topic, writer, value, valueHash, label, sources, prev}` is hash-chained. Its `sources` are the union of
three things:
- **(a)** the reads the writer made through the board, as `board:<topic>@<seq>`;
- **(b)** the `sourceRef`s of a context receipt the writer presents;
- **(c)** sources the writer declares.

So a writer can add ancestry but cannot hide what the kernel saw it read.

### 4.3 Reads

- `view(reader, topic, {atSeq})` folds the reducer over the events up to `atSeq`. It refuses `BOARD_READER`, `BOARD_SEQ` and
  `BOARD_COMPACTED`. Every read is logged, and the log is what derived provenance comes from.
- The **view label is the join of every accepted write in the topic**. This is conservative: which value wins in `lww`, `max`
  or `setUnion` can depend on every write.
- `readsFor(reader, specs, {atSeq})` returns inputs for `compileContext`, all at **one** sequence number. A view within its cap
  (the smaller of the spec's `maxTokens` and the topic's `maxViewTokens`) is the whole view, with
  `sourceRef: board:<topic>@<seq>`.
- **A larger view is one fair page** `{page, omitted, next}`, with `sourceRef: board:<topic>@<seq>#<cursor>`, built in two
  passes:
  - **Pass 1.** Every declared writer with items left gets an equal share of the page's token budget and takes its next items
    while they fit.
  - **Pass 2.** The rest of the budget goes round-robin, one item per writer per turn.

  `omitted` counts what each writer still has. Following `next` reaches every item exactly once, at the same pinned seq, while
  writes continue (tested).
- **The guarantee and its bound.** A writer whose next item fits budget ÷ (writers with items left) is on the page, however
  much the others wrote. Per-writer quotas bound one flooder; this bounds a sybil flood by several declared writers within
  quota.
  - **The bound fails** when declared writers × honest item size exceeds the page. Battery A13c measures that: 18 sybils of 20
    declared writers, with junk sized to exactly one share, hide 1 of 2 honest findings.
  - **Remedies (unbuilt):** fewer declared writers per topic, a larger page, or a filtered view (for example, by floor).
- `max` and `counter` views are one number. Over the cap they are refused (`BOARD_VIEW_BUDGET`).

**Why fair pages and not refusal [I].** Revision 1 refused an over-cap view. That turned a flood into a lost read
(availability), and it refused an honest 40-finding view outright at realistic payload sizes (review probe P4). The shared
notes baseline shows the newest notes that fit, which is a silent, order-dependent cut. Fair pages keep every writer visible
and every omission explicit.

### 4.4 Independent support (echo counting)

`independentSupport(reader, topic, member)` counts a `setUnion` member's supporters in seq order. A supporter is independent
when all three hold:
1. no other supporting event of the member is in its ancestry;
2. its writer was not counted already;
3. its external sources share nothing with those of a counted supporter.

Ancestry follows `event:<n>` and `board:<t>@<n>`, which means every event of topic *t* up to *n*, transitively, and it survives
compaction (`lineage`).

**This rule is conservative, and that has a price.** An honest reproduction made after reading the claim also counts as an echo
(battery H10), because the kernel cannot verify a re-derivation. For MEM-1 this means independent support is a diagnostic, not
a gate. The gate on a finding is the oracle's replay. The fix would be to count only harness-attested reproduction traces
(unbuilt).

**Deferred cross-run scopes [I].** Version notes and an org-memory stand-in are deferred. The review found the version-note
gate in revision 1 unsafe (review #6), for three reasons:
- `sourceRuns` was optional, so the in-sample check was vacuous;
- the evidence was self-reported, not bound to journals;
- the bar of +1 pass in 5 runs is noise-level.

If MEM-2 is preregistered, its admission rule must require three things:
- a non-empty `sourceRuns`;
- evidence runs bound by their journal root hashes;
- a paired sign test at a preregistered n.

The org-memory notes from revision 1 (bi-temporal `asOf`, labels by provenance, derived claims stay untrusted) are inputs to
AMP's design, not Foundry code.

### 4.5 Labels

- **Integrity:** `trusted` | `untrusted:<src>[+<src>...]`, joined as a union of sources (`src/context.mjs:9`).
- **The rules:**
  1. labels never come from data;
  2. no write-up of taint.
- **Effects** fire only on `trusted` arguments (the battery's `sinkAllows`, and the validator's existing effect rule).
  Declassification happens only through quarantined bounded judgments, and A14 shows the residual risk this leaves.
- **Confidentiality is deferred.** Revision 1 added a public / internal / secret axis to the board. It is orthogonal to the
  choice between a board and edges: a leak path through an edge or a state slot needs the same axis. In MEM-0b, A10 and A11
  succeed against both E0 and the board. Only N2, the FIDES-like store, stops them.

### 4.6 Consistency, replay and audit

**Consistency.** The board is a totally ordered log: the run's database serializes commits. Every read is a snapshot at a pinned
seq. `lww` writes use compare-and-swap, so a stale write is refused (`BOARD_STALE`), and the writer re-reads and retries. In
MEM-0b that costs one retry in H9 and in A5, the same as E0's state slots.

**Replay: what the board does and does not add.**
- **Revision 1's claim was wrong.** It said the board alone replays deterministically. The review showed this was an artefact
  of the harness (review #1).
- **What holds.** Any design whose reads are journaled before they are observed replays exactly: 0 of 200 differ for all five
  designs in MEM-0b.
- **What the board adds:**
  - **size:** a read journals a reference (`board:progress@7`, 20 bytes) instead of the content (164 bytes in the test, about
    2.5 KB at the d5 view size), because the board's events are already the journal;
  - **checkability:** `Board.replay` re-validates and re-hashes every event (`REPLAY_DIVERGENCE`). A tampered log, including a
    stripped `sources` list, does not replay.
- **E0** is deterministic for a different reason: it has no mid-flight read. A reader runs after its writers complete, and
  outputs are ordered by node.

**Audit.**
- `verify()` recomputes the hash chain from the checkpoint, checks the checkpoint's `statesHash`, re-derives every topic's fold
  state from the checkpoint plus the hot log, and checks the lineage. So an edited label list or quota counter is caught (review
  #12, probe P8).
- `root()` binds `statesHash` and the checkpoint.
- To answer "what did node X know when it decided?", read the board reads it made (or its receipt's `sourceRef`s) and fold to
  that seq.

**Forensics.** The SND paper's *counterfactual composition testing* masks one memory entry and re-runs. It found the causal
entry 87.5% of the time [P]. The board version [I] needs no new machinery:
- replay the recorded run with one board event masked;
- the read log says which nodes read it;
- the journal serves every other call unchanged.

### 4.7 Compaction, retention and accidental memory

**Compaction.** `compact(atSeq)` makes the fold state the checkpoint and archives older events. Views at or after the
compaction point are identical, which is a property test over 40 random logs, all five reducers and every event's ancestry.
Labels, quotas, lww versions and provenance survive. A model-written summary is only ever a derived view that names its seq
range. The board lives as long as the run record; the memory model adds no new long-lived store.

**Accidental memory.**
- **Executor agent memory.** A Claude Code session can keep `memory: project|local` directories (`.claude/agent-memory*/`) and
  auto memory [P].
  - The user-scope directory is empty, because `HOME` is a hidden tmpfs (`src/executors/claude-code.mjs:95-126`).
  - A project directory inside a reused workdir would persist across cases. The 10-15 rule M1 (a workspace per instance) and
    the X1 leak scan cover that case.
  - **Action [I]:** add `.claude/agent-memory*` and any `CLAUDE.md` written by an executor to the X1 scan's truth-file list.
- **ModelPort calls.** These run with `--safe-mode`. The image CLI's help (2.1.318) says it disables "CLAUDE.md, skills,
  installed plugins, hooks, MCP servers, custom commands and agents, output styles, workflows ... and more".
  - **Auto memory is not named in that help text,** so it is **unverified**.
  - A $0.01 canary probe would settle it: plant a marker in the host's auto-memory location and ask Haiku to echo any memory.
    It was not run, because this task's budget is $0.
  - D32 pins P1's arms at CLI 2.1.312. MEM-1's freeze pins its own CLI.
- **Prompt cache and replay memo.** These are covered by the existing cache-share and memo-reuse scans.

### 4.8 Cost model

```
C_mem = Σ_reads tokens(view_r) × ( p_in × (1 − h_r) + p_cache × h_r )   (writes cost no model tokens; kernel CPU ≈ 0)
```

- **The dominant term is readers × turns × view size.**
- **Against a transcript pool**, the board is about 100× cheaper per read (§6.3).
- **Against plain edges, the board is pure added cost** unless it changes what explorers do, because isolated explorers read no
  peer. At d5 the added cost is at most 1.6% of a session [M]. MEM-1's bar is therefore about 16.8% more confirmed bugs, not
  15% (§0).
- **Cache-friendly order [I].** Declare stable inputs (version files, policy) first and volatile board views last, so stable
  segments form a common prefix (`src/context.mjs:95, 107`).
- **The price cliff.** Haiku 5.5 input costs $0.10 per MTok up to 100K tokens and $0.50 beyond (`policy/models.json`). On more
  than 10% of d5 tasks a transcript pool alone crosses 100K tokens (p90 165,057), a 5× price cliff that typed views never
  approach.

---

## 5. The prototype and its tests

| File | What it is |
|---|---|
| `experiments/memory/board.mjs` | The kernel, revision 2: `defineBoard`, `Board` (`write`, `view`, `readsFor`, `version`, `independentSupport`, `ancestry`, `compact`, `verify`, `root`, `replay`), `fairPage` |
| `experiments/memory/baselines.mjs` | Five designs behind one adapter contract: N0 shared notes, N1 shared dict, N2 labelled store (FIDES-like), **E0 plain edges + state slots** (the real `StateStore` from `src/state.mjs` and the real context compiler), F board |
| `experiments/memory/battery.mjs` | MEM-0b revision 2: 17 attacks, the A14 control, 10 honest workloads, uniform replay measurement |
| `experiments/memory/context-bytes.mjs` | MEM-0c revision 2: the cost of a peer read on gameqa (dev 2001–2030), against the pool and against edges |
| `experiments/memory/test/board.test.mjs` | 10 tests (below) |
| `experiments/memory/test/battery.test.mjs` | 5 tests (below) |
| `experiments/memory/mutation-check.mjs` | 26 source mutants of `board.mjs` against its tests |

**What the board tests cover:**
- declarations are refused before a run, including an event that would not fit a page;
- all 16 refusal cases leave the head, seq and fold state unchanged, and each is recorded;
- labels survive forged `security_label` fields, and a view joins two different untrusted sources;
- reads are declared and pinned. Over-cap views are paged fairly whatever the write order, every page states its omissions,
  following `next` reaches each of 62 items once at a pinned seq, and a bad cursor is refused;
- the fair page's per-writer share and round-robin fill;
- a board read compiles to a byte-identical prompt on replay, and an edited value or a stripped `sources` list does not replay;
- `verify()` catches an edited label list, a reset quota counter, an edited checkpoint and wrong lineage, and `root()` binds the
  state;
- compaction is a property test over views, quotas, versions and ancestry;
- echoes are not counted, in every form: declared, transitive, omitted after a read, transitive through another topic,
  receipt-form, presented receipt, and a common external source. Also: an independent reproduction counts, a read at seq 0 adds
  nothing, and an undeclared reader is refused;
- the prototype is outside the engine identity and the runtime.

**What the battery tests cover:**
1. **A regression lock on the reported numbers.** It is labelled as such and is not evidence.
2. **Teeth.** Seven mutant designs, each disabling one defence through the public interface, must flip their attack:
   - no writer check flips A4;
   - self-described labels flip A3;
   - no CAS flips A5;
   - a board that outlives its run flips A8;
   - a cut instead of a page flips A13;
   - declared sources only flips A12b;
   - replay at the latest seq makes the journal replay differ, which shows the replay row compares content, not a flag.
3. **Uniformity.**
   - A source check that no scenario names a design or sets its own budget.
   - Every design stays within the 2,000-token budget in every scenario read.
   - A14 is reported apart.
4. **Payloads and MEM-0c.**
   - Payloads are real gameqa dev findings.
   - MEM-0c is deterministic, and its task ids carry the dev split.
   - When `research/jit-20261008/SEED-LEDGER.json` is in the checkout, no gameqa range overlaps the seeds. It is not in this
     sparse worktree, where the check was run by hand against the main tree's copy: no overlap.
5. **Fair paging over real findings** reaches every item exactly once.

**Mutation check (teeth) [M].** `node experiments/memory/mutation-check.mjs` applies 26 single-site mutants to `board.mjs`, one
at a time, and restores the file.
- **25 were killed.**
- **The survivor, M26, is equivalent:** it drops the redundant `valueHash` comparison from `verify()`, and the event hash
  already covers the value.
- **This answers the four test gaps the review found:**
  - M23 is the support count without a reader check;
  - M22 is a view label that keeps only the last source;
  - the other two gaps were in the deferred version notes.

**Commands** (run one at a time; each $0):
```
nice -n 15 node --test --test-concurrency=1 experiments/memory/test/board.test.mjs     # 10 pass
nice -n 15 node --test --test-concurrency=1 experiments/memory/test/battery.test.mjs   # 5 pass (~30 s; E0 opens temporary SQLite stores and deletes them)
nice -n 15 node experiments/memory/mutation-check.mjs                                  # killed 25/26
nice -n 15 node experiments/memory/battery.mjs --out research/memory-20261021/MEM-0b-battery.json
nice -n 15 node experiments/memory/context-bytes.mjs --out research/memory-20261021/MEM-0c-context-bytes.json
```
The existing memory tests still pass: leak-scan 4, memo-reuse 2, cache-share 2.

**Merge notes (engine v2 series).**
- No file under `src/`, `schemas/`, `policy/` or `experiments/lib/` changed, and `src/engine.mjs`'s identity list is unchanged,
  so **no engine hash changes** (a test asserts it).
- `.gitignore`'s `node_modules/` became `node_modules`: the old pattern does not match the symlinked `node_modules` of a
  worktree (review §5). This is a one-line change, and a trivial conflict if the series edits line 1.
- E0 imports `StateStore` through `src/store.mjs` and `stateLabelMessage` from `src/validate.mjs`. If the series renames
  either, the battery needs a one-line import fix.
- Wiring the board into the runtime would touch six files the series also changes: `schemas/workflow.schema.json`,
  `src/validate.mjs`, `src/runtime.mjs`, `src/store.mjs`, `src/audit.mjs` and `src/engine.mjs`. It waits for MEM-1, then for the
  merge, and it counts as an engine bump.

---

## 6. Results ($0, development evidence)

### 6.1 Mechanism table against the simple baselines (MEM-0b revision 2) [M]

`research/memory-20261021/MEM-0b-battery.json`: 200 replay trials, seed 7, node v24. **Not preregistered.** The battery was
rebuilt after the review of revision 1, so it is development evidence. Uniform rules for every design:
- the same declaration;
- a 2,000-token budget per read;
- every read compiled by `src/context.mjs`, with visibility scored on the **compiled prompt**;
- floods run under both write orders, against a no-attack control: only an attacker-caused loss counts;
- payloads are 360 real gameqa typed findings (dev 2001–2090; tokens: median 86, p90 172, max 315).

| Measure | N0 shared notes (simplest) | N1 shared dict (LWW) | N2 labelled store (FIDES-like) | **E0 edges + state (Foundry today)** | **F board** |
|---|---|---|---|---|---|
| Attacks that reached their goal (of 17) | 17 | 14 | 12 | **5** | **3** |
| … of which the loss was declared in the prompt | 0 | 0 | 0 | 0 | 1 (A13c) |
| Floods that lose honest findings with **no** attacker (design cost) | — | A6, A7, A13, A13b, A13c | — | A6 1 of 10, A7 1 of 10, A13c 2 of 2 | — |
| A14 residual (reported apart; no design can differ) | reached | reached | reached | reached | reached |
| Honest operations refused (of 173) | 0 | 0 | 0 | 0 | 0 |
| Honest compare-and-swap retries | 0 | 0 | 0 | 1 | 1 |
| Honest workloads correct (of 10) | 9 (fails H9) | 2 | 9 (fails H9) | 9 (fails H2) | 9 (fails H10) |
| H2: 40 real findings (4,562 tokens) at a 2,000-token budget. In the first prompt / reachable / reads | 16 / 40 / 3 | 1 / 1 / 1 | 16 / 40 / 3 | 17 / 17 / 1 (no continuation) | 20 / 40 / 3 |
| Replay from the design's journal: prompt differs (of 200) | 0 | 0 | 0 | 0 | 0 |
| Re-execution under another completion order, no journal: differs (of 200) | 200 | 184 | 200 | 0 (no mid-flight read) | 200 |
| Journal bytes per mid-flight read | 164 (content) | 26 (content) | 164 (content) | 52 (`$ref`s; read at the end) | 20 (`board:progress@7`) |

**Per attack.** H means the attack reached its goal; · means it was stopped; L means the honest findings are lost even without
the attack, a design cost and not an attack outcome. Floods show honest findings visible under attack in the worse order, over
the no-attack control.

| Attack | N0 | N1 | N2 | E0 | F (how) |
|---|---|---|---|---|---|
| A1 injection to sink, topic ceiling trusted | H | H | · | · `LABEL_POLICY` (slot ceiling) | · `BOARD_LABEL` |
| A2 injection to sink, topic admits web data | H | H | · | · read labelled `untrusted:web` | · view labelled `untrusted:web` |
| A3 label forged inside the data | H | H | **H** | · runtime labels | · kernel labels |
| A4 undeclared writer (confused deputy) | H | H | H | · not wired | · `BOARD_WRITER` |
| A5 lost update, two concurrent writers | H (150) | H | H | · `STATE_VERSION_CONFLICT`, retry → 200 | · `BOARD_STALE`, retry → 200 |
| A6 flood of 5,000 junk findings by one writer | H (0 of 10) | H | H | L (9 of 10 with or without the flood) | · 10 of 10 (quota 20, fair page) |
| A7 the same flood across a compaction | H | H | H | L (9 of 10) | · quota survives the fold |
| A8 poisoned lesson persists to the next run | H | H | H | · edges die with the run | · the board dies with the run |
| A9 label laundering through compaction | H | H | · | · no compaction | · the fold keeps the label |
| A10 secret read by a node that should not see it, published | H | H | · (sink) | **H** | **H** (no confidentiality axis) |
| A11 secret written down into a public topic | H | H | · (sink) | **H** | **H** |
| A12a echo with declared provenance | H | · (overwrite) | H | **H** (counts outputs) | · `independentSupport` = 1 |
| A12b echo, provenance omitted after a read | H | · | H | **H** | · derived from the read log |
| A12c one external source posted twice | H | · | H | **H** | · common external source |
| A13 sybil flood, 3 writers × 300 small items | H (0 of 2) | H | H | · per-input caps | · fair page, 2 of 2, declared |
| A13b the same with maximum-size items | H | H | H | · | · |
| A13c 18 sybils of 20 writers, junk sized to one share | H | H | H | L (0 of 2 with or without) | **H** (1 of 2; the bound, §4.3) |
| A14 (residual, apart) injection steers a quarantined judgment inside its enum | H | H | H | H | H |

**Honest workloads that fail.**
- **N0 and N2 fail H9.** Two concurrent updaters lose an update, 150 instead of 200.
- **N1 fails everything but H1 and H3.** A last-write-wins dict cannot hold a list.
- **E0 fails H2.** Its static per-input caps (budget ÷ declared writers) hide 23 of 40 findings, and nothing lets the reader
  continue.
- **The board fails H10.** It counts an honest reproduction made after reading the claim as an echo.

### 6.2 What these numbers mean, and what they do not (honest reading)

- **This is still a mechanism battery, not capability.** It shows which designs let attacker data reach a decision point, or
  keep honest data from it, in running code and through the real context compiler. It does not show that any model acts on
  poisoned memory at these rates. MINJA, AMIA and SND measured that for their own settings. Nor does it show that a board helps
  any task.
- **The comparison that matters is board vs E0, and the margin is narrow.**
  - The board stops three echo and common-source attacks that E0 cannot stop.
  - The board reaches over-budget topics by paging, where E0's static caps lose honest content: H2, and 1 of 10 in A6 and A7.
  - E0 passes H10 and the board does not.
  - Everything else is equal. That includes the security properties E0 already has through edges, state slots and runtime
    labels: A1–A5, A8, A9, A13 and A13b.
  - The review predicted that the board's marginal gain over E0 would be "probably only confidentiality and echo counting".
    That holds, with confidentiality now deferred and paging added.
- **Two of the board's wins were designed after the review, against the review's own probes.** Fair paging answers P4 and A13;
  derived provenance answers P2 and P2b. That is the same "designed against the battery" caveat as revision 1. The honest
  counterweights are the two places where the new mechanisms lose:
  - A13c, the bound of fair paging;
  - H10, the price of conservative echo counting.
- **Some results depend on configuration choices.**
  - E0's flood losses depend on its per-input caps (budget ÷ declared writers). An author who sized inputs differently would get
    different numbers. That was not tested.
  - N0's first read shows the newest notes. A head-first reader loses under the other write order instead, and the two-order
    rule makes the battery insensitive to that choice.
- **The baselines are reductions.** I did not run LangGraph, Letta, Mem0 or FIDES code.
  - N2 models the FIDES label-forgery primitive, which APIsec reports works in every configuration [P]. But the full sink bypass
    is conditional: it needs a tool with no `source_integrity`, and the clean PoC used `auto_hide_untrusted=False`, which is not
    the default. MSRC closed it as defence-in-depth.
  - So N2's A3 is the conditional worst case. A correct FIDES, or one at its defaults, would be at 11 of 17.
- **Replay is no longer a differentiator of correctness.** Every design replays exactly from a journal. The remaining
  differences are journal size (a 20-byte reference vs the content) and checkability (`Board.replay` re-validates every event).
- **The open negatives:**
  - **A10 and A11:** no confidentiality axis in Foundry, on any path;
  - **A13c:** fair paging's bound;
  - **H10:** an honest reproduction undercounted;
  - **A14:** a quarantined judgment steered inside its enum. Its defence (a declassification budget in bits, approvals,
    verification) is outside memory and unbuilt.

### 6.3 Cost of a peer read: transcript pool, board view and plain edges (MEM-0c revision 2) [M]

`research/memory-20261021/MEM-0c-context-bytes.json`. gameqa, **dev split, seeds 2001–2030** per difficulty. Revision 1 used dev
1–30, which lies inside Kev's probe-pilot reserve in the seed ledger. Nothing was shown to a model, but the measurement moved
out of the reserve. The transcript is the `driver.mjs` replies to the planner-minimal reproduction of each planted bug from a
fresh start. The board entry is that bug's typed finding.

| Difficulty (explorers K) | Pool tokens per peer read: mean (p10–p90) | Board view tokens per read: mean (p10–p90) | Ratio, per-task median (p10–p90) | $ per 1,000 Haiku reads: pool vs board | **Added vs plain edges, per explorer session (≤)** |
|---|---|---|---|---|---|
| d3 (3) | 25,529 (8,873–43,745) | 227 (154–308) | 112× (62–147×) | $2.55 vs $0.023 | $0.0034 (0.57% of $0.60) |
| d4 (4) | 48,548 (21,178–76,272) | 376 (268–501) | 121× (79–158×) | $4.85 vs $0.038 | $0.0056 (0.94%) |
| d5 (5) | 100,619 (43,618–165,057) | 635 (403–901) | 152× (109–183×) | $10.06 vs $0.064 | $0.0095 (1.59%) |

**Reading.**
- **The pool is a lower bound,** because real transcripts are longer. It is also a strawman: nobody proposes sharing
  transcripts. The relevant comparison is the last column. **Against plain edges a board read is added cost.** It assumes 150
  turns and $0.60 per session, and the full view is an upper bound, since fewer findings exist early in a session.
- **Against summary passing,** where sub-agents return 1,000–2,000-token summaries [P], a typed finding (median 86 tokens) is
  about 10–20× smaller [arith]. Whether the summary's extra prose carries signal is unmeasured.
- **Revision 1 reported** 109 / 116 / 154× in §0 (ratio of means) and 107 / 114 / 142× in §6.3 (per-task medians). This table
  uses per-task medians throughout. The ratios of means on the new seeds are 113 / 129 / 158×.

### 6.4 Revision 1's battery: superseded, kept as a negative

`research/memory-20261021/MEM-0b-battery-v1-superseded.json` is kept unchanged. Its headline was "the board lets 1 of 14 attacks
through, 0 of 83 honest refusals, 0 of 200 replay divergence vs 200 of 200 for shared notes". It was **invalid as a
comparison**:
- the replay row was decided by a harness flag (review #1);
- a loud refusal was scored as "stopped", although availability was lost (A13 left 0 of 2 honest findings visible; review #2);
- toy payloads and different read paths for the board and the baselines hid the board refusing an honest 40-finding view
  (review #3);
- Foundry today was missing from the comparison (review #4).

The superseded MEM-0c file (`MEM-0c-context-bytes-v1-reserved-seeds.json`) is kept for the seed-ledger record.

---

## 7. The experiment that validates the board (MEM-1; preregistration draft, NOT frozen)

**Question.** Does a typed run board make cheap explorers find more confirmed bugs per dollar than isolated explorers with plain
typed edges? And does it keep the untrusted evidence pack from poisoning their reports?

**Bed.** gameqa (`beds/gameqa/`). It fits for four reasons:
- K planted bugs and an independent, executable oracle that replays each repro on the buggy and the control build;
- an untrusted evidence pack with decoys, stale tickets and 1–3 prompt-injection texts at d3–d5;
- navigation load;
- a deterministic environment (D0) with a JSON-lines driver.

**Seeds (review #10).** gameqa's test split is not unused:
- its README measured 300 seeds per split for bed statistics;
- `split` is only RNG salt;
- PREREG-NEED-V1 reserves test 8801–8848 for every bed.

At the freeze, register two ledger purposes in `research/jit-20261008/SEED-LEDGER.json`:
- `mem-dev`: dev 2101–2200, gameqa;
- `mem-heldout`: test 9501–9540, gameqa. That range is at least 8001 and clean for gameqa today.

Also record dev 2001–2090 as used host-side (MEM-0b payloads and MEM-0c). Every runner calls `assertSeedsAllowed`.

**Arms.** Every arm runs Haiku 5.5 through the repo's Claude CLI executor, with the model id from `policy/models.json` and the
CLI version pinned in the freeze (D32's rule). Every arm gets the same total env-step budget and the same total token cap per
task. **Every arm gets the same triage leads** (review #7): one quarantined Haiku call per task, with no tools, maps each
evidence item to an enum {likely_bug, by_design, stale, noise, injection} plus a bounded floor and subsystem. Its typed output
reaches every explorer through an edge, its cost is counted in every arm, and no explorer reads the raw evidence pack. The arms
then differ only in memory.

| Arm | Description |
|---|---|
| A0 | One explorer with the whole budget and the triage leads (the single-agent baseline) |
| A1 | K isolated explorers with a code partition of floors and leads, and plain edges: each returns its typed findings to a code merge node (**the simple baseline the board must beat**) |
| A2 | A1 plus one shared append-only notes file every explorer reads and writes (naive shared memory, N0) |
| A3 | A1 plus the board: `claims` (lww per floor and subsystem, with CAS), `findings` (setUnion of `{bug_class, repro_actions, description}`), `refuted` (setUnion) |

**Dedupe is scorer-side only (review #9).** The scorer counts unique confirmed bugs with the oracle, which credits each planted
bug once. No arm uses the oracle. In-arm dedupe, where it exists (A3's setUnion), keys on the canonical finding.

**How explorers reach the memory (review #8).** Explorers are multi-turn CLI sessions with MCP disabled
(`src/executors/claude-code.mjs:302-303`). A2 and A3 use **the same access path**, so that only the memory semantics differ:
- a small `board` command on the sandbox `PATH` talks to a per-task server the harness runs, holding a `Board` for A3 and a
  notes list for A2;
- identity comes from a per-explorer capability token that the harness puts in each sandbox. It never comes from the command's
  arguments, and an explorer cannot read another's token (separate sandboxes);
- every call is logged: explorer, call index, operation, `atSeq`, cursor and response hash;
- the harness labels each explorer's writes by its inputs: triage leads are trusted (quarantined), env observations are
  trusted, and nothing else is untrusted because no explorer reads the raw pack.

What holds on this path:
- declared writers and readers;
- kernel labels;
- CAS;
- fair pages;
- derived provenance (from the call log);
- a hash-chained log;
- "what did explorer X know when it wrote Y", from the call log.

What does **not** carry over:
- byte-identical prompt replay, because CLI sessions are not compiled by `compileContext` and not replayed by the ModelPort key;
- the `context.compiled` receipt, which the call log replaces.

A harness-driven loop of typed calls would keep those, but it would change the explorer away from A1's executor, so it is not
used.

**Stages.**
- **Stage 0, $0: the ceiling check (review §6).** Before any paid call, estimate how much of A1's work perfect sharing could
  save. Use scripted explorers on gameqa dev 2101–2120 under A1's code partition of floors and triage leads, with host-side
  truth for lead validity and planner step counts. The check measures:
  - duplicated test steps: two explorers testing the same lead or bug class;
  - idle budget from load imbalance, which work-stealing through `claims` could recover.

  If perfect sharing saves less than about 17% of A1's steps, the board cannot clear R-10 (§4.8). It is then killed without
  spending. **Not built yet.**
- **Stage 1: the pilot,** capped at **$5**. Two dev tasks, A1 and A2 only, one run each. It measures the real per-session cost
  and whether the executor path caches.
- **Stage 2: dev,** labelled dev. d3 and d4, 10 tasks each, k = 2:
  - A1 and A2 run first. If A2's per-dollar point estimate is not above A1's, stop: naive sharing shows no gain to capture.
  - Otherwise A0 and A3 run.
- **Stage 3: confirmatory.** `mem-heldout` seeds, n sized at the freeze (below), all four arms, k = 2.

**Metrics.**
- **Primary:** confirmed unique bugs per dollar, with triage cost included.
- **Secondary:**
  - precision (false reports over all reports);
  - duplicate exploration, from the call and env logs;
  - tokens per confirmed bug;
  - **poisoning rate:** false reports traceable to a decoy, stale or injection item;
  - pass^2 per task.

**Estimator and decision rule (review #16; frozen before any paid call).**
- **H1:** R = (Σ bugs_A3 / Σ $_A3) / (Σ bugs_A1 / Σ $_A1) ≥ 1.15. This is a ratio of sums over tasks, so a task with zero
  bugs in one arm is no problem. The CI is a paired bootstrap over tasks: 10,000 resamples, seed fixed in the freeze, 95%
  percentile interval.
- **H2:** A3's poisoning rate ≤ A2's, and A3 has 0 false reports traced to an injection text.
- **H3 (exploratory):** R(A2/A1) ≤ 1.
- **The falsifier.** If the lower bound of R is ≤ 1.0, or the point estimate is < 1.15, the board stays in `experiments/` and
  edges stay the default. **Either outcome goes into `docs/RESEARCH.md`.**
- **Power.** The freeze sets n_test so that the dev bootstrap's 95% half-width of log R, scaled by √(n_dev / n_test), is at most
  log(1.15) / 2 ≈ 0.07.
  - If that n exceeds the budget cap, the run is either re-approved or declared underpowered before spending.
  - An underpowered run supports no claim.
  - No K = 1 comparison is reported as proof.

**Cost [arith].**
- **Per arm-task:** an equal token cap per task, of roughly 6M input tokens, is $0.60 uncached and about $0.25–0.50 with
  caching. The pilot measures it.
- **Triage:** about $0.001 per task.
- **Total:**
  - dev: 20 tasks × 4 arms × k = 2 = 160 arm-tasks;
  - confirmatory: about 160 arm-tasks at n = 20;
  - about **$80–160**, with a **hard cap of $200**. Stage 2's stopping rule can end it at about $20–40.
- **No Mercury is needed.**

**Still to build, all $0:**
- the stage-0 ceiling script;
- the `board` command and per-task server;
- the gameqa multi-explorer harness;
- the triage node's enum schema;
- the per-arm call logging.

**Follow-ups (later, separate preregistrations, each needed before its scope is built).**
- **MEM-2, version notes.** On a recurring stream (an AutomationBench recurring family, or SOP-Bench *dev*), three arms:
  - no memory;
  - ACE-style free playbook accumulation;
  - admission with journal-bound replay proof and a sign test (§4.4).

  Each arm runs with and without 10% injected documents.
- **MEM-3, org currency.** On the org-twin slice, compare actions taken under a stale policy with bi-temporal `asOf` reads
  vs latest-only reads. This belongs to AMP's port.
- **Confidentiality.** Built when a bed with secrets exists, as a runtime label axis for edges, state and board.

---

## 8. Decisions and next steps

1. **Adopt "private by default", typed edges and state slots as the memory design (§0).** This is what the runtime already
   does. It costs $0 and changes no code.
2. **Keep the run board experiment-only.** It is wired only if MEM-1 passes R-10, and then as one engine bump after the v2
   merge (§5).
3. **Defer:** the scratch class, version notes (MEM-2), the org-memory stand-in (MEM-3, AMP) and the confidentiality axis
   (until a bed has secrets). Each needs its preregistered experiment first. The revision-1 code is in `8a42d7a5`.
4. **MEM-1 order:**
   - stage 0, the $0 ceiling, which may kill the board for free;
   - the $5 pilot;
   - dev with the A1-vs-A2 stopping rule;
   - the freeze (PREREG-MEM1, seeds registered, CLI pinned);
   - confirmatory.

   It runs only after the engine v2 merge and the frozen experiments now running.
5. **$0 follow-ups:**
   - the auto-memory canary (§4.7, about $0.01, once a budget allows);
   - executor memory directories in the X1 leak scan;
   - specifying the run-level declassification budget, the A14 residual.

---

## 9. Review response (revision 1 → revision 2)

Review of commit `8a42d7a5`. **A** = applied; **A+** = applied, with evidence that changes the review's number; **D** =
deferred by design. Every number below comes from the revision-2 runs in §5.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | major | The replay row was decided by a static flag; the baselines were re-run under a new schedule | **A.** Every design journals its own reads (`journal(r)`) and the replayed prompt is compared to the original: 0 of 200 differ for all five designs. Re-execution without a journal is reported for all five: N0 200, N1 184, N2 200, E0 0, board 200. The remaining difference is journal size (20 B vs 164 B). The circular `ReadsLatest` mutant is replaced by `ReplaysLatest`, which makes the journal replay differ |
| 2 | major | A loud refusal counted as a stopped attack | **A.** Availability loss is attacker success, measured on the compiled prompt against a no-attack control. Declared vs silent loss and "lost without an attack" are reported separately. The board now **keeps** the honest findings in A13 and A13b by fair paging, not by scoring. A13c is added to show where that fails |
| 3 | major | Toy payloads; the honest H2 is refused at real sizes; retries not counted; no paging | **A+.** Payloads are 360 real gameqa findings. The review's "150–250 tokens" is high: the measured median is 86, p90 172 and max 315. The defect stands, though: H2's 40 findings are 4,562 tokens. There are workloads at quota (H7), under the cap (H8), concurrent honest updates (H9) and reading-then-reproducing (H10). Retries are counted. Fair paging is specified and built (§4.3) |
| 4 | major | No E0 baseline (plain edges + state slots) | **A.** E0 runs the real `StateStore` and the real context compiler. The board's marginal gain is reported (§6.2): echo counting and paging; it loses H10 |
| 5 | major | Echo detection trusted self-reported sources and parsed only `event:<n>` | **A.** Provenance is derived from the board's read log and from a presented context receipt. `board:<t>@<n>` is ancestry over the events of t up to n, transitively and across compaction. A common external source counts once. There are tests for the omitted, receipt-form, presented-receipt and transitive-read forms, plus battery A12b and A12c and mutants M9–M12 |
| 6 | major | Version-note gate was self-reported, `sourceRuns` optional, +1 in 5 runs | **D.** Version notes are deferred to MEM-2, whose admission rule must require non-empty `sourceRuns`, journal-bound evidence and a sign test (§4.4) |
| 7 | blocker (freeze) | A3 changed both the board and the triage | **A.** Every arm gets the same triage leads through an edge, and triage cost is counted in every arm (§7) |
| 8 | blocker (freeze) | No access path for multi-turn CLI explorers | **A.** A `board` command with a capability token and a call log, shared by A2 and A3. The properties that hold and do not hold are listed (§7) |
| 9 | minor | A1's dedupe used the oracle | **A.** Dedupe is scorer-side only |
| 10 | minor | "The test split has never been run or read" was false | **A.** Corrected. New `mem-dev` and `mem-heldout` seed ranges go into the ledger at the freeze. **And**: revision 1's MEM-0c used dev 1–30 inside Kev's probe-pilot reserve. It now uses dev 2001–2030 and the old file is kept |
| 11 | major | Scratch, version notes, org memory and confidentiality were built without an experiment | **A.** All four were removed from the code and deferred. Only private-by-default, edges and state are adopted. One partial disagreement: version notes were immutable, so they did not breach D11's "no mutable cross-run store". Rule 12 alone is enough reason to defer them |
| 12 | minor | `verify()` and `root()` did not cover state or checkpoint | **A.** `verify()` re-derives the fold state and checks the checkpoint hash and the lineage; `root()` binds `statesHash` (tests, M17–M20) |
| 13 | minor | An invalid confidentiality level was refused as `BOARD_LABEL` | **Moot.** The axis is removed |
| 14 | minor | A14 sat in the denominator | **A.** It is reported apart |
| 15 | minor | Contradictory ratios and costs; a "capability table" heading; CLI version; APIsec nuance | **A.** One ratio basis (per-task medians), one cost ($80–160, cap $200), and the heading is now "Mechanism table". On the CLI: the help text was read from the image CLI 2.1.318, which is accurate, and D32's 2.1.312 pin applies to P1; MEM-1 pins its own. The APIsec nuance was checked on the page (MSRC: Moderate, then closed as defence-in-depth, no CVE; the bypass is conditional) and added to §2.4 and §6.2 |
| 16 | minor | No power analysis; the per-dollar ratio is undefined at 0 bugs | **A.** Ratio of sums, paired bootstrap, and n sized from dev variance (§7) |
| §1 | — | Efficiency was measured only against a strawman | **A.** MEM-0c prices the board against edges: +0.57% / 0.94% / 1.59% per session, which moves the bar to about 16.8% |
| §4 | — | Four test gaps (surviving mutants) | **A.** Two are killed (M22, M23); the other two were in deferred code. The mutation check is 25 of 26, and the survivor is equivalent |
| §5 | — | The `node_modules` symlink would be committed by `git add -A` | **A.** `.gitignore`: `node_modules` |
| §6 | — | A $0 ceiling test; pilot A1 vs A2 first; rebuild MEM-0b; trim the design | Rebuild and trim: **A**. Pilot order and A2 stopping rule: **A** (§7). Ceiling: **specified as stage 0, not built** |

**For `docs/RESEARCH.md`** (left to the orchestrator, to avoid a merge conflict), as negative results:
1. MEM-0b revision 1 was invalid as a comparison (§6.4).
2. A10 and A11: Foundry has no confidentiality axis on any path.
3. A13c: fair paging fails when declared writers × honest item size exceeds a page.
4. H10: conservative echo counting undercounts an honest reproduction made after a read.
5. A14: a quarantined judgment steered inside its enum.
6. Against plain edges a board read is pure added cost, up to 1.6% of a session at d5.

---

## Appendix A. Sources (all accessed 2026-11-04)

**Primary pages read [P].**
- PatchBoard. Zhang et al., arXiv 2605.29313: https://arxiv.org/html/2605.29313 (page dated 2026-09-23).
- Governed Shared Memory for Multi-Agent LLM Systems. Margalit et al., arXiv 2606.24535: https://arxiv.org/html/2606.24535v1 (2026-06-23).
- LLM-based Multi-Agent Blackboard System for Information Discovery in Data Science. Salemi et al., arXiv 2510.01285: https://arxiv.org/html/2510.01285v2 (v2 2026-01-31).
- Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture. Han & Zhang, arXiv 2507.01701: https://arxiv.org/abs/2507.01701 (2025-07-02).
- Terrarium. Nakamura et al., arXiv 2510.14312: https://arxiv.org/abs/2510.14312 (2025-10-16).
- Multi-Agent Memory from a Computer Architecture Perspective. Yu et al., arXiv 2603.10062: https://arxiv.org/abs/2603.10062 (2026-03).
- Mesh Memory Protocol. Xu, arXiv 2604.19540: https://arxiv.org/html/2604.19540v1 (2026-04-21).
- Latent Collaboration in Multi-Agent Systems (LatentMAS), arXiv 2511.20639: https://arxiv.org/html/2511.20639v4 (v4 2026-08-03).
- Query-Efficient Memory Injection Attacks on LLM Agents (AMIA). Tan & Zhang, Findings of EMNLP 2026: https://aclanthology.org/2026.findings-emnlp.1312/ (2026-10).
- The Misattribution Gap (Semantic Norm Drift). Ahad et al., arXiv 2605.22842: https://arxiv.org/abs/2605.22842 (2026-05).
- Cost and Accuracy of Long-Term Memory in Distributed Multi-Agent Systems. Wolff & Bennati, arXiv 2601.07978: https://arxiv.org/abs/2601.07978v1 (2026-01-12).
- Microsoft Agent Framework FIDES announcement: https://devblogs.microsoft.com/agent-framework/fides/ (2026-05-20).
- APIsec Research Labs, "Trust Me, Bro: Forging Security Labels in Microsoft's FIDES Middleware": https://labs.apisec.ai/research/articles/trust-me-bro-forging-security-labels-fides (datePublished 2026-09-01 in the page metadata; read 2026-11-04; re-read for the review response the same day).
- Anthropic, Effective context engineering for AI agents: https://www.anthropic.com/research/effective-context-engineering-for-ai-agents (2025-09-29).
- Anthropic, How we built our multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system (2025-06-13).
- Claude cookbook, context engineering (compaction, tool clearing, memory): https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools (2026-03-20).
- Claude Code docs, subagents: https://code.claude.com/docs/en/sub-agents ; agent teams: https://code.claude.com/docs/en/agent-teams (read 2026-11-04).
- OpenAI Agents SDK, context management: https://openai.github.io/openai-agents-python/context/ ; compaction session: https://openai.github.io/openai-agents-python/ref/memory/openai_responses_compaction_session/ (read 2026-11-04).
- LangGraph persistence: https://docs.langchain.com/oss/python/langgraph/persistence (read 2026-11-04).
- Letta shared memory: https://docs.letta.com/v1-sdk/memory/shared-memory (read 2026-11-04).

**Search and secondary summaries, not checked against the primary source [S].**
- MINJA (arXiv 2503.03704).
- A-MemGuard.
- AgentPoison.
- Memory poisoning attack and defense (arXiv 2601.05504).
- How Memory Management Impacts LLM Agents (arXiv 2505.16067).
- CaMeL (arXiv 2503.18813).
- FIDES paper (arXiv 2505.23643).
- Google ADK state: https://google.github.io/adk-docs/sessions/state
- Letta MemFS: https://docs.letta.com/concepts/memfs
- Zep facts: https://help.getzep.com/facts
- A-MEM (NeurIPS 2025, arXiv 2502.12110).
- Mem0 (arXiv 2504.19413).
- G-Memory (arXiv 2506.07398).
- MIRIX (arXiv 2507.07957).
- Collaborative Memory (arXiv 2505.18279).
- MemoryAgentBench (arXiv 2507.05257).
- ACE (arXiv 2510.04618).
- Chroma context rot: https://research.trychroma.com/context-rot
- Anthropic context management: https://www.anthropic.com/news/context-management
- MAST (arXiv 2503.13657).

**Repository [V].**
- Code: `docs/ROADMAP.md` §2.2, §2.9, §2.10; `docs/THESIS.md` §8 and D11; `src/context.mjs`, `src/state.mjs`, `src/journal.mjs`,
  `src/audit.mjs`, `src/engine.mjs`, `src/runtime.mjs`, `src/validate.mjs`, `src/executors/claude-code.mjs`,
  `src/models/providers/claude-cli.mjs`, `policy/models.json`, `schemas/workflow.schema.json`, `beds/gameqa/`.
- Prior designs: `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md`, `research/review-20261007/03-swarms-frontier.md`,
  `research/review-20261007/ROADMAP-AMENDMENTS.md` (R-10).
