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
| A5 | Sub-workflows in long-horizon enterprise tasks, built correctly [89]; workflow inside a workflow; **an agent inside a node realises it needs a sub-workflow and creates one** [20][70] | D/⚠ | COMP-1 inconclusive (pooled M1 0.918); flow.call by hash exists; [RESULT-SW-1](subworkflow-20261021/RESULT-SW-1.md) (dev, K=1, one bed, golive d4-d5, Haiku): a **parent-directed** in-node sub-workflow passes 27-32/32 backlog nodes vs the node alone's 11/32 at 0.3-0.5x the cost; **node realises on its own: 6/32 (A1), no measurable gain (15 vs 11, p = 0.45)**; scope: one flat sub-problem per node, depth 2 and iteration never used in a paid run, not long-horizon | **the literal [70] ask is not shown and [89]/[20] are untested; [PREREG-SW-1c](subworkflow-20261021/PREREG-SW-1c.md) frozen, not launched (about $3.70 Haiku, needs an owner budget): reworded self-build offer, A1T, code-tool and gate baselines, observable trigger at the need boundary; then a long-horizon, depth-2 bed** |
| A6 | Messy, poorly defined tasks → maximal optimal intent ("what would be needed and what could be needed") [92] | B | SPEC-0 bed, four-layer truth, SPEC-1 runner ready | freeze after the engine merge; run SPEC-1/INTENT-1 |
| A7 | Tracker: log the user's conditions and check the build against them, without over-engineering [67] | B | A1-C ledger, SPEC-1 derive-ledger, TRACKER-DESIGN | product-level tracker in app/ (task #60) |
| A8 | Give the builder templates and the corpus's hardest enterprise patterns so it builds robustly [67] | D/⚠ | CI-1 (`research/ci1-20261021/RESULT-CI1.md`, development evidence): templates bind 0 of 33 real corpus items; pattern cards add a few points at most on small, deterministic n8n items (A2 rerun − A1c +2.6 corrected), retrieving them is no better than a static block of all 16 (preregistered review arms, RESULT-CI1.md §11.4); the cheapest good builder is one-shot + a practice run ($0.0070 and 46 s per verified build) | **the ask itself is untested:** no payment, Jira, approval or compensation item and no "hardest" pattern in the bed; patterns never used as a robustness critic in the repair loop (plan: RESULT-CI1.md §11.6, E-bed / E8-class items with pattern-as-critic arms) |
| A9 | Reuse = a proven workflow reused by a *separate program* [48] | D, ⚠ | C2-1 (preregistered, Haiku builder, K = 2, $1.82): SOP-Bench's frozen dangerous_goods workflow reused byte-identical by a second program; the preregistered producer-profile gate was **inferior** to rebuilding, 85% vs 98% (wrong reuse 32/112). Post-hoc gate on the consumer's own 15 labels (G0): 98%, equal to rebuilding item by item, 0 wrong of 91. C2-2 (preregistered, $0, gates only, **no baseline**): 0 wrong in 98 accepted on fresh suppliers, **no M3 certificate** when clustered by supplier, the admission unit (upper 0.085); fails on drift after the history (17/17 wrong). C2-3 (preregistered, K = 2, $0.81): a Haiku agent given the same 15 labels scores 91.5%, the no-label agent 57%; rebuilding and G0 lead it by 6.4–6.8 pts, mostly on items the labels leave open where B's bands equal the builders' default by construction. B's own contract lookup checked post-hoc ($0); the runs fetched the entry by id. Development evidence, self-authored program B [RESULT-C2-1](reuse-20261021/RESULT-C2-1.md), [RESULT-C2-2](reuse-20261021/RESULT-C2-2.md), [RESULT-C2-3](reuse-20261021/RESULT-C2-3.md) | **no preregistered accuracy result for the history-gated reuse against a baseline** (its positive result is post-hoc, then a gate-only confirmation); reuse ties rebuilding on accuracy and saves about 5 builds per lineage at ~20 items per supplier, and is no faster at volume; post-admission monitoring with fresh labels; a second proven entry (M3b); a second program the experimenter did not write; not sealed |
| A10 | Procedure distillation: frontier-authored workflow, cheapest qualified model per node [0] | D | JIT tier-down tool; per-node model roles in A1-C (Mercury planner); tierdown 2026-11-04 (dev, reviewed): preregistered 0% saved, nothing promoted; held-out exploratory 2.8% delivery judge cost at equal outcomes, equal accuracy not shown (research/tierdown-20261021/RESULT-TIERDOWN.md §0) | **gap:** no all-frontier accuracy arm (cost estimate only: 9× the compiled solvers); per-site bounds need a fresh draw sized to the class, unit = task; the decisive date-order leaf needs its own reader scored against ground truth |

## B. Deciding when a workflow is needed

| # | Owner ask | Status | Evidence | Gap / next |
|---|---|---|---|---|
| B1 | **"the goal ... is to detect if a certain task needs a workflow or not. And testing is the biggest part"** [62]; primitives → formula/threshold, tuned so no-workflow tasks never trigger [74]; routine coding usually no workflow, startup CI/CD or research programs yes [75]; sensitivity slider [20]; Jev for it [70] | **P (negative for code), ⚠** | ROUTER-1 ([RESULT](need-router-20261014/RESULT-ROUTER-1.md), review addendum 11-04): 319 labelled requests, frozen split, preregistered. Code router v1 on test: 9/132 false triggers, recall 0.67, F1 0.74 (fails never-trigger); a $0 n-gram classifier ranks as well (AUROC 0.918 vs 0.915); Haiku direct 5/132, recall 0.97, F1 0.944 at $0.00026 (also fails never-trigger at its default); Mercury as a system F1 0.900. Same-author labels, rubric quoted 6 test items. Shipped as `src/need/` + MCP/CLI: a labelled code-only hint by default, or the code pre-filter + a capped model judge (post-hoc); the slider works at both ends in every path; each answer states its measured operating point | **sealed check written and labelled by the owner ([ROUTER-2 draft](need-router-20261014/router2/PROTOCOL-ROUTER-2.md)); Jev run; launch-on-decision; counterfactual value of the workflows (label factory); owner decision on the ROADMAP §2.8 departure** |
| B2 | Route tasks to agents/models automatically, with user control per node [70] | B | model policy class routing; per-role node models (A1-C) | product UI control |

## C. Judgment models (Kev/Jev)

| # | Owner ask | Status | Evidence | Gap / next |
|---|---|---|---|---|
| C1 | Deep analysis of Kev; fine-tune Kev 0.8B for every need; use the laptop GPU [13][14][15][16] | R/⚠ | laptop bridge built; stock Kev ≤ rule baseline on 4/5 ports; owner moved to hosted Jev (10-09); J2 prereg draft | Kev fine-tune never done; J2 not run |
| C2 | Jev for routing, templates, need-a-workflow; "we implemented it right?" [68][70] | B/⚠ | Jev in policy (jev-1.13.0), J1 on Jev done; ROUTER-1 Jev pass built and frozen (1,116 requests) but **not run: no Jev credential in the session (PREREG-ROUTER-1 D1)** | **Jev is still not wired into the need router; run `judges.mjs --judge jev` with the owner's key, then wire it only if it beats Haiku on the same items** |

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
| E6 | Corpus-based construction tests ("build X from a description, check by execution") [0][67] | D | CI-1 bed (33 real n8n.io items, sandboxed reference, two-reference admission, mutation-adequate hidden worlds), capability numbers against the one-shot baseline. **Not P:** the frozen oracle failed its validity check on both waves (RESULT-CI1.md §0); corrected numbers are post hoc; items held out, not sealed | freeze gates now exist ($0 false-negative probe + two-build ambiguity probe, RESULT-CI1.md §11.2): use them on the next bed and run it sealed (descriptions by a session that never sees builder code or results) |
| E7 | Breadth [102] | R→B | breadth workflow running | Tier-1 adapters, family factory |

## F. Product, onboarding, business

| # | Owner ask | Status | Evidence | Gap / next |
|---|---|---|---|---|
| F1 | Node UI: breathing-dot nodes, click to expand chat; run history with summaries [20][32] | B | run-history UI (#22), tools/run-view, app/dashboard | live node graph with state dots in the product |
| F2 | Dashboard, chat creation BYOK/Mercury, MCP into coding agents, existing workflows, seamless for anyone [95] | B/D | app/ spike; BUILDER-1 | onboarding site (workflow running) |
| F3 | Onboarding for orgs and solo devs; what to ask and connect; build the site [99] | R→B | onboarding workflow running | — |
| F4 | Nodes get MCP servers, skills, CUA, connections; skill/plugin finder/creator; exactly what they need; adaptivity [75][99] | R→B, ⚠ | nodecap workflow running; [RESULT-SW-1](subworkflow-20261021/RESULT-SW-1.md) on [75] (dev, K=1, one bed): when the parent decides, self-build and the governing builder **tie on construction** (the governing route lost 5 nodes to a lossy request protocol and judge noise, fixes built at $0); when the node decides, the comparison is **confounded** (offer wording, catalogue); the governing builder had no extra capability, so escalation for a capability the node lacks is **untested** | in-node sub-solution vs escalate [75]: PREREG-SW-1c (frozen, not launched); a bed where the sub-problem needs a capability only the governing harness can grant |
| F5 | Org invariants/layers; open core vs paywall [81][94] | D | OT-0 $0 done, paid arms running; OPEN-CORE, ATTACK-FABLE, D1/D2 | OT-0 verdict |
| F6 | Don't spend on mobile layouts [44] | ✓ | — | — |

## G. Process

| # | Owner ask | Status | Gap / next |
|---|---|---|---|
| G1 | "every failure deeply figure out", root cause, no subpar results tolerated [99][106] | ⚠ | per-failure root-cause records for every bed: AutomationBench (verifier-lab, A1-C v2), COMP-1 (go-live → E1), BUILDER-1 (code/template defects), SOP-Bench (after the seal), OT-0 (guard) |
| G2 | README single entry; RESEARCH.md keeps negatives [0] | ⚠ | update both with 10-15 → 10-21 evening results |
| G3 | Never give up; question ideologically; niche prior art [40][47][77] | ongoing | — |
