# Every idea in the session, one per line, in the order the owner raised it (2026-11-04)

The numbers in brackets are the owner's messages, as extracted from the session transcript (132 of them); [today] marks
the messages from 2026-11-04 evening.

**Status codes**
- **✅** done, or measured positive.
- **◐** partial.
- **❌** measured negative.
- **🔧** built, not measured.
- **📐** designed only.
- **⏳** running now.
- **⬜** not started.
- **➖** dropped or superseded.
- **💬** a question, answered.

Evidence and numbers are in IDEAS-AND-STATUS.md and WHY-NOT-HIGHER.md.

| # | Idea (owner's words, shortened) | Msg | Status | Evidence / what is left |
|---|---|---|---|---|
| 1 | Bounded, typed, task-scoped workflows (micro harnesses) that agents construct per task | [1] | ✅ | Engine. Sealed SOP-Bench 87.6% against an agent's 67.1%. Held-out AutomationBench 29/60 against 9/60 |
| 2 | Run durably | [1] | ✅ | Conformance 11/11 (LangGraph 1 of 8); chaos 35/43 |
| 3 | Adapt while running | [1] | ◐ | FH-1 heal 75% (dev); sub-workflows win when the parent decides. DUR-1 stopped at its fail-closed gates and is being written up |
| 4 | Verify against locked contracts | [1] | ✅ | Verify nodes, hash-pinned graders, tri-state verdicts |
| 5 | Keep a workflow only when reuse pays; disposable by default | [1] | ◐ | C2: the conformance gate is safe; the profile gate scores 85% against 98% |
| 6 | Code owns procedure; models make narrow typed judgments | [1] | ✅ | P1 records: Haiku workflow 35/36 against one Sonnet call 28/36 |
| 7 | Cheap models execute what frontier models author | [1] | ◐ | JIT 22/24 against Opus 24/24 (dev); SOP-Bench |
| 8 | Do not build a meta-harness, offline optimiser, general agent loop, visual builder, memory store, model gateway, or LangGraph/n8n clone | [1] | ✅ | Kept |
| 9 | Phase 0: Node 24, environment probe, OpenCode pin allowlist, recorded skip reasons | [1] | ✅ | Done 10-06 |
| 10 | A model policy file; assignments justified by measurement | [1] | ✅ | `policy/models.json` |
| 11 | A running cost ledger in the README | [1] | ◐ | It exists, but is not current for every run |
| 12 | Ask before any experiment over $500 | [1] | ✅ | None reached it |
| 13 | Kev as the open judgment engine, fine-tuned, live only after beating baselines | [1][16][17] | ❌ | Stock Kev ≤ the rule baseline on 4 of 5; fine-tuning not run |
| 14 | Use Jev if a key exists | [1][55][73] | ➖ | Dropped (D26) |
| 15 | Pull data and models within disk; push heavy compute to Modal/Harbor | [1] | ◐ | Downloads done; no remote compute credentials |
| 16 | No ARC/AMP integration; contract-level ports only | [1] | ✅ | Kept |
| 17 | Keep ENGINE_DRIFT strict | [1] | ✅ | Engine identity and binding |
| 18 | Delete the LangGraph/n8n export adapters (my call) | [1] | ✅ | Done in phase 0 |
| 19 | Reuse OSS with pins, licence, URL, SHA; never run install hooks | [1] | ✅ | Practice (corpus manifests, conformance lock) |
| 20 | Claims C0–C5 against baselines B0, B0+N, B1, B2, B5 and a hand-written ceiling | [1] | ◐ | **B0+N (notes) and B2 (memory/skills) never run** |
| 21 | Metrics: verified success, pass^k, cost per verified success, time to first workflow, reuse/deopt/wrong-reuse rates | [1] | ◐ | Time to first workflow not reported systematically |
| 22 | Claude Code dynamic workflows as a tool and as baseline B1 | [1] | ◐ | Used as a tool; B1-style arms in E8 |
| 23 | Procedure distillation: frontier-authored workflow, cheapest qualified model per node | [1] | ◐ | JIT; tier-down holds on leaf judges only (held-out saving 2.8%) |
| 24 | Failure handling: classify → intervene → patch → replay, against retry and regenerate | [1] | ✅ (dev) | FH-1: 75% against retry 0% and gated regenerate 27% |
| 25 | R05 benchmarks: ARC-AGI-3, TextWorld/MiniHack/BabyAI, IDoFT, AppWorld, τ²/τ³, SWE-bench Pro, Terminal-Bench, τ^τ | [1] | ◐ | AppWorld adapter only; the rest ⬜ |
| 26 | Our own beds where none fit, each with known-good and known-bad controls | [1] | ✅ | records, incident, kinetics, codefix, E7, E8, golive, gameqa, SPEC-0, NC-1 |
| 27 | Game build QA: visual passes, explorer personas, playback/repro/minimise | [1] | ✅ (dev) | GQA-1: 6.4 against 4.4 bugs per run |
| 28 | Scientific pipelines, data repair, research synthesis, creative/media, ops runbooks, web QA, puzzles | [1] | ◐ | Ops, data and science-like beds exist; creative/media, puzzles and research synthesis ⬜ |
| 29 | Hold out whole domains; sealed tasks by a separate author | [1] | ◐ | SOP-Bench sealed; most product claims still rest on same-author sets |
| 30 | A licence-tracked corpus of real workflows (n8n, Zapier, GH Actions, Airflow, nf-core, ComfyUI, HA, Shortcuts, Dify) | [1] | ✅ | Built; coverage measured |
| 31 | Use the corpus for construction tests, IR expressiveness, operator mining | [1] | ◐ | CI-1 ✅; operator mining partial |
| 32 | Follow the roadmap phases, each ending with a capability number and a report | [1] | ◐ | Phases interleave |
| 33 | About 20% on frontier bets with kill rules | [1] | ✅ | JIT, Δ\*, verifier lab |
| 34 | Use subagents and parallel workflows; adversarially verify | [1] | ✅ | Practice |
| 35 | Preregister, seal splits, lock graders, verify before storing, no K = 1 claims, gaps under 3 points are noise, keep negatives, record costs | [1] | ◐ | Much is still labelled dev K = 1 |
| 36 | README as the single entry point, with an owner-decisions section | [1] | ◐ | Updated today |
| 37 | A branch per phase, small PRs, never force-push main | [1] | ◐ | One session branch, PR #1 |
| 38 | Credentials only from environment variables; never log secrets | [1] | ◐ | Two incidents (the account e-mail in journals); redacted, and a scan blocks it now |
| 39 | Stop and report on a falsifier, the spend cap or rate limits | [1] | ✅ | Practice |
| 40 | Check the VM and what it can run | [3] | ✅ | Environment report |
| 41 | Autonomous installs and setup | [4] | ✅ | — |
| 42 | Billing: subscription or card | [7–14] | 💬 | Subscription |
| 43 | Drop local models (too slow); use Haiku | [16] | ✅ | 268 s per call on CPU |
| 44 | Analyse Kev deeply for quick semantic decisions | [16] | ✅ | Analysis done; negative result |
| 45 | Fine-tune Kev 0.8B for every creative need | [17] | ⬜ | Not run |
| 46 | A bridge from the cloud session to the laptop (RTX 4060) | [18][19][21][32][33][41] | ✅ | Bridge built and hardened (F1–F5) |
| 47 | Haiku 5.5 is the cheap model | [20] | ✅ | Adopted |
| 48 | The best possible workflow for any task; what is the template format? | [22] | 💬 | Foundry's own typed IR |
| 49 | Represent any and all workflows (~94%); a mini harness, not a harness | [23] | ✅ | Coverage; reject rather than flatten |
| 50 | Parallel workflows working together in AMP later | [23] | ⬜ | COMP-1 composition inconclusive |
| 51 | Measure whether a task needs a workflow, across the complexity spectrum, with a sensitivity slider | [23] | ◐ | ROUTER-1: code router ❌, Haiku direct 5/132; slider ✅ |
| 52 | Haiku constructs from templates; tell it everything it needs | [23] | ◐ | BUILDER-1 18/21; skill pack built |
| 53 | Rust port? | [23] | 💬 | No |
| 54 | Missing workflow constructs; deep worst-case analysis | [23] | ✅ | Worst-case catalogue; chaos suite |
| 55 | A workflow inside a workflow inside a workflow; iterative flows | [23] | ✅ | Nesting depth 6; loops |
| 56 | Node visualisation: breathing dots, state colours, live update, click to expand the chat | [23] | ◐ | Owner's UI (D33); the run-graph data routes are built |
| 57 | Swarms (Kimi), Claude Code dynamic workflows: in scope? | [23] | ❌ (dev) | Swarm lead delegated 0 of 8; tied a single agent |
| 58 | Subagent spawning inside nodes | [23] | ◐ | Agent nodes; SW-1; nodecap |
| 59 | A shared message board, shared state, private notes | [23][75] | ◐ | Memory study: small gain; state slots exist |
| 60 | Auditability and efficiency as first-class | [23] | ✅ | Journal, hash chain, verify-run |
| 61 | Every component maximally efficient; check frontier research and OSS | [23][102] | ◐ | Compromise register; waves 1–2 done |
| 62 | Add the agent-framework corpus (LangGraph, CrewAI, AutoGen, …) | [24] | ✅ | Task 19 |
| 63 | Report declared, compiled and executed tiers | [24] | ◐ | Partly |
| 64 | Infinite processes as triggered runs; depth limits; loop caps | [24] | ✅ | — |
| 65 | Are these toy workflows? Train a small LLM to pick nodes and templates from the corpus | [28] | ◐ | Retrieval chosen first (CI-1 81–93%); composer ⬜ |
| 66 | Recreate niche custom-built workflows cheaply, and improve them | [29] | ◐ | CI-1 n8n items; replication streams; E8 |
| 67 | Is our approach cheaper and more durable? | [34] | 💬/◐ | SOP-Bench $0.00055 against $0.0017 per run |
| 68 | A UI for past runs, messages, timeline, summaries | [35] | ✅ | Run-history UI; run-graph data |
| 69 | Can Haiku cheaply build what Opus one-shots? | [35] | ◐ | Not as raw IR (11/16); yes with a practice loop (14/14 against Opus 5/14) |
| 70 | Never give up; attack ideologically and creatively; a 3-day timeline | [43] | ✅ | ATTACK, dossiers, gap sweeps |
| 71 | JIT compiler: what and why | [44] | 💬/✅ | Built |
| 72 | Don't spend effort on mobile | [47] | ✅ | — |
| 73 | Be relentless; remember every operating rule | [49] | ✅ | — |
| 74 | Train a small model to compose using the corpus and Foundry syntax | [50] | ⬜ | Task 40 |
| 75 | Build the worst-case most complex workflow, compare it with the real hand-crafted one, find flaws by running, self-heal to a state at least as good as the human's | [50][117] | ◐ | Replication streams; DUR-1 stopped at its gates; not shown |
| 76 | Are we missing anything ideologically? | [51][80][82] | ✅ | ATTACK, WHY-NOT-HIGHER |
| 77 | Reuse means the same workflow in a separate program | [52] | ◐ | C2 |
| 78 | Simulate the work inside a complex workflow | [53] | ✅ | Practice worlds, E8 worlds, AutomationBench bridge |
| 79 | No new workflows (usage) | [53][63][87][127][132] | ✅ | Kept (since then, the owner's ultracode opt-in) |
| 80 | Commit everything; resume locally | [54][95] | ✅ | Rescue bundles |
| 81 | Model tiers (Opus xhigh main, Sonnet, Fable rare, Haiku cheap); swarm; Exa/OpenAlex; niche prior art; build from scratch if needed | [55] | ✅ | Practice |
| 82 | Compare against the best proprietary and OSS workflows; the most complex org workflows; openui for node widgets | [56] | ◐ | E-bed, OT-0; openui ➖ (UI is the owner's) |
| 83 | Fine-tune a small model for building, or get Haiku good enough? | [61] | 💬 | Templates, retrieval and the practice loop first |
| 84 | The goal: build a workflow before the agent does the task; decide when one is needed; testing is the biggest part | [67] | ◐ | ROUTER-1 |
| 85 | Haiku with world feedback | [71] | ✅ | Practice loop |
| 86 | Give the builder templates and the hardest enterprise patterns | [72] | ✅ | CI-1 retrieval |
| 87 | How long to build cheaply and accurately? | [72] | ◐ | Per bed (E8 builds $0.39) |
| 88 | A tracker of the user's conditions, checked against the build | [72] | ✅ ⏳ | Held-out: 37–40 bad builds caught, against 2 without it; merging |
| 89 | Builder compares robustness against enterprise patterns | [72] | ◐ | — |
| 90 | Enterprise workflows (payments, Jira, employees) built correctly | [72] | ◐ | E8, E7, OT-0 |
| 91 | Realistic mocks with a real model working inside, to find complex flaws | [75] | ✅ | — |
| 92 | An agent inside a node realises it needs a sub-workflow and creates it | [75] | ◐ | Node-decided 6/32, no gain; parent-decided 27–32/32 |
| 93 | Don't dumb down the model's efficiency | [75] | ◐ | — |
| 94 | Route tasks to agents and models automatically, with user control per node | [75] | ◐ | Class routing and per-role models; UI is the owner's |
| 95 | A fine line between autonomy and control | [75] | 💬 | Principle |
| 96 | AutomationBench: useful? Adapt it | [76][77] | ✅ | Official bridge plus recurring variants |
| 97 | Primitives → a formula, tuned so non-workflow tasks never trigger | [79] | ❌ | Code router failed on held-out; D28 bound instead |
| 98 | Proof across the board on the hardest realistic cases | [79] | ◐ | — |
| 99 | Publish an AutomationBench score | [79] | ⬜ | Needs the owner's "publish" |
| 100 | Routine coding needs no workflow; startup CI/CD, OSS maintenance and a research program might | [80] | ◐ | Router families |
| 101 | Clone and deconstruct the OpenScience and K-Dense harnesses | [80] | ✅ | Task 66 |
| 102 | Nodes get every skill, MCP server and connector they need; a skill/plugin finder and creator; exactly what they need | [80][105] | ✅ (dev) | Node capabilities merged; finder partial |
| 103 | A node builds its own sub-solution, or asks the governing harness? | [80] | ✅ | SW-1: the parent decides |
| 104 | Haiku recreating the OpenScience harness; cheap, dynamic, self-healing micro harnesses | [86] | ◐ | — |
| 105 | Monetisation: what orgs pay for; Foundry first-class in ARC/AMP | [86][123] | 📐 | Business documents |
| 106 | Why not 90%? | [93] | 💬 | WHY-NOT-HIGHER |
| 107 | The frontier is Opus 5.5 or GPT Astra; trust is the product; find other benchmarks; enterprise long-horizon sub-workflows | [94] | ◐ | Opus comparator ✅; GPT not run; long-horizon ⬜ |
| 108 | Messy, poorly defined tasks → the maximal optimal intent; test it | [98] | ◐ | SPEC-0, κ 0.57 |
| 109 | Elevate a weak model; try Mercury 3 | [99] | ✅ | Mercury integrated |
| 110 | The corpus lacks multi-tier enterprise integrations; hunt sources; build a system capable of them | [100] | ◐ | Org research |
| 111 | Invariants at layers; open core for solo developers, paid org tiers | [100] | 📐 | — |
| 112 | Subagents, parallel branches and waits robust on any host; the system does the plumbing | [101] | ✅ | Conformance, chaos |
| 113 | Download and deconstruct the tools people use for complex systems; compare | [101] | ◐ | LangGraph done; Temporal blocked; Agents SDK and CrewAI pending |
| 114 | A dashboard, chat creation (BYOK, subscription, Mercury), MCP into coding agents, seamless for anyone | [101] | ✅ | `app/` |
| 115 | A SOTA fix for every compromise; efficiency at the core | [102] | ◐ | Register |
| 116 | Nodes get CUA, computer use and connections; adaptivity | [105] | ✅ (dev) | — |
| 117 | The smoothest onboarding for orgs and solo developers; build the site | [105] | ✅ | Built; no real users yet |
| 118 | Build breadth | [108] | ◐ | Adapters merged; paid runs ⬜ |
| 119 | Root-cause every failure; re-read every ask | [112] | ✅ | Anatomies |
| 120 | Is the built workflow good in the worst case, and does it adapt while doing real, changing work? | [117] | ◐ ⏳ | DUR-1 |
| 121 | Why do 30 of 60 fail? | [119] | ✅ | Anatomy and the look-2 audit |
| 122 | A skill pack, information-efficient, built from all our curation | [126] | 🔧 | Built; SKILLPACK-1 ⬜ |
| 123 | Use ZCode's visuals | [126] | ➖ | Superseded by [127] |
| 124 | Scale: 300 GB of data, a huge messy codebase audit; find the weak points | [126] | ◐ | Ledger, sizing, data handles merged; no real run |
| 125 | Ready for the local agent on the laptop | [126] | ◐ | Code nodes need Linux (WSL2 on Windows) |
| 126 | The core engine must be flawless; the owner does the visualisation | [127] | ✅ | Suite 1,480 of 1,499, 0 fail |
| 127 | Fan-out proportionate to the model's capacity and the task | [128] | 🔧 | Sizing planner |
| 128 | Prove it creatively and cheaply, with frontier-style workflows for different tasks, against every competitor | [130] | ◐ ⏳ | Conformance; edge track running; showcases ⬜ |
| 129 | Production-grade integrations through MCP, skills and connectors everywhere | [today] | ◐ ⏳ | Mechanism built; per-system layer ⬜; integrations track running |
| 130 | Foundry as its own mini harness; Harness² and Prime Agent ideas for healing and growing | [today] | 📐 ⏳ | Code read; proposers only, our gate promotes |
| 131 | Org-wide workflows with sections for control; beat hand-curated workflows | [today] | ◐ ⏳ | Primitives built; org layer designed; org track running |
| 132 | Blow every competitor out of the water | [today] | ◐ ⏳ | Edge track |
| 133 | Friction for users and agents using it through a harness | [today] | ✅ | Analysed |
| 134 | Every gap's solution must generalise; is our test slice realistic or easy? | [today] | ⏳ | Generalisation workflow running; slice: realistic and hard, but narrow |
