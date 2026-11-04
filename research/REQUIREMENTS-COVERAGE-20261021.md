# Owner requirements: coverage matrix (2026-10-21, 19:15Z)

**Source.** All 107 unique owner messages in this session's transcript, 2026-10-06 → 2026-10-21, read in full
(`[n]` = message index in the extraction at the orchestrator's scratchpad `req/user-messages.json`). Status is from repo
evidence, not memory.

**Status values:**
- **P**: preregistered held-out proof
- **D**: development evidence with a capability number against a baseline
- **B**: built, tested at $0, no capability number
- **R**: design or research only
- **0**: not started
- **⚠**: stalled, or a gap the owner explicitly raised

## A. Core thesis and capability

| # | Owner ask (quote or summary) | Status | Evidence | Gap / next |
|---|---|---|---|---|
| A1 | Bounded, typed, task-scoped workflows; code owns procedure; cheap models execute what frontier models author [0] | D | engine + flow-v3 + JIT; R-bench: Haiku with an expert workflow solves 35/36 at ~1/20 the cost [40] | held-out across families (breadth) |
| A2 | "if haiku + harness is not good enough to match frontier ... this is really poor"; elevate a weak model [93]; **the frontier is Opus 5.5 xhigh** [105]; "pass rate still too low" [105]; "90 percent" [88] | D, ⚠ | Mercury planner + Haiku 29/60 = Sonnet+A1 28/60 (dev60); devCheck A1-C 20/60; any-arm ceiling 41/60 | **Opus xhigh baseline queued; verifier-lab (verification is the bottleneck); A1-C v2; ceiling analysis of 19 never-passed** |
| A3 | Construct complex workflows cheaply; Haiku vs Opus one-shot [32][46]; recreate niche custom workflows and improve them [26]; "most complex workflows the biggest orgs use is the bar" [51] | D | B1-E8-DEV: Haiku + practice loop 14/14 vs Opus one-shot 5/14; BUILDER-1 18/21 vs 5/21; replication streams | E1–E13 enterprise bar: only E7/E8 executable |
| A4 | Worst-case complex workflow vs the hand-crafted real one; runs expose flaws; self-healing reaches a durable state ≥ human [46][70] | B/D, ⚠ | replication streams (#39); auto-heal live **did not beat retry** [40] | **heal blocked since 10-15 (HEAL_POLICY_DRIFT owner choice D6): decide and unblock; failure handling vs retry with the new verifiers** |
| A5 | Sub-workflows in long-horizon enterprise tasks, built correctly [89]; workflow inside a workflow; **an agent inside a node realises it needs a sub-workflow and creates one** [20][70] | D/⚠ | COMP-1 inconclusive (pooled M1 0.918); flow.call by hash exists | **adaptive in-node sub-workflow creation never tested** |
| A6 | Messy, poorly defined tasks → maximal optimal intent ("what would be needed and what could be needed") [92] | B | SPEC-0 bed, four-layer truth, SPEC-1 runner ready | freeze after the engine merge; run SPEC-1/INTENT-1 |
| A7 | Tracker: log the user's conditions and check the build against them, without over-engineering [67] | B | A1-C ledger, SPEC-1 derive-ledger, TRACKER-DESIGN | product-level tracker in app/ (task #60) |
| A8 | Give the builder templates and the corpus's hardest enterprise patterns so it builds robustly [67] | B | template library (7) + E8 templates; corpus prior | pattern retrieval from the corpus into the builder |
| A9 | Reuse = a proven workflow reused by a *separate program* [48] | 0, ⚠ | task #43 pending; SOP-Bench is build-once/run-many inside one program | **C2 reuse experiment** |
| A10 | Procedure distillation: frontier-authored workflow, cheapest qualified model per node [0] | D | JIT tier-down tool; per-node model roles in A1-C (Mercury planner) | tier-down of hot judges (#33) |

## B. Deciding when a workflow is needed

| # | Owner ask | Status | Evidence | Gap / next |
|---|---|---|---|---|
| B1 | **"the goal ... is to detect if a certain task needs a workflow or not. And testing is the biggest part"** [62]; primitives → formula/threshold, tuned so no-workflow tasks never trigger [74]; routine coding usually no workflow, startup CI/CD or research programs yes [75]; sensitivity slider [20]; Jev for it [70] | **R, ⚠** | README: "Need router and slider: Design only"; PREREG-NEED-V1, anchor beds, NL0 pilot partial | **build and measure the need router end to end (primitive rules + threshold slider + cheap judgment for the middle; capability number against always/never/ask-Haiku baselines)** |
| B2 | Route tasks to agents/models automatically, with user control per node [70] | B | model policy class routing; per-role node models (A1-C) | product UI control |

## C. Judgment models (Kev/Jev)

| # | Owner ask | Status | Evidence | Gap / next |
|---|---|---|---|---|
| C1 | Deep analysis of Kev; fine-tune Kev 0.8B for every need; use the laptop GPU [13][14][15][16] | R/⚠ | laptop bridge built; stock Kev ≤ rule baseline on 4/5 ports; owner moved to hosted Jev (10-09); J2 prereg draft | Kev fine-tune never done; J2 not run |
| C2 | Jev for routing, templates, need-a-workflow; "we implemented it right?" [68][70] | B/⚠ | Jev in policy (jev-1.13.0), J1 on Jev done | **Jev is not wired into the need router or template routing; say so plainly, then wire it where it beats Haiku** |

## D. Expressiveness, engine, orchestration

| # | Owner ask | Status | Evidence | Gap / next |
|---|---|---|---|---|
| D1 | Represent any and all workflows (target ~94%+), nested, iterative; reject rather than flatten [20][21] | D | corpus coverage + agent-framework corpus (#19) | refresh numbers with call/compensate (C6) |
| D2 | Subagents/parallel/waits robust across hosts and meta-harnesses; the system owns plumbing [95] | D | chaos 20 → 35/43 (engine v2, held for merge) | macOS, no-/proc hosts, quota throttle, budget reservations |
| D3 | Swarms (Kimi-style) in scope? [20] | B | W-bed R6 swarm bed | paid ladder run |
| D4 | Memory: shared board vs private notes; deep research [20][70] | R | ROADMAP blackboard (§334) | deep research report, today's state of the art |
| D5 | Efficiency first; frontier/OSS SOTA fix per compromise [20][96] | D | FIXES.md (28 compromises); wave 1 building | waves 2–3 after the runs |
| D6 | Rust port? [20] | R | answered then; no port | — |

## E. Benchmarks, breadth, evidence

| # | Owner ask | Status | Evidence | Gap / next |
|---|---|---|---|---|
| E1 | Best existing benchmarks and our own; executable oracles with controls [0][89] | D | AutomationBench, SOP-Bench, E7/E8, W-bed, records, kinetics, incident | **breadth workflow running** (AppWorld, τ², etc.) |
| E2 | Generalisation: game QA, visual and interactive, scientific, data repair, research synthesis, creative/media, ops, web QA, puzzles [0] | D (game QA: dev, single-author, DOM-only); ⚠ visual; ⚠ held-out; ⚠ (rest) | **game QA (2026-11-04, after independent review):** `beds/gameqa-web` (browser game, 12 injected faults, frozen truth, 1-minimal-repro oracle; the public spec states a rule for every fault). GQA-1 preregistered, K = 5 per arm, Haiku 5.5: QA workflow 6.4/12 (frozen) and 5.0 (single-CLI replication) bugs per run vs Haiku alone with the frozen agent protocol 1.0 / 0.8 and random monkey 1.0 (H1 p = 0.004, R1 p = 0.048); against an agent matched on prompt, report log, stop rule and dollars (4.4) the same-day lead is 0.6, not significant (C1); personas add nothing (H4, R4) and the random-exploration variant gets 6.4 / 4.2 for $0.015 / $0.013 a run vs the workflow's $0.067; 0 false reports from any workflow run; one of ten constructions produced no usable check ([RESULT-GQA-1](gameqa-20261021/RESULT-GQA-1.md)). Mercury: agent 4.7, workflow could not construct. science/ops/data/business beds exist; **no pixel-vision, web-QA or creative bed** | held-out game bed (separate author, spec before faults, or automated mutants with a driver change); template robustness (repair on evaluation errors) and a hybrid workflow + trace-reading agent arm; construction fixes for transition/clause/conservation checks; vision pass needs an image route in the policy |
| E3 | Sealed held-out tasks by a separate author; no K=1 comparative claims [0] | P/D | SOP-Bench sealed running; most comparisons still K=1 (labelled dev) | pass^k on AutomationBench; group-sequential (FIXES A4) |
| E4 | Baselines B0, B0+N (notes), B1 (CC-workflow script), B2 memory/skills, B5 best-of-K same verifier, hand-written ceiling [0] | ⚠ | B0 and B1-style present; **B5, B0+N and B2 not run on AutomationBench** | B5 inside verifier-lab; B0+N/B2 in the breadth prereg |
| E5 | Publish an AutomationBench score [74] | — | frozen test run planned (PREREG-AB-v1) | needs the owner's explicit "publish" (D13) |
| E6 | Corpus-based construction tests ("build X from a description, check by execution") [0][67] | B/⚠ | n8n importer; CI-1 pilot planned | run CI-1 |
| E7 | Breadth [102] | R→B | breadth workflow running | Tier-1 adapters, family factory |

## F. Product, onboarding, business

| # | Owner ask | Status | Evidence | Gap / next |
|---|---|---|---|---|
| F1 | Node UI: breathing-dot nodes, click to expand chat; run history with summaries [20][32] | B | run-history UI (#22), tools/run-view, app/dashboard | live node graph with state dots in the product |
| F2 | Dashboard, chat creation BYOK/Mercury, MCP into coding agents, existing workflows, seamless for anyone [95] | B/D | app/ spike; BUILDER-1 | onboarding site (workflow running) |
| F3 | Onboarding for orgs and solo devs; what to ask and connect; build the site [99] | R→B | onboarding workflow running | — |
| F4 | Nodes get MCP servers, skills, CUA, connections; skill/plugin finder/creator; exactly what they need; adaptivity [75][99] | R→B | nodecap workflow running | in-node sub-solution vs escalate to the governing builder [75] |
| F5 | Org invariants/layers; open core vs paywall [81][94] | D | OT-0 $0 done, paid arms running; OPEN-CORE, ATTACK-FABLE, D1/D2 | OT-0 verdict |
| F6 | Don't spend on mobile layouts [44] | ✓ | — | — |

## G. Process

| # | Owner ask | Status | Gap / next |
|---|---|---|---|
| G1 | "every failure deeply figure out", root cause, no subpar results tolerated [99][106] | ⚠ | per-failure root-cause records for every bed: AutomationBench (verifier-lab, A1-C v2), COMP-1 (go-live → E1), BUILDER-1 (code/template defects), SOP-Bench (after the seal), OT-0 (guard) |
| G2 | README single entry; RESEARCH.md keeps negatives [0] | ⚠ | update both with 10-15 → 10-21 evening results |
| G3 | Never give up; question ideologically; niche prior art [40][47][77] | ongoing | — |
