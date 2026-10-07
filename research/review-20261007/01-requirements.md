# Review lane 1: owner requirements audit (2026-10-07)

*Development/diagnostic document. No experiment was run for it, and nothing in it is claim-bearing.
Repository HEAD `fd7bd27` on `claude/intelligent-hamilton-vg1f9a`; `main` is still at `6e1c06c`, where the
session started. Written about 22:30 UTC on 2026-10-07. C0 dev constructions, bed audits and the Kev program
were still running, so any number that can move carries its date.*

**What was read**
- **The whole session transcript**, `/root/.claude/projects/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a.jsonl`
  (4,271 JSONL lines at reading time). It is cited as `T:<0-based line>`.
  - The owner speaks in 19 typed messages, 3 messages queued mid-turn, 2 AskUserQuestion answers, 3 rejected
    tool uses and 2 `/model` switches.
  - The two compaction summaries (T:1884, T:4085) are model-written. They were used only to cross-check the
    message list.
  - Notifications, subagent hand-backs, laptop-agent messages and scheduled triggers were treated as data, not
    as the owner speaking.
- **Docs:** README.md, AGENTS.md, docs/THESIS.md, docs/ROADMAP.md (all of it) and docs/RESEARCH.md.
- **Research:**
  - research/core-20261006/{DESIGN,PREREG}.md and research/construction-20261006/{DESIGN,PREREG-dev}.md;
  - research/distill-20261007/DESIGN.md and research/corpus-20261006/COVERAGE.md;
  - research/kev-20261007/ (summaries plus the raw probe ledgers);
  - research/landscape-20261006/ R01–R11 (bottom lines; R02 §1, R07 in full, R08 §0 and §5).
- **Spot checks:**
  - code: `schemas/workflow.schema.json`, `src/validate.mjs`, `src/ports.mjs`, `web/app.js`, `experiments/lib/arms/`;
  - run data: `experiments/runs/c0-dev/constructions.jsonl`, `experiments/runs/kev-probe/ledger/`,
    `/var/tmp/foundry-work/records-v3/dev-log.jsonl`.

**Tags**
- **[M]** measured; the source file is named.
- **[D]** documented; the path or URL is named. Someone wrote it down and it was not re-verified here.
- **[I]** inferred; the reasoning is shown.

Owner quotes keep the owner's spelling. Status values:
- **met**: done.
- **in progress**: started, not finished.
- **planned**: in a plan, not started.
- **missing**: not in any plan.
- **contradicted**: the repo, or a later statement, says otherwise.

---

## (a) + (b) Every owner requirement, decision and question, with status

### A. Mission, scope, ambition

| # | Date (UTC), source | Owner words (short) | Requirement or decision | Status | Evidence |
|---|---|---|---|---|---|
| 1 | 10-06 18:29, T:2 | "bounded, typed, task-scoped workflows ("micro harnesses") that agents construct for a specific task, run durably, adapt while running, verify against locked contracts, and keep only when reuse pays — disposable by default" | The product definition | **in progress**. Construct: C0 dev is running. Run durably and verify: built. Adapt: L1 only (retry, escalate). Keep/reuse: not started. | `src/runtime.mjs`, `src/journal.mjs`, `src/verdict.mjs`; `research/construction-20261006/PREREG-dev.md`; ROADMAP §5.5 |
| 2 | 10-06, T:2 | "Code owns procedure; models make narrow, typed, checked judgments, so cheap models can execute what frontier models author" | Principles P1 and P2 | **in progress** (mechanism built; development evidence only) | [M] `dev-log.jsonl`: the hand-written records-v3 workflow on Haiku 5.5 passes 30/30 dev tasks (d3–d4) at $0.014–0.019 per task; all-Sonnet passes 20/20 at ≈ $0.22 per task. Seeds were reused while the workflow was being fixed, so these are dev numbers. |
| 3 | 10-06, T:2 | "ARC and AMP … are the surrounding harness; Foundry is the workflow layer inside it" | Positioning | **met** in the docs | THESIS §8 |
| 4 | 10-06, T:2 | "NOT building: a global meta-harness, an offline harness optimizer, a general agent loop, a visual builder, a memory store, a model gateway, or a LangGraph/n8n clone" | Non-goals | **met** so far. Items 58, 60 and 67–70 put pressure on them; see the box after section H. | ROADMAP §3 |
| 5 | 10-06, T:2 | "Generalization is the point … Test on ideas NOT in any dataset" | Held-out generalization | **in progress**. The sealed families exist but have never been used. | `beds/sealed/MANIFEST.json` (4 families) |
| 6 | 10-07 21:56, T:3867 | "i want to be able to buidl the best possibel workflow for any tas obviously, thats the ultimate goal" | Ultimate goal: the best workflow for any task | **in progress**: stated as the goal, with no cross-domain evidence yet | C0 dev is frozen for 2 of 5 families |
| 7 | 10-07 22:16, T:4050 | "this isnt a harness okay. like a mini harness … something that can allow us to build focussed systems to execute tasks" | Framing: a micro harness, not a harness | **met** in the docs | THESIS §2 |
| 8 | 10-07 22:16, T:4050 | "also like you get the ambition right. it becomes essentially" | The ambition statement | **missing**: the sentence was cut off | Ask the owner to finish it (§c) |

### B. Models, compute, money and usage

| # | Date, source | Owner words | Requirement or decision | Status | Evidence |
|---|---|---|---|---|---|
| 9 | 10-06, T:2 (D1) | "freedom to decide how to use … Haiku …, Sonnet 5.5 … and Opus 5.5, plus open-weight models … justify assignments by measurement. Keep a running cost ledger in README" | Model freedom, the policy file, assignments justified by measurement, a cost ledger | **in progress**. The policy file is met. The ledger is **stale**. Measurement-based justification is partial. | `policy/models.json`. [M] The README total is $4.86. The three C0 dev constructions alone cost $6.94 (`experiments/runs/c0-dev/constructions.jsonl`). The records-v3 pilots and the Kev-probe hosted calls are not entered either. |
| 10 | 10-06, T:2 (D1) | "Spend cap: ____ (if blank: pause and ask in README before any single experiment estimated over $500)" | The $500 pause rule | **met** | README "D1-cap" row; C0 kill rule $350 (PREREG-dev §5); P1 kill rule $60 |
| 11 | 10-06, T:2 | "just dont ask me to authenticate anythign. figure out how to get yourself, your own subscription working" | No owner authentication; drive models through the session login | **met** | README Phase 0: `claude -p` on the OAuth login |
| 12 | 10-06 18:38, T:277 | "i give you perms to auto decide what you want to install and setup" | Installation authority | **met** | Node 24, llama.cpp, Kev, Playwright (README Phase 0) |
| 13 | 10-06 18:37, T:256 / T:259 | (rejected the local-model install) "can you check your vm and what its capable fo running" | Inventory the VM before installing | **met** | T:273 reply; `research/env-20261006/ENV.md` |
| 14 | 10-07 14:03–14:44, T:1601–T:1707 | "is it being billed to my card ?" … "usage billing … is turned off" | Usage credits are off, so the worst case is waiting at the limit | **met** | README "Usage-limit incident" |
| 15 | 10-07 16:11, T:2688 | "can we do without the local model ? … local models are incredibly slow, i say we forgo it ?" | Park local generative models | **met** | Commit `e4fbffc`; `docs/RESEARCH.md` 2026-10 table (268 s per call, 0.38–0.80 agreement) |
| 16 | 10-07 17:09, T:3295 (AskUserQuestion) | "to build the product itself … use opus 5.5 and sonnet 5.5 at xhigh. with sonnet being the cheap worker, nd opus 5.5 xhigh being the smart agent" | Model roles for *building Foundry* | **met** in practice. **Not recorded** in README or ROADMAP. | T:3366 |
| 17 | 10-07 17:09, T:3295 | "haiku being much dumber is akin to a 9b model … would prove that the systme is optimised so even a dumb model like haiku can construct and edit these workflows" | Haiku is the system-under-test model; it must **construct and edit** | Construct: **in progress**. Edit: **missing**. Docs: **contradicted** (ROADMAP §2.3 assigns construction to class F; §2.5 says "frontier builder"; THESIS §1 says "cheap open-weight models"). | [M] F-haiku-records built for $1.01 in 13.2 min, with 4 of 12 score checks passing and the first pass at check 2 (`constructions.jsonl`). No experiment has Haiku edit or repair a workflow. |
| 18 | 10-07 17:09, T:3295 | "akin to a 9b model give or take" | Haiku stands in for a ~9B open model | **unverified** [I] | Haiku 5.5 is a new model. No comparison against any 9B open model exists. |
| 19 | 10-07 21:35, T:3579 | "anthropic updated haiku from 4.5 to haiku 5.5" | Use Haiku 5.5 as the weak model | **met** in policy and pre-registrations. **Stale** elsewhere. | Commit `bdeae69`; C0 PREREG amendment; P1 PREREG. README L126 still says "Haiku 4.5 is the cheap executor". `research/distill-20261007/DESIGN.md` still says Haiku 4.5 and a "3–4×" price gap; the real gap is 20× below Sonnet (README L125). |
| 20 | 10-07 ≈21:44, T:3732 (AskUserQuestion) | usage plan = "Full speed" | Spend the weekly allowance at full speed | **met**. Risk below. | [D] T:3731: the 7-day limit was at `allowed_warning` and resets 2026-10-14 11:00 UTC. When it runs out, everything stops, the laptop agent included. |
| 21 | 10-07 14:43, T:1700/T:1704 | `/model claude-fable-5-1`, then `/model claude-opus-5-5` | (Session model switch; immediately reverted) | no requirement inferred | — |

### C. Evidence discipline (the brief's non-negotiables)

| # | Date, source | Owner words | Requirement | Status | Evidence |
|---|---|---|---|---|---|
| 22 | 10-06, T:2 | "preregister each experiment (beds, arms, K, power, analysis-script hash, kill rule)" | Pre-registration | **in progress** | C0 dev is frozen for `records` and `codefix` at `bec44ea`. The P1 PREREG is a draft and not frozen. |
| 23 | 10-06, T:2 | "have a separate subagent author sealed held-out tasks you never see until evaluation" | Sealed held-out families | **met** for existence; never used | `beds/sealed/` (4 families with controls) |
| 24 | 10-06, T:2 | "graders locked and hash-pinned" | Locked graders | **in progress** | Freeze record in PREREG-dev; the score service runs on the host |
| 25 | 10-06, T:2 | "adaptations are proposals proven by replay of failures + a regression slice; verify-before-store" | L3 and library gates | **planned** | ROADMAP §2.6–2.7. Not built. |
| 26 | 10-06, T:2 | "no K=1 comparative claims; gaps <3 points are noise" | Statistical discipline | **met** so far (no claims made) | — |
| 27 | 10-06, T:2 | "preserve every negative result in docs/RESEARCH.md" | Negative results in one place | **in progress** | The local-model negative is logged. **Not logged:** records v2 being scriptable (a 40-line regex passed 20/30 at d3, `beds/records/AUDIT.md` A1); the C0 preflight NO-GO (oracle readable by builders, gateway overspent 89%; T:3240); the overnight agent losses to the usage limit. |
| 28 | 10-06, T:2 | "record every cost and rate-limit" | Full cost accounting | **partial** | README notes that orchestration (millions of tokens per agent workflow) is not itemized. The ledger is stale (#9). |
| 29 | 10-06, T:2 | "adversarially verify your own findings before claiming them" | Adversarial verification | **met** | Audits of 6 of 9 dev beds (`beds/*/AUDIT.md`), two Phase 1 review rounds, the C0 preflight, the bridge attack review |
| 30 | 10-06, T:2 | "Stop and report in README if: a falsifier fires, a baseline can't be recorded, the spend cap is near, or rate limits break paired experiments" | Stop rules | **partial** | The usage-limit stop is recorded in README. There is no rule for the weekly limit nearing exhaustion (#20). |

### D. Experiments, baselines, beds, corpus

| # | Date, source | Owner words | Requirement | Status | Evidence |
|---|---|---|---|---|---|
| 31 | 10-06, T:2 | "A/B them against: B0 … B0+N … B1 … B2 memory/skills … B5 best-of-K with the same verifier, and a hand-written ceiling" | The baseline set | B0, B0+N and B1: **built**. B2 and B5: **missing**. Ceiling: **in progress**. | `experiments/lib/arms/` holds only `b0-call.mjs` (B0 and B0+N), `b0-agent.mjs`, `b1-script.mjs` and `foundry-workflow.mjs` |
| 32 | 10-06, T:2 | "You may also use Claude Code's own dynamic workflows as a tool and as baseline B1" | A real CC-workflow baseline | **partial** | B1 is a sandboxed Node script written with `skills/script-harness`, not a Claude Code dynamic workflow (`agent()/parallel()` script). No ultracode comparison exists. |
| 33 | 10-06, T:2 | "Measure verified success, pass^k, cost per verified success, time-to-first-workflow, reuse / deopt / wrong-reuse rates" | The metric set | **in progress** | `experiments/lib/stats.mjs`, `experiments/c0/analyze.mjs`. Reuse metrics are not built. |
| 34 | 10-06, T:2 | "Procedure distillation: frontier-authored workflow, cheapest qualified model per node, vs all-frontier" | C1 | **planned** (design is a stale draft) | `research/distill-20261007/DESIGN.md` |
| 35 | 10-06, T:2 | "Failure handling: classify → intervene → patch → replay vs retry/regenerate" | C3 | **planned** | Verdicts are built (`src/verdict.mjs`). The classifier and L3 are not. |
| 36 | 10-06, T:2 | "find the best existing ones (… ARC-AGI-3 offline public games, TextWorld/MiniHack/BabyAI, IDoFT, AppWorld, τ²/τ³, SWE-bench Pro …)" | External benchmarks | **missing** | No external bed is integrated. Tier B/C are blocked by missing Modal/Harbor credentials (README). |
| 37 | 10-06, T:2 | "Every bed needs an executable oracle with known-good/known-bad controls" | Bed quality | **met** for 9 dev and 4 sealed families. Audits are **incomplete**. | Audited: records, incident, codefix, kinetics, gridquest, ownerci. **Unaudited:** synth, gameqa, runbook. |
| 38 | 10-06, T:2 | "deep QA of a game build (visual passes, explorer personas, playback/repro/minimize; R08 …), plus … scientific pipelines, data repair, research synthesis, creative/media pipelines, ops runbooks, web QA, puzzle/game solving" | Domain breadth, game QA first | **in progress** | gameqa (unaudited), kinetics, records, synth, incident and runbook, gridquest, codefix and ownerci exist. **Missing:** creative/media and web QA. Interactive beds cannot be run by F workflows: `src/ports.mjs` has no env port. |
| 39 | 10-06, T:2 | "hold out whole domains and families, hide parts of datasets" | Held-out design | **in progress** | Sealed families exist. No domain-level holdout is defined for C0. |
| 40 | 10-06, T:2 | "assemble a large, licence-tracked dataset of real, niche, highly complex human-built workflows … Use it to test construction …, IR expressiveness, and to mine operators" | Workflow corpus | Acquisition **met**. Construction test and operator mining **missing**. Expressiveness is **static only**. | [D] `research/corpus-20261006/COVERAGE.md`: 1,342 items from 27 platforms. §8 has a 30-item construction shortlist that has not been run. §9: "no item was compiled into Foundry IR". |
| 41 | 10-06, T:2 (via ROADMAP §4.2) | owner families | Owner-repo beds | **in progress** | `beds/ownerci` v1.1.0, audited, never run |
| 42 | 10-07 16:07, T:2665 | "hows it coming along ? againt the complet e2e vision … given the current rate fo progress ?" | Honest progress tracking against the full vision | **met** as an answer. **No capability number yet.** | T:2677: "No claim-bearing capability number has been measured yet", with 1.5–3 weeks to first-pass numbers on every claim. Still true at 22:30. |

### E. Kev (typed judgments) and the laptop GPU

| # | Date, source | Owner words | Requirement | Status | Evidence |
|---|---|---|---|---|---|
| 43 | 10-06, T:2 (D7) | "set up and use Kev … fine-tune it on Foundry's labelled judgment ledger … Kev/Jev gates go live only after beating rule/embedding baselines on held-out labels" | Kev as the open JudgmentPort engine | **in progress**. Correctly, no gate is live. | `src/judgment.mjs`; Kev served on CPU |
| 44 | 10-07 16:11, T:2688 | "deeply analyse and deeply reason about every single thing kev … for quick semantic decisions" | A deep analysis of Kev | Analysis **met**. Measurement write-up **missing**. | `01-kev-dossier.md` and `02-decision-inventory.md` (~100 decisions). `03-probe-results.md` still contains `RESULTS_PLACEHOLDER`; `probe-summary.json` and `tables.md` report only the rule engine, although the Kev ledgers exist (`experiments/runs/kev-probe/ledger/kev-*.jsonl`). |
| 45 | 10-07 16:22, T:2849 | "how hard would it be … to finetune kev for every possibel creative need … the 0.8b variant ?" | Fine-tune Kev-0.8B broadly | **in progress** (design only) | T:2866: Kev chooses among given options and cannot create. JUDGE-PROGRAM §0: 42 ports, 13 in wave 1. |
| 46 | 10-07 17:11, T:3319 | "idk if this si sufficient and if we ahve gfenerated the right dataset … for evey single place kev can be used we need to be robust" | Robust data for every Kev decision point | **in progress** (design; no data built) | JUDGE-PROGRAM rev. 2: learning curve at 2.5K–20K examples, three OOD slices, shortcut and decidability gates, two critiques (commit `fd7bd27`) |
| 47 | 10-07 16:42, T:3058 | "is it possible for oyu to do the training part on mu local laptop … i have a 4060" | Train on the owner's GPU | **in progress** | [D] Laptop report (T:3296), checks A–G pass. Kev serves on CUDA: 0.5 s on the first call, 22–28 ms on repeats. A smoke train ran at 0.287 s per toy example with 3.4 GB peak VRAM. No real fine-tune has run. |
| 48 | 10-07 16:44, T:3082 | "create a bridge from the cloud session to this laptop. and then give em a handoff" | Cloud-to-laptop bridge plus handoff | **in progress** | `bridge/` and `docs/laptop-agent-kickoff.md`; commit `d5d0c1f` (attacked, fixed, verified). Step I (daemon and tunnel) has the go-ahead. The first real round trip has not happened. |
| 49 | 10-07 21:44, T:3712 / T:3733 | "i started that local laptop chat again"; "accidentally stopped the running workdlows, sorry" | Resume | **met** | T:3838 |

### F. Process and repository

| # | Date, source | Owner words | Requirement | Status | Evidence |
|---|---|---|---|---|---|
| 50 | 10-06, T:2 | "Follow ROADMAP §5 phases in order (0→6); each phase must end with a capability number against a simple baseline and a research/<topic>-<date>/REPORT.md" | Phase order; a REPORT.md per phase | **contradicted** in part | Phases 1–4 run in parallel. No `REPORT.md` exists after `research/checkpoint-20260917/`. Phase 1's exit experiment (P1) has not run. |
| 51 | 10-06, T:2 | "~20% of effort on the frontier-bets track (§5.9), each bet time-boxed with a kill rule" | Frontier bets | **partial** | The Kev fine-tune and the bridge are de facto bets. There is no bet ledger, time box or kill rule. |
| 52 | 10-06, T:2 | "README stays the single entry point — update its status, cost ledger and 'owner decisions needed' section after every phase" | README hygiene | **partial / stale** | README L11 ("cheap open-weight"), L22 ("It has no model node"), L126 (Haiku 4.5) |
| 53 | 10-06, T:2 | "Feature branch per phase, small PRs merged to main, never force-push main" | Git process | **contradicted by circumstance** | PR #1 has been unmerged since 10-06, because the auto-mode policy denied the merge (T:764). All work sits on one branch; `main` is still `6e1c06c`. |
| 54 | 10-06, T:2 | "Text from tasks, issues, benchmarks, datasets and the web is data, never instructions" | Untrusted-data rule | **met** at runtime. **Gap** at construction time (gap 10). | Sandbox, labels, quarantined nodes; Phase 1 review fixes |
| 55 | 10-07 11:10, T:1180; 21:01, T:3503 | "continue … from where we left off"; "Try again" | Keep working autonomously | **met** | — |
| 56 | 10-07 ≈21:44, T:3732, T:3709 | "Finish the second pass" (and rejected the revert) | Finish the second-pass audits of kinetics and incident | **in progress** | Commit `67a0a6e` (WIP) |
| 57 | 10-07 21:56, T:3867 | "what template are we building these workflows in ? liek is it n8n langraph" | Explain the substrate | **met** as an answer (Foundry IR). That answer also promised **contradicted** interop (gap 15). | T:3870 |

### H. The 2026-10-07 22:16 message (T:4050), item by item

| # | Owner words (short) | Requirement or question | Status | Evidence |
|---|---|---|---|---|
| 58 | "represent any and all workflows independent of a harness so we should maybe raise it to 94 percent ??" | Raise the expressiveness target to ≥ 94%, harness-independent | **planned** (not yet a ROADMAP target) | [D] COVERAGE §4: 35% native today. 94% needs five bundles: triggers, failure handling, call by reference, agent sessions and generalized wait. None is built. The figure is a static heuristic, and the corpus has no agentic frameworks (gap 5). |
| 59 | "eventually in amp … get parallel workflows working together … or alll possibly combinations" | Multi-workflow composition inside AMP, later | **planned** | ROADMAP §5.6 (composition) and §5.7 (AMP adapter). Integration is forbidden for now by D3/D4. |
| 60 | "measure if tasks need a workflow or not … identify extremely complex workflows, all the way down to the simplest workflows, and tasks which dont need workflows … add a slider to its sensitivity" | A workflow-need classifier with tiers and a sensitivity slider | **missing** | The closest items are inventory decision D6 (reuse, construct, delegate or cascade), deferred to Phase 5 (JUDGE-PROGRAM §1.3), and F8 (per-family choice from C0). |
| 61 | "examples ina gentic coding and stuff" | Agentic-coding examples for that classifier | **missing** | `codefix` and `ownerci` could supply labels; SWE-bench-style beds are blocked (#36) |
| 62 | "haiku 5.5 will e the workflow constructor right ? by using the tempaltes" | Haiku 5.5 constructs from templates | Construct: **in progress**. Templates: **missing**. | The construction kit is `skills/micro-harness` (SKILL.md 4.5 KB, `ir.md` 3.7 KB, `operators.md` 2.5 KB with 9 operators). There is no template library, no worked-example set and no retrieval. |
| 63 | "see if theres absoltuely anythign else we are missing that we should maybe train this haiku … on" | A curriculum for the Haiku constructor | **missing** | [I] Haiku cannot be fine-tuned on this route, so any "training" has to come through context: skills, examples, typed construction steps, validator feedback. |
| 64 | "is this implementation efficeint ? like shoudl it be in rust instead ? how hard would it be to port it" | Efficiency and the Rust question | **missing** (no profile exists) | Lane 4 covers it; see gap 14 |
| 65 | "are we missing anything inside what a workflow could need … really deeply reason worst case sceanrios revaluate the entire concept, re read this entire chat" | A full re-evaluation | **this document** plus lane 2 | — |
| 66 | "can we ahve a workflow inside another workflow, inside another wirkflow, or an itertive flow" | Nesting, recursion, iteration | **partial** | Nested map/loop bodies are allowed to depth 6 (`src/validate.mjs:165`). `loop` is bounded at ≤ 1000 iterations with `until`. There is no `call` by hash, no separate child run record, no recursion rule and no unstructured cycles. |
| 67 | "a nice visualisation, node like … one node could be visual understanding node … a small beathing dot with colors to indicate state and a slight update of whats happening inside node rn. clicking it expands its chat" | A run viewer with live node state and per-node transcripts | **partial** | `web/app.js` lays out the DAG and colours status (L17–22, L70), but it predates Phase 1: no model-call transcripts, receipts, escalations or live stream. ROADMAP §2.10 decision cards are not built. A visual-understanding node is impossible today: agent inputs render only `json` or `text`. |
| 68 | "how agent swams work and how dynamic workflows in claude code wor … ultracode … is implementing a swarm (inspired by kimi swarm …) … part of our scope ?" | Explain swarms and CC workflows; decide on scope | CC workflows: **documented**. Swarms: **missing** from the research. | [D] R02 §1 describes CC dynamic workflows: `agent/pipeline/parallel/phase`, 16 concurrent agents, 1,000 agents per run, resume replays in start order. No R01–R11 report mentions swarms or Kimi (grep). `best_of_n` and `tournament` operators are planned (ROADMAP §2.1). |
| 69 | "manage subagent spawning … inside nodes? if necessary ? or am i overcomplciating" | Bounded delegation inside nodes | **planned** | The `executor` node and `plan/expand` are in ROADMAP §2.1 and were deferred (core DESIGN §7). The executor exists only as an experiment arm (`src/executors/claude-code.mjs`). |
| 70 | "a shared messae board, with shared understaning od state, some private notes … auditability and efficiency is a huge huge part" | Board, shared state, private notes, audit, efficiency | Board: **planned** (Phase 6). Audit of model calls: **met**. Efficiency: **unmeasured**. | ROADMAP §2.2 (`board_events`, scopes node/run/workflow/library/temp; P8 private by default). The schema allows only `history: "none"`. The journal and receipts exist (`src/journal.mjs`, `src/context.mjs`). |
| 71 | "have we made sure every single possible compeontn is maximally efficient and optimised ??? should we be looking at frontier research or any oss" | Per-component optimization; a frontier/OSS sweep | **missing** at the component level. The research sweep is from 10-06. | R01–R11 date from 2026-10-06; lane 3 re-sweeps |

### Does the new direction break the ROADMAP §3 non-goals?

The task asked for this to be argued explicitly. [I] It does not, provided each new ask is scoped as follows:

| Owner ask | Read as a non-goal, it would be… | In-scope version | Why it stays in scope |
|---|---|---|---|
| Node visualisation (#67) | a visual builder | a **read-only run inspector**: live node state, one-line status, click-through to the node's journaled calls | ROADMAP §2.10 already requires decision cards and sets "why did this happen?" in under 2 minutes as the exit criterion; the `web/` UI already exists. Authoring stays in IR and code. |
| Shared board and private notes (#70) | a memory store | a **run- and workflow-scoped blackboard** with typed topics, one writer, receipts | ROADMAP §2.2 scopes. Durable cross-task memory stays with AMP. |
| Swarm (#68) | a general agent loop | an **operator**: map over agents or executors, plus the board, an aggregator and a verifier, with fixed budgets | It must beat B5 (best-of-K with the same verifier, equal tokens). R07 cites MAST's "often minimal" multi-agent gains and Anthropic's ≈ 15× token cost. |
| Workflow-need slider (#60) | a model router | **selection** (ROADMAP §2.8: construct vs delegate vs reuse) | It chooses workflows and executors, never model ids |
| "Any and all workflows", "maybe Rust" (#58, #64) | an n8n/Temporal clone | **representation plus import adapters that reject what they cannot represent**; external engines are called as capabilities | No connector catalog and no distributed engine (ROADMAP §3: SQLite stays the evidence core, with DBOS behind an adapter if scale demands it) |

---

## (c) The owner's ambition, in the owner's terms

The owner wants a harness-independent way to describe and run **any workflow at all**. In his words it is "a
mini harness", not a harness: something that lets us quickly build "the best possible workflow for any task" as
a focused system that executes it.

**Who builds what**
- **The bar:** a "dumb" model like Haiku 5.5, which he puts at about 9B class, can **construct and edit** these
  workflows from templates and run them.
- **Building Foundry itself:** Opus 5.5 and Sonnet 5.5 at xhigh.

**Kev.** Kev, the open-source Jev, fine-tuned on his RTX 4060 laptop through a bridge, should make the quick
semantic calls robustly "for every single place Kev can be used". That includes deciding whether a task needs a
workflow at all, and how complex it should be, with a sensitivity slider.

**What workflows can do**
- nest: a workflow inside a workflow inside a workflow;
- iterate;
- run in parallel, possibly as swarms;
- spawn subagents inside nodes where needed;
- share information through a board, with shared state and private notes.

**Qualities.** Everything should be maximally efficient and fully auditable.

**Seeing it work.** Each workflow should be visible as a few simple nodes (for example a "visual understanding
node" in game QA). Each node has a breathing coloured dot for its state and a one-line note on what it is doing
now; clicking a node opens its chat.

**Later, inside AMP:** parallel workflows working together "in all possible combinations".

**The cut-off sentence.** "It becomes essentially …" ends mid-sentence. [I] The rest of the message points
toward something like a general compiler and operating layer for task-specific agent systems that cheap models
can drive. That is a guess; the owner should finish the sentence.

---

## (d) The 15 most important gaps, ranked

The ranking puts capability first: what blocks a measured number comes first, then what the owner's new
requests most depend on. Each gap names the smallest next step that yields a number.

### 1. There is no claim-bearing capability number yet, and the weekly usage budget is nearly spent

**Evidence**
- README: the Phase 1 exit is pending.
- No `REPORT.md` exists after 2026-09-17.
- The P1 PREREG is not frozen.
- [M] C0 dev: 3 of 20 constructions are done.
- [D] T:3731: the 7-day limit is at `allowed_warning` and resets 2026-10-14 11:00 UTC. The owner chose "Full speed".
- This review (7 lanes, a synthesis and 2 critics) draws on the same allowance.

**Why it matters.** ROADMAP §6.5 requires a number. Every gap below rests on premises that only P1 and C0
test, and the allowance can run out before either finishes.

**Next step**
- Reserve the allowance for P1 (≈ $25–40 list price) and C0 dev first.
- Defer build work for the new asks (UI, board, swarm, Rust) until P1 reports.

### 2. "Does this task need a workflow, and how big?" has no specification, no labels and no baseline

**Evidence**
- Items 60 and 61.
- Inventory decision D6 is deferred to Phase 5. F8 is per family only, and C0 gives at most 5 families × 4 tasks.
- Stock Kev is weak (gap 9).

**[I] The label is not a property of the task alone.** On `records` v2 a single Sonnet call passed d1–d3, while
a single Haiku 4.5 call passed 0/6 [D README]. So "needs a workflow" depends on four things:
- the executor model;
- the budget;
- the reliability target (pass^k);
- the expected recurrence, which decides whether construction is amortized.

A tier label (none, simple, standard, complex) with a slider is well defined only as an expected-utility rule.
Choose a workflow when

    P(success | workflow) · V − (run cost + construction cost / expected uses)
      > P(success | direct) · V − direct cost

where the slider is V (the value of success) or a risk tolerance. Labels then need both arms run on the same
tasks, which is expensive.

**Next step**
1. Write that rule down.
2. Generate labels from P1 and C0 trial pairs.
3. Start with a rule and feature baseline (input tokens, number of stated conventions, interactivity,
   recurrence) and a Haiku 5.5 judge.
4. Use Kev only where it beats both.

### 3. Haiku as constructor and editor is the new core claim, but its kit and its "edit" half are missing

**Evidence**
- Items 17, 62 and 63.
- The kit is 10.7 KB with 9 operators.
- It has none of these:
  - worked examples;
  - templates mined from the corpus (COVERAGE §6 lists candidate motifs);
  - retrieval of kept workflows (no library exists);
  - a cookbook of validator errors;
  - the ROADMAP §2.5 "construction is a workflow" builder (builders write `workflow.json` freehand).
- [D] PREREG-dev §7: a Haiku 4.5 smoke "built a single-node workflow".
- [D] THESIS §3 item 4: small models collapse when they modify themselves (44 → 14).
- No experiment has Haiku edit or repair a workflow.
- The docs still say frontier models construct.

**Next step**
1. Read F-haiku against F-opus in C0 dev.
2. Test candidate aids as ablations, one at a time, on held-out families:
   - an example library;
   - typed construction steps: choose an operator, fill its slots, validate, smoke-run;
   - validator feedback;
   - retrieval.
3. Add an **edit** task: Haiku repairs a broken workflow given a failing run record, scored by replay. This is
   also C3's natural bed.

### 4. The control semantics the 94% target needs do not exist

**Evidence**
- The IR's node kinds are `task, assert, human, map, loop, wait, agent, code, verify`.
- None of the following exists:
  - `call` by hash;
  - triggers;
  - error branches, `finally` or adaptive retry;
  - signals, `detach`/`await` or durable waits over 1 h;
  - cross-run state;
  - agent sessions.
- ROADMAP §2.1 specifies `call` with budget carving, but no rule for depth, recursion or cycles. Apple Shortcuts
  in the corpus call themselves (COVERAGE §4).

**Next step.** Specify each construct, then prove it by compiling corpus items:
- `call`: by hash, with a depth cap, budget carving, cancellation propagation, label passing and the parent's
  deadline;
- error branches with `finally`;
- triggers as run-start adapters.

### 5. Expressiveness evidence is static, and it misses the workflows closest to this project

**Evidence**
- COVERAGE §9: "no item was compiled into Foundry IR, so expressibility is plausible, not demonstrated".
- The 27 platforms include none of these: LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, Google ADK,
  Microsoft Agent Framework, Claude Code dynamic workflows, swarm frameworks.
- 1,067 items call external services ("action" nodes). Without capabilities, "represent" does not mean "run".

**Next step**
1. Compile and execute the 30-item shortlist (COVERAGE §8).
2. Add an agentic-framework slice of about 100 items and recompute the verdicts.
3. Report the 94% target as two numbers: expressible, and compiled-and-executed.

### 6. Evaluation validity is the weakest link

**Evidence**
- Every bed is synthetic, and Claude models wrote all of them, the sealed families included.
- Label-bearing surfaces are few. [D] JUDGE-PROGRAM §0 counts 32–288 distinct forms per convention over 900
  `records` worlds.
- Audits keep finding bypasses:
  - [D] `beds/records/AUDIT.md` A1: on records v2, a 40-line regex passed 20/30 at d3;
  - [D] `beds/ownerci/README.md`: one critical oracle bypass.
- synth, gameqa and runbook are unaudited.
- No external benchmark is integrated.
- Claude models fill every role at once: bed authors, skill authors, builders, the B1 author and the judges.

**Next step**
- Add an external Tier-A bed that installs locally. [I] TextWorld, IDoFT and AppWorld look feasible; check
  each one's acquisition path first.
- Ask the owner for 10–20 tasks he wrote himself.
- Audit the three remaining beds before they enter any round.
- Keep running the heuristic attackers on every bed.

### 7. The owner's flagship example, game QA with a "visual understanding node", cannot be built

**Evidence**
- There is no env port: `src/ports.mjs` has only Context, Effect and Judgment.
- Agent inputs render only `json` or `text`, so there is no image input.
- Kev is text-only; JUDGE-PROGRAM §1.4 excludes the visual pass.
- `gameqa` is unaudited.
- C0 is limited to one-shot families.

**Next step**
- Add the ROADMAP §2.1 env capability: `reset/step/observe/snapshot/restore` plus a determinism class.
- Add image inputs on agent nodes.
- Audit `gameqa`.

### 8. The baselines that would answer the swarm question, and whether the IR earns its keep, are missing

**Evidence**
- Neither B2 nor B5 exists (#31).
- B1 is not a real Claude Code dynamic workflow (#32).

**Next step**
- Build B5: best-of-K with the same verifier, at equal tokens. It is also the minimal "swarm" baseline.
- Where feasible, add a saved CC-workflow script under the same budget as B1-cc.

### 9. Kev's case after Haiku 5.5 is unproven, and its probe write-up is unfinished

**Evidence** [M]. I recomputed these from `experiments/runs/kev-probe/ledger/`: argmax accuracy on the
calibration split, two wordings A and B, generator labels, development evidence only.

| Port | Stock Kev-0.8B (A / B) | Rule baseline, same split |
|---|---|---|
| injection | 0.64 / 0.50 | 0.99 |
| failure-class | 0.69 / 0.57 | 1.00 |
| synth-claim | 0.53 / 0.56 | 0.58 |
| records-pair | 0.80 / 0.79 | 0.80 |
| incident-class | 0.90 / 0.90 | 0.89 |

- Sonnet, scored on the evaluation split (n ≈ 50), reached 0.76–1.00. The splits differ, so the comparison is
  approximate.
- Median Kev latency on this CPU, with other load running, was 2.5–13.7 s per question.
- [D] `01-kev-dossier.md:44`: out of domain, Kev-0.8B can automate 14.5–27% of decisions at a 5% error budget,
  and it scores 0.506 on held-out injection.
- [D] README L125: Haiku 5.5 answers a typed judgment in about 1.5 s for about $0.0005.

**[I] What this means.** Haiku 5.5 removed Kev's cost advantage. What is left:
- calibrated probabilities;
- offline and local operation;
- GPU latency, which was 22–28 ms on repeats but only from the laptop, over a tunnel.

**Next step**
1. Fill in `03-probe-results.md`.
2. Run Haiku 5.5 on the same probe items before spending laptop nights on training.
3. Keep Kev only on ports where, on GPU, it beats Haiku 5.5 on accuracy, calibration and latency.

### 10. The security model does not cover injection at construction time

**Evidence**
- [D] The runtime builds system prompts "from static workflow text only" (T:1483, the Phase 1 review). Workflow
  text is therefore trusted.
- In C0, builders read the task probes, which are untrusted, and write workflows from them.
- ROADMAP §2.9 says "The builder's own context must not contain untrusted content". Construction contradicts this
  by necessity.

**[I] The risk.** When Haiku builds from user or task text, any instruction planted in that text can become a
trusted `instructions` field. Nothing tests for this.

**Next step**
- Label workflow text by provenance: text derived from untrusted input is tainted.
- Require approval before a workflow built that way may use an effectful capability.
- Add an injection slice to C0 sealed: planted instructions aimed at the builder and at the runtime.

### 11. The information architecture (board, notes, cross-run state) is not built

**Evidence**
- Core DESIGN §7 defers the board to Phase 6.
- The schema allows only `history: "none"`.
- [D] COVERAGE §4: cross-run state appears in 134 corpus items (10%) and has no specification.
- The owner asks for all three explicitly (#70).

**Next step**
1. Build a minimal run-scoped board: typed topics, one writer per topic, `expectSeq` on writes, a receipt for
   every read.
2. Measure on a multi-node bed whether it lowers cost compared with passing values along edges.

### 12. Bounded delegation (subagents inside nodes, `plan/expand`) has no rules for replay and audit

**Evidence**
- The executor node is not in the schema.
- An opaque executor cannot be replayed, so its effects must count as `uncertain`, and its transcript must be
  journaled for audit and for the UI.
- Beyond ROADMAP prose, no caps on depth, fan-out or budget are specified.
- [D] R02 §1: Claude Code subagents nest 3 levels deep; Managed Agents delegates one level to at most 20 agents.

**Next step.** An executor node with:
- budget carving;
- a maximum depth and a maximum number of children;
- typed returns, with a mandatory `verify` after it;
- a journaled transcript.

### 13. Run inspection does not show what the owner wants to see

**Evidence**
- `web/app.js` predates Phase 1.
- There is no live event stream and no view of model calls, receipts or escalations.
- The decision cards and OTel export from ROADMAP §2.10 are not built.

**Next step**
1. Build a read-only viewer over the journal and event tables.
2. Score it by the §2.10 exit criterion: owner time to answer "why did this happen?" on 10 recorded failing
   runs, with and without the viewer.

### 14. Efficiency is unmeasured where it matters, so the Rust question cannot be answered yet

**Evidence**
- There is no per-node overhead profile.
- Every model call spawns a `claude -p` process. [D] README L125: about 1.5 s for a Haiku 5.5 typed call.
- `FORCE_PROMPT_CACHING_5M` is not set (PREREG-dev §5).
- [I] This CLI route offers no batch API.
- `store.mjs` still rewrites the whole run blob, a known debt (core DESIGN §7).
- Orchestration tokens are in no CPS figure.
- The constraint that actually bit was the subscription limit, which stopped work twice, not CPU.

**Next step**
- Lane 4 profiles a realistic workflow.
- [I] Consider Rust only if the runtime itself takes ≥ 10% of wall time or cost. Prompt caching and per-call
  process overhead are the likelier wins.

### 15. The docs and recorded decisions have drifted, and process debts are piling up

**Evidence**
- Stale statements:
  - README L11, L22 and L126, and THESIS §1, still describe "cheap open-weight models", "no model node" and
    Haiku 4.5;
  - ROADMAP §2.3 and §2.5 still assign construction to frontier models;
  - the distill DESIGN still uses Haiku 4.5.
- Contradicted promise:
  - T:3870 told the owner "Interop with n8n, LangGraph and the rest is planned as adapters … or export ours to
    run on their engines";
  - but D6 deleted the export adapters, and ROADMAP §2.11 keeps them out of the core.
- Process debts:
  - the cost ledger is stale;
  - no phase has a `REPORT.md`;
  - PR #1 is unmerged and `main` is unchanged;
  - several negative results are not in RESEARCH.md (#27);
  - there is no frontier-bet ledger.
- [I] Single vendor: every model is a Claude model behind one OAuth CLI route, so THESIS §6 item 4 (selection
  across vendors) cannot be tested.

**Next step.** One docs commit that:
- records the 2026-10-07 owner decisions (Haiku constructs and edits; model roles; local models parked; the 94%
  target; the UI scoped as an inspector);
- corrects README;
- logs the negative results.

The reuse library (C2) is not in this list. It is core to the thesis but not yet blocking: it is planned for
Phase 5, and worst-case W3 below covers its economics.

---

## (e) Worst-case scenarios for the whole concept

For each scenario: why it would make Foundry pointless or harmful, the evidence for and against, and the
experiment that would settle it. "For" means evidence that it is happening.

### W1. A single strong call, or a plain agent, keeps winning

**Pointless because** a workflow is overhead whenever one call suffices. Models also keep improving.

**For**
- [D] README: a single Sonnet call solved records v2 at d1–d3 (6/6, $0.08–0.18 per task).
- [D] THESIS §3: generic harness lift on frontier models is 2–5 points.
- [D] R07 §1: METR measures the length of task frontier models can complete doubling every 89–131 days.

**Against**
- [D] README: a single Haiku 4.5 call failed 0/6.
- [D] `beds/records/AUDIT.md`: v3 hardened the bed (a 40-line heuristic now passes 0/30 at d3).
- [M] `dev-log.jsonl`: the hand-written v3 workflow passes on Haiku 5.5 at $0.014–0.019 per task.
- [D] THESIS §3: on Terminal-Bench 4.0, pass@5 − pass@1 is 12–27 points, so reliability, not capability, is the
  remaining gap.

**Settles it**
- P1 as pre-registered: `fhand-haiku` against `b0call-sonnet-med` and `b0agent-haiku`.
- C0 sealed: F-haiku against B0-opus and a single Sonnet call, at equal dollars.
- Kill rule: if the single call reaches F-haiku's success and the upper CI bound of the CPS ratio is ≥ 0.85 on
  at least 3 of 4 sealed families, shrink the claim to "rescuing a weak model".

### W2. Plain scripts, or Claude Code dynamic workflows, match F

**Pointless because** the typed IR, checks and replay would add nothing a script cannot do.

**For**
- [M] In C0 dev both arms passed the probes at the first check (F-opus $2.47, B1-opus $3.46).
- [D] R07: the labs ship workflows natively.

**Against.** There are no execution results yet.

**Settles it**
- C0 sealed with K_c = 2, F against B1.
- An F ablation without checks, escalation and verify.
- The ROADMAP §4.3 C0 falsifier.

### W3. Construction cost never pays for itself

**Pointless because** tasks don't recur, and each construction costs more than direct solving.

**For.** [M] Construction cost $1.01 (Haiku builder) and $2.47 (Opus builder) on `records`. [I] Break-even,
assuming equal success:
- F per task ≈ $0.016 (the hand-written dev workflow; the cost of a constructed artifact is unknown);
- B0 Sonnet single call ≈ $0.10 per task (v2);
- break-even ≈ 1.01 / (0.10 − 0.016) ≈ 12 tasks for the Haiku builder, and ≈ 29 tasks for the Opus builder.

Development cost (skills, beds, orchestration) is not counted at all.

**Against**
- Haiku 5.5 makes per-task execution very cheap.
- Workflows can be reused across instances of a family.

**Settles it**
- C0 amortization curves with break-even t* (pre-registered).
- C2 streams.
- A census of how often the owner's real tasks recur. This needs ARC/AMP logs, so the owner runs it.

### W4. Cheap constructors fail on unseen families

**Pointless because** "even Haiku can build it" would hold only for tasks the skill already pre-digested.

**For**
- [D] PREREG-dev §7: a Haiku 4.5 smoke built a single-node workflow.
- [D] THESIS §3 item 4: small models collapse when they modify themselves (44 → 14).
- The skills were written with knowledge of `records`.

**Against.** [M] F-haiku-records passed probes from the second check onward, for $1.01.

**Settles it**
- C0 sealed with Haiku builders.
- The corpus "construct from description" pilot, scored by execution oracles.
- Kill rule: F-haiku construction success on sealed families below half of F-opus's.

### W5. Evaluation leakage and correlated authorship

**Harmful because** the system would look good only on tests written by the same model family that builds the
workflows.

**For**
- Claude wrote every bed, skill and builder prompt, and Claude is also the judge.
- Template pools are small (gap 6).
- Builders get 12 score checks on 3 probes, which is a feedback channel.
- Critical bypasses keep turning up in audits.

**Against**
- Sealed families were written by a separate author.
- The oracle runs on the host; builders are sandboxed and scanned for hidden-path access.
- Literal scans of the kits are planned.

**Settles it**
- External beds.
- Owner-written tasks.
- Held-out families written by a non-Claude author, for example an open model on the laptop GPU.
- Kill rule: if F's advantage disappears on external beds, the claim is a bed artefact.

### W6. Judges are miscalibrated

**Harmful because** false accepts compound: wrong reuse, wrong "no workflow needed" calls, wrong failure classes.

**For**
- [M] Stock Kev scores at or below the rule baseline on 4 of 5 ports, and near chance on injection and
  synth-claim (gap 9).
- [D] The repo's history includes a skills arm at 0/21, with all 21 false successes (RESEARCH.md).
- [D] R07: the best failure-attribution method reaches 53.5% at agent level and 14.2% at step level.

**Against**
- Gates stay advisory until they beat baselines (THESIS §7).
- JUDGE-PROGRAM rev. 2 has OOD slices and shortcut gates.

**Settles it**
- JUDGE-PROGRAM J0–J2, with a Haiku 5.5 arm on test-OOD.
- For the need-router: calibration on held-out families, plus the cost of wrong routing measured end to end.

### W7. Untrusted content takes control

**Harmful because** Foundry would turn task text into trusted programs, effects or exfiltration.

**For**
- Construction-time injection is untested (gap 10).
- Executor, subagent and tool nodes will widen the attack surface.
- Real holes were found and fixed:
  - quarantined outputs could carry arbitrary text (T:1483 finding 1);
  - builders could read the oracle (T:3240);
  - the bridge's `torch.load` path (T:3571).

**Against**
- Labels.
- Low-capacity quarantined outputs.
- The allowlist sandbox.
- The signed, allowlisted bridge jobs.

**Settles it**
- An injection bed with planted instructions aimed at the builder, the runtime and executors.
- Measure attack success per arm (F, B1, B0).
- Requirement: zero effects or exfiltration through F.

### W8. Scale and operating limits

**Pointless at scale because** swarms, deep nesting and many concurrent workflows would hit hard limits.

**For**
- Schema bounds:
  - `map` ≤ 1,000 items with concurrency ≤ 16;
  - ≤ 500 nodes;
  - nesting ≤ 6;
  - `wait` ≤ 1 h.
- One `claude -p` process per call.
- The SQLite run blob is rewritten whole.
- The subscription limit stopped all agents twice in about 24 hours (README; T:3571).

**Against**
- Each limit is a deliberate, liftable bound.
- ROADMAP §3 allows DBOS behind an adapter.

**Settles it**
- Load tests: a 1,000-item map, a 300-node workflow and 10 concurrent runs. Measure runtime overhead per node
  against model latency (lane 4).

### W9. An expressiveness illusion

**Pointless because** "represents 94%" turns out to mean neither "runs" nor "covers agentic patterns".

**For**
- Only static heuristics (gap 5).
- No agentic frameworks in the corpus.
- No connectors.

**Against**
- 1,342 real items.
- Explicit verdicts and blocker counts.

**Settles it**
- Compile and execute the shortlist.
- Add the agentic slice.
- Report expressible and executed separately.

### W10. Model churn invalidates the evidence

**Harmful because** assignments and kept workflows silently stop being valid when the model under them changes.

**For**
- Haiku 4.5 was replaced by 5.5 within a single day (T:3579).
- The CLI version changes between days (P1 PREREG §8).
- There is no temperature control.

**Against.** Assignments are bound to the model id, engine and decoding settings, and any change voids them
(ROADMAP §2.3, §2.7).

**Settles it.** Re-qualification test: re-run the frozen C0 artifacts after a model or CLI change and measure
the drift in success and cost.

### W11. Meta-overhead: deciding costs more than it saves

**Pointless because** routing plus construction plus verification costs more than doing simple tasks directly,
and no slider setting fixes that.

**For.** Nothing has been measured. [I] Most agentic-coding tasks may be one-off.

**Against.** A rule-based router costs almost nothing.

**Settles it**
- A mixed stream of easy and hard tasks.
- Arms: always direct; always workflow; the router at three slider settings.
- Pass condition: at least one setting Pareto-dominates both extremes on cost and success.

### W12. Scope collapse

**Harmful because** the new asks consume the budget before any number exists. R07 says this already happened
once ("assurance first … used up the budget").

**For**
- [D] T:2677: about 61K lines added in about a day.
- 798 tests.
- No claim-bearing number.
- New asks: UI, board, swarm, nesting, a need-router, Rust.

**Against.** Capability-first rules exist (ROADMAP §6.5).

**Settles it.** A process rule: no new subsystem without a pre-registered experiment that needs it.

### W13. The labs absorb it

**Pointless because** Claude Code workflows, plugin-eval deltas and Managed Agents outcomes already cover much
of the core within about 12 months (R02 §c, R07).

**For**
- [D] R02 §1: plugin eval shipped 2026-09-07 with with/without deltas.
- Managed Agents has graded outcomes.

**Against**
- CC workflows replay agents, not compiled steps.
- They keep no score history or oracle independence (R07 "What survives").

**Settles it.** C0 and C2 against the strongest native setup. The moat claimed in THESIS §6 (cross-vendor
selection) needs a second vendor, which does not exist here.

### W14. Interaction failures when workflows compose

**Harmful because** nesting and parallel workflows produce:
- deadlocks;
- budgets counted twice;
- two writers on one resource;
- cancellation storms;
- recursive spawn blow-ups;
- labels laundered across `call`.

**For.** None of the composition semantics exists yet (gap 4). Owner item 59 asks for "all possible
combinations".

**Against**
- ROADMAP §2.1 and §2.9: call-by-hash, budget carving, one writer, and a `plan/expand` that may only narrow
  privileges.
- The DAG plus bounded nesting is deadlock-free today. [I] It stays that way only if `call` has a depth cap and
  is acyclic.

**Settles it**
- A composition conformance suite: depth caps, budget algebra, the one-writer rule, cancellation propagation
  and label passing.
- Adversarial composition tests.
- The game-QA reference (R08 §5) as the end-to-end case.

---

## Owner decisions this audit surfaces

1. **Record the 2026-10-07 model roles in THESIS and ROADMAP:**
   - Haiku 5.5 must construct, edit and run workflows;
   - Opus and Sonnet at xhigh build Foundry;
   - local generative models are parked;
   - Kev is the local judge.

   Today they live only in the C0 pre-registration and the transcript.
2. **Define the 94% target** as "expressible and executed on the corpus, plus an agentic slice", not static
   expressibility alone.
3. **Confirm the scoping in the non-goals box:** the UI is a read-only inspector, the board is run- and
   workflow-scoped, and a swarm is an operator that must beat B5.
4. **Usage priority until 2026-10-14:** P1 and C0 first, then this review's build items.
5. **Finish the sentence "it becomes essentially …"**.
