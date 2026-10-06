# Raed's overarching thesis, and where Workflow Foundry fits

Everything below was gathered read-only. Line numbers were checked on 2026-10-06 against ARC `0ada3bf2`, AMP `codex/amp` `6df3056355` and WF `a1b7c2e`.

**Path key (absolute):**

| Short name | Path |
|---|---|
| ARC/ | /home/raed/.agentic-os/ |
| AMP/ | /home/raed/projects/amp/ |
| WF/ | /home/raed/Projects/workflow-foundry/ |
| NC/ | /home/raed/Projects/work-end-to-end-on-neural/ |
| NCF/ | /home/raed/Projects/neural-core-friend-package/ |
| PC | AMP/source/docs/PRODUCT-CONTRACT.md |
| CS | AMP/source/docs/CURRENT-STATE.md |
| OA | AMP/source/docs/handoffs/2026-09-24-cognition-obligation-appendix.md |
| AND | AMP/source/docs/docsfornewdudes.md |
| RND | ARC/docs/docsfornewdudes.md |
| BT | ARC/research/2026-09-25-amp-brain-thesis-and-jev-bus.md |
| DB | ARC/research/2026-09-25-amp-defense-brief.md |
| 3W | ARC/docs/bridge-program/2026-08-11/ARC-CLIDE-THREE-WEEK-LAUNCH-HANDOFF.md |
| TD | ARC/CONTRARE_ARC_DEEP_TEARDOWN_AND_SOTA_AUDIT_2026-07-07.md |
| RM | WF/docs/ROADMAP.md |
| RL | WF/docs/RESEARCH.md |
| DOS | WF/research/dossiers/arc-existing.md |
| MEM | /home/raed/.codex/memories/memory_summary.md |

**Source caveat:** the `ARC/research/2026-09-2x` files were written by an agent ("Buffy for Raed", ARC/research/2026-09-25-minimum-proof-plan.md:4). They quote the owner but are not registered ARC canon.

## 1. The thesis and the components

**The thesis in one paragraph.** Agents mostly fail because of a *world-and-memory* problem, not a lack of model intelligence (DB:16-20). So keep a fixed LLM as the reasoning nucleus: "we need an llm, we just need to make the surrounding insanely good" (MEM:13). Around it, build a local-first, evidence-governed "brain and nervous system around the model, so the context window stops being the memory and becomes the workbench" (BT:116-118). The boundary rule is: "substrate determines what is admissible; the model proposes; Jev ranks/chooses within the admissible; code commits; the witness verifies" (BT:32-35). Hosts own effects and completion. One canonical writer owns memory. Every claim must climb EXISTS→REACHABLE→DEFAULT-LIVE→OBSERVED→CAUSAL→PRODUCT-PROVEN (ARC/CODEX.md:64-74; PC:276-278).

The goal is frontier-class outcomes from a small local model through "harness brilliance (not bigger weights)" (ARC/README.md:9-11; RND:204-209). The product should get better the more it is used ("memory + taste + skills accrue", ARC/research/2026-09-25-amp-complete-product-implications.md:100-103). Later comes a learned faculty that builds its own methods (NCF/docs/NEURAL_CORE_PROGRAM.md:3-9).

| Component | Role in the owner's terms | Evidence |
|---|---|---|
| ARC + CLIDE | Local 9B intelligence/execution system. Keeps protected intent, effects, promotion and completion. CLIDE is the product surface over the same runtime truth. | RND:85-104,110-115 |
| AMP / Hippocampus | Standalone memory/cognition backbone and the only canonical writer: admission, currentness, retrieval, contradiction, soft defaults. | PC:21-29; AMP/source/README.md:3-6 |
| Jev | Typed "thalamic filter" for bounded choices J1–J15, including skill and tool nomination. Runs in shadow and never holds authority. | BT:22-27,43-59; PC:1000-1010 |
| Neural Core | Learns to construct and revise "cognitive programs". | NCF/docs/NEURAL_CORE_PROGRAM.md:37-45 |
| Foundry | "Explicit, external procedure layer". The host owns capabilities, evidence and approvals; the agent constructs a typed workflow. | WF/README.md:8-13; RL:42-54 |
| Holt | Shipped worktree-integrity tool ("a product of Contrare Research"). Used as a deletion gate in ARC and AMP. | /home/raed/.npm-global/lib/node_modules/holt/README.md:3,32; ARC/AGENTS.md:35-37 |
| COS (Chat On Steroids) | ChatGPT-facing plugin plane for coding quality. It is a host/channel, not a part of the thesis. A COS worker built Foundry's one success. | ARC/cos-code-stack/STACK_STATUS.md:1-13; WF/research/checkpoint-20260917/REPORT.md:9 |
| WakePoint / GeoWake | Unrelated transit-alarm app. The "arc" hits are route arc-length geometry. | /home/raed/Projects/WakePoint/README.md:1-5 |

**How they compose.** The owner's own wording: "Foundry is the procedure, ARC provides authority and durability, AMP supplies context, and the Neural Core is the future learned architect" (RL:160).

ARC was the "proto-brain". AMP is its externalized organ system, and reconnecting the two (AMP work packet E15, future ARC/Neural Core adapters) is deliberately deferred (BT:111-115). Neural Core also grew out of ARC's master document (NC/docs/RESEARCH_STORY.md:5). So the owner's recurring move is: **extract an organ, make it standalone, reconnect later through one port** (PC:26-29,387-391,503-507). That matches the mentor's assignment, "pick ONE component, externalize it, make it work with other agents" (ARC/research/2026-09-26-mentor-meeting-answer-key.md:7-11).

## 2. Where procedural knowledge lives today

| Location | What exists | Status |
|---|---|---|
| ARC developer skills | `.agents/skills`: 35 pinned + 13 project bridges + 1 deprecated, plus 4 K-Dense skills "flagged undeclared" (ARC/docs/PROJECT_OPERATING_CONTRACT.md:64-99; ARC/docs/SKILL-PACK-MANIFEST.json:64-76) | Agent-facing, not runtime |
| ARC runtime | `skills-registry.mjs` (its header still says "AirMentor Skills Registry", :1-19) feeds a BM25 `skill-router.mjs` | Off by default, "No live daemon caller" (ARC/scripts/skill-router.mjs:1-3,39-51) |
| ARC design | Workstream W8 (operator layer) and W9 (skills as "planner macros… counter-triggers and contribution evidence") (ARC/docs/canon/ARC-CLIDE-INTENT-MAP.json:203-217); PlanGraph V1 node kinds (ARC/scripts/plan-graph-v1.mjs:1-28) | W8/W9 design only |
| ARC memory | Memory scopes leave out "procedural" (ARC/scripts/governed-memory.mjs:119); "procedural memory: fragments… no unified promotion consumer" (3W:217) | Not live |
| AMP | Procedural memory kind (OA:111-117); `amp_propose_pattern` and `amp_propose_instruction` with `use_skill` (AMP/source/clients/python/src/hippocampus_client/mcp_server.py:252-262,278-283); capability registry (PC:401-407); AMP "externalizes… learned reusable procedures" (AMP/source/docs/design/complete-cognition-loop.md:12-14,89) | "Mostly hollow… retrieval… has been empty" (AND:949-951) |
| Foundry | Typed IR, content-addressed library with compare-and-swap (CAS) but no search or ranking (RM:51), 14 skill packs installed into 5 clients (WF/README.md:111-116,138); planned harness library with performance records and a success-predicting surrogate (RM:205-208), and "workflow-pattern memory" (RL:159) | Library partial |
| Neural Core | Nine-pattern grammar, Frame…Reflect (NCF/docs/NEURAL_CORE_PROGRAM.md:13-27) | Research |

**Conflicts and overlaps**

1. **Procedural memory has two claimants.** AMP (obligations I35–I37, Patterns, "skills accrue") and Foundry (performance records plus surrogate) both claim it. Foundry's roadmap points AMP Patterns at harness hashes but leaves the boundary as owner decision D3 (RM:100,419).
2. **Workflow representations keep multiplying.**
   - ARC already has at least four control representations, each with a different meaning of "success" (DOS:15-19,91-99). It also says "ARC compiles its own typed bounded workflow" (3W:816-818).
   - AMP has `CognitiveRecord::Plan` (AMP/source/docs/ACTIVE-PLAN-GRAPH.md:20).
   - Foundry adds its own node kinds (task/assert/human/map/loop/wait) with different join semantics (WF/docs/ARCHITECTURE.md:39-44).
3. **There are three capability/skill registries,** each with its own authority story.
4. **Routing has three claimants.** Foundry's router (RM:24,210-221) conflicts with its own non-goal of "a model router" (RM:107). ARC routes through `selectSpecialist` (RM:99). AMP routes through Jev J3/J4/J13 (BT:47-48,57).
5. **Jev.** Foundry plans its own Jev judgments (WF/README.md:81). AMP requires "the existing typed-evaluation boundary, not a parallel controller" (PC:1000-1003).
6. **Naming collisions.** ARC already has a "Semantic oracle foundry" (3W:212). "Pattern" means three different things across AMP, Neural Core and Foundry.
7. **The relationship is one-sided.** Neither ARC nor AMP docs mention Workflow Foundry (grep found zero hits). AMP explicitly excludes the ARC/Neural Core adapters from its completion target (AMP/source/docs/handoffs/2026-09-24-complete-cognition-successor-handoff.md:7,111).

## 3. What AMP and ARC would demand of a procedure layer

**AMP**

1. No fallback stores. A new index or model output must not become a second authoritative store (PC:21-24; OA:55-61; AND:134-136).
2. Memory supplies evidence, never authority. A name, file, past success or preference cannot create tool permission (PC:367-372,401-407).
3. Obligation I35: each procedure needs a trigger and counter-trigger, preconditions, steps, predicted effects, costs, a falsifier and the exact skill body and version, plus proof that it was actually applied (OA:279-285). Activation must bind to the current file body. Name matches, wrong versions and "considered, not applied" must fail as negative controls (AND:887-912).
4. Transfer is directional (A→B is a separate claim from B→A). Arms are assigned before an offer is made. Failed lessons are narrowed or retired (OA:263-301).
5. Reuse history keeps the public rationale, producer and model metadata, outcomes, failure conditions and alternatives. No hidden reasoning, and no universal rule from one success (PC:325-329).
6. Corrections must reach "procedures and controller caches" (OA:255-261).
7. Qualification dimensions stay separate. Producer reliability is only a ranking prior (OA:95-101; PC:76-78). So a Foundry surrogate cannot gate applicability.
8. Past reproducibility is not present validity (PC:56-59). A reused harness must be requalified in the current world.
9. Integration happens through canonical goal/task/plan identities, via "one injected port and one event identity" (PC:26-29,704-710).
10. One small MCP surface with task-directed discovery (PC:903-917).
11. At least 6 runs per arm (K_rep≥6), including a "without the tested feature" arm (PC:256-263), and the whole loop must be proven together (OA:503-509).
12. Usefulness beats ceremony: "a system that passes guards while ordinary agents cannot accomplish work fails acceptance" (PC:1151-1153).
13. Untrusted text inside inputs needs span-level provenance. AMP's own 10-06 log has a high-severity finding where verbatim quoting carried pasted tool output into an actor's action (AMP/experiments/self-hosting-20261006/FINDINGS.jsonl:2).

**ARC**

1. There are two authority ladders, and a finding cannot rewrite protected intent (ARC/CODEX.md:48-79).
2. TaskRuntime is the sole lifecycle owner: "Do not create a second lifecycle owner or a parallel graph checkpoint authority" (3W:836). External engines get no completion authority (3W:816-818).
3. Models propose graphs. Only TaskRuntime/EventKernel admit transitions (ARC/scripts/plan-graph-v1.mjs:1-7).
4. New procedures run as sealed shadow events with poison, wrong-polarity, irrelevant and leave-one-out controls before they get any influence (ARC/CODEX.md:113-118; RND:567-570).
5. An operator needs a case where it should not fire. A new skill needs a failure mode, a non-overlap mapping, an owner, a test and a retirement condition (RND:588-589,614-615; ARC/docs/PROJECT_OPERATING_CONTRACT.md:143-151). Generated skills remain proposals (3W:819-820).
6. Oracle pass law: a five-cell control matrix with unique attested receipts. Effects are written ahead, reconciled when in doubt, and never blindly rerun (3W:650-671).
7. Domain skills supply methods, never answers (RND:275-286).
8. MCP servers come from an allowlist (RND:975-999). A new mechanism must beat the simplest adequate baseline (RND:357-365).
9. The local 9B is the model floor (RND:303-323). Foundry's only success used a "model 6, reasoning pro" builder (WF/research/checkpoint-20260917/REPORT.md:9).

## 4. Maturity snapshot

| | Works end to end today | Still design-only or open |
|---|---|---|
| ARC | Prompt → TaskSpec → TaskRuntime → repository probe → candidate → sealed 5/5 oracle (opt-in profile), stopping at "supported-not-applied" (3W:40-46,191-195) | Effect/promotion transaction "not installed" (ARC/scripts/product-task-terminal-bridge-v1.mjs:230-232); "governed memory is empty" (ARC/docs/PROJECT_OPERATING_CONTRACT.md:33-36); "library-grade", headline benchmark retracted (TD:5,168-177) |
| AMP | Installed daemon, single writer, workspace capsules, context compile, 34 `amp_*` tools, `host_supervisor.py` | **0/72 obligations accepted** (CS:8-20); "Canonical effect witnessing is unavailable" (CS:1608); `amp_context` timed out at 30 s (CS:67-68); no joined A→B learning (CS:2288) |
| Neural Core | Measurement instruments; a bounded 7/7 retention witness | Learned lifecycle 0/16 vs classical 16/16 (checkpoint 027); 3, 5, 0 and 5 out of 16 vs a 14/16 gate (checkpoint 028) (NC/docs/RESEARCH_STORY.md:35); 0/32 (checkpoint 036) (NC/docs/READINESS_ASSESSMENT_20261005.md:56); latest pilot never executed (NC/START_HERE_NEXT_AGENT_20261006.md:7-9) |
| Foundry | IR, SQLite runtime, MCP, UI. 609 tests: 595 pass, 10 fail from environment drift, 4 skip. One outcome repair scored 98/98 vs 80/98 (WF/README.md:28-58) | Fault and expectation were supplied; no agent or call node; no router; ARC/AMP integration "Documented only. No code" (RM:43-59) |
| Jev | J1–J3 in shadow; source-selection sufficiency 2/16→3/16 | Jev-enabled AMP 0/2 on narrow repair, single-run (CS:26-28,2286) |

## 5. Patterns that repeat across projects

**Failure modes**

1. **No learned or semantic layer has yet beaten a simple or host-side baseline.**
   - AMP: the Jev-enabled arm scored 0/2 (CS:25-35).
   - Foundry: the skills arm produced 0/21 with 21 false successes, and "the gain belongs to **host-side evidence enforcement**" (RL:97-98).
   - Neural Core: classical controls dominate.
   - ARC: harness lift "currently UNMEASURED" (TD:175).
2. **The hard decision gets supplied by the researcher or host.** Neural Core admits this directly (NC/docs/RESEARCH_STORY.md:41). In Foundry the outcome contract is something "the host authors" (WF/README.md:69-71). In ARC, gold patches leaked into the task (TD:172-175).
3. **The effect "last mile" is unfinished in all three systems**: ARC's P0 (3W:214), AMP's native witness (CS:2549-2551), Foundry's "THIN" real-world verification (RM:58).
4. **Proof plumbing displaces usefulness.** AMP's own diagnosis says so (CS:2296-2297,2368-2373), and ARC's teardown names the "computed-but-unused-on-live-path" pattern (TD:201). Scale indicators:
   - CS is 3,180 lines, despite AMP's own rule against ever-growing files (AMP/source/docs/README.md:5-6).
   - AMP has had 81 worktree registrations, now 62 (AMP/MAINTENANCE-RESULTS.md:18-24).
   - ARC requires a finding every turn (ARC/CODEX.md:132-149).
5. **Scope keeps growing.** AMP carries 72 obligations and a ~50-language target (DB:81-84). Foundry's roadmap adds a surrogate, MCTS and an outer optimizer (RM:138-152) before its agent node exists.
6. **"Brains accumulate"** (RND:362-363), alongside skill-hygiene incidents (RND:35,610-611).

**Strengths worth reusing**

- **Shared discipline.** All four projects use the same maturity ladder and K≥6 preregistration (PC:256-259; RM:251,334; NC/docs/FORWARD_PATH.md:15-27).
- **Authority boundaries.**
  - Separation of powers: hosts own effects, models propose, contracts decide (DB:40-50).
  - Content addressing, CAS and version-bound proposals.
  - Uncertain effects are never retried (WF/README.md:189-191).
- **Honest evidence.**
  - Mutation-controlled independent oracles (3W:654-671).
  - Preserved negatives and self-retraction.
  - Foundry's best-validated finding, that host-side contracts carry the gain, matches ARC's oracle law and AMP's witness. **The contract layer is the asset all three share.**

## 6. The integration question

**If Foundry is built independently first and adapted later, this breaks or is lost:**

1. **Evidence joins.** AMP only accepts exact identity joins, and "separate passing episodes cannot be assembled into a joined pass" (CS:2955-2961). Runs without ARC/AMP identities would never count as learning or transfer evidence and would have to be rerun.
2. **Memory migration.** The library would become a second procedural store (OA:55-61). A later import loses its standing, because an importer "cannot mint… verified truth" (PC:31-34,211-219).
3. **Workflow-format drift.** Planned agent/call/search/expand nodes (RM:175-192) would either force adapter refusals (WF/AGENTS.md:50-51; DOS:237) or require ARC to grow new node kinds. Edge semantics already mismatch (DOS:298, requirement arc-03).
4. **Neural Core training data.** Logs without credit labels break its rule to keep learned, supplied, teacher, oracle, verifier and host contributions separate (NCF/docs/NEURAL_CORE_PROGRAM.md:60).
5. **Authority leaks.** A standalone "satisfied" result could later be read as task completion.
6. **Tool-catalog burden.** A second 20-tool MCP surface conflicts with AMP's one-MCP target (PC:903-912).

**If Foundry is built against ARC/AMP from day 1, this slows or is risked:**

1. Foundry inherits their open blockers: ARC's P0 effect transaction and empty memory, AMP's open end-to-end journey (G2) and hollow Patterns.
2. AMP's 2.6–19 s compile time (RM:91) would confound Foundry's headline hypothesis H0, "≥30% cheaper" on follow-up tasks (RM:265).
3. The cloud session the roadmap plans to use cannot read ARC or AMP (RM:7,111-115).
4. It would import ARC's canon/hygiene ceremony.
5. It contradicts the owner's own sequencing: AMP standalone first, ARC later (PC:387-391,503-507; DB:171).
6. A standalone arm is required as a baseline anyway (PC:261-263).

**My assessment:** keep Foundry standalone at runtime, but integrate it at the contract level from day 1. This repeats how AMP was built. It also honors "Reuse existing organs/OSS before parallel machinery" (MEM:12) by reusing ARC/AMP *contracts and conformance fixtures*, not their unfinished runtimes. Foundry's own evidence argues for shipping the contract layer plus one witnessed micro-harness first. The router, MCTS and outer loop should come later.

**Minimum shared contracts to fix now** (these are expensive to retrofit):

1. **Identity envelope.** Every workflow, run, outcome and decision carries Foundry hashes plus optional ARC TaskId, TaskSpec digest and event cursor, and AMP project, capsule, goal, attempt and context-receipt IDs (PC:26-29).
2. **Outcome/authority vocabulary.** Map Foundry's states onto ARC's supported/refuted/unresolved and its in-doubt effect state (3W:607-671), and onto AMP's transition and verification states (OA:63-69,247-253). Every output carries `grantsActionAuthority:false` and `establishesCompletion:false`, as AMP already emits (AMP/source/clients/python/src/hippocampus_client/__init__.py:514).
3. **Procedural split (D3).** Foundry owns immutable harness artifacts and raw runs. AMP owns the claims about them: Patterns keyed by harness hash, with I35 fields (mcp_server.py:252-262). Foundry's library ranking is only a prior.
4. **Effect + oracle port.** One interface that Foundry's native runtime, ARC's `runEffect` and AMP's host witness can all implement, with independence labels and five-cell controls.
5. **Versioned decision/trace schema.** Public rationale only, credit labels, privacy exclusions and untrusted-span provenance. It doubles as Neural Core's data spec (RM:92,213).
6. **Pinned skill packs.** Packs carry ARC's admission metadata and AMP's body digests (ARC/docs/PROJECT_OPERATING_CONTRACT.md:143-151; AND:887-891).

These can wait:
- **Compiling to ARC's PlanGraph.** But adopt "requires-success" vs "after-settled" edge semantics and a refuse-list now.
- **Router, surrogate and MCP consolidation.**
- **Jev**, as long as it sits behind a judgment port that respects PC:1000-1010.

Fix the "foundry" and "pattern" glossary as well, and record D3/D4 in ARC and AMP canon, because today neither canon knows Foundry exists.
