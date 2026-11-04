# Every idea in this session, and where each one stands (2026-11-04, 21:00Z)

**What this is.** Each idea the owner raised in this session, plus each idea the research adopted (decisions D1–D35, the
ATTACK moves, the engine work). For each one it gives the status, the evidence for that status, and what is left.

**How it was made.** All 132 messages the owner typed in this session were extracted from the session transcript; the
numbers in brackets, like [23], refer to that list. The three messages sent mid-turn on 2026-11-04 are marked [today].
The statuses come from the committed results, read on 2026-11-04, not from memory. This supersedes
`research/REQUIREMENTS-COVERAGE-20261021.md`, whose bracket numbers follow an older list.

**Status codes**
- **✅ measured, positive**: a number against a simple baseline, with its evidence class.
- **❌ measured, negative**: kept as a negative result.
- **◐ mixed or partial**: part of the idea is shown, part is not.
- **🔧 built, not measured**.
- **⏳ running**: one of the three workflows still in flight (gap-closure-2, durability, breadth).
- **📐 designed or researched only**.
- **⬜ not started**.
- **➖ dropped or superseded** by an owner ruling.
- **💬 answered**: a question, answered in chat or in a document.

**Evidence classes**
- **sealed**: frozen split, decision rule fixed before the run.
- **held-out**: unseen tasks, same author.
- **dev**: development evidence.

Almost everything here is dev or held-out. One result is sealed: SOP-Bench phase 2.

---

## A. The core thesis

| # | Idea | Source | Status | Evidence | Left |
|---|---|---|---|---|---|
| A1 | Bounded, typed, task-scoped workflows ("micro harnesses"): code owns procedure, models make narrow typed judgments, cheap models execute what frontier models author | [1] | ✅ | **Sealed:** SOP-Bench, a workflow Haiku built once: pass^3 87.6% against the Haiku agent's 67.1% (+20.5 points [18.1, 23.0]), at $0.00055 per run against $0.0017. **Held-out:** AutomationBench look 2, A1-C v2 29/60 against plain Haiku 9/60 (p 1e-5). **Dev:** P1 records, Haiku workflow 35/36 against one Sonnet call 28/36 | Not yet met: the reliability bar of pass^3 ≥ 90% with a lower bound ≥ 85% |
| A2 | Disposable by default; keep a workflow only when reuse pays | [1] | ◐ | C2-1 (reuse through the profile gate, 85% against 98% for rebuilding) ❌; C2-2 (a conformance gate: 0 wrong reuse in 98) ✅; C2-3 (the agent given the same labels, 91.5%) | A reuse rule that wins on cost and accuracy together |
| A3 | Run durably | [1] | ✅ | Conformance suite: Foundry 11/11 properties. LangGraph 1.2.19 is native on 1 of 8 (`research/proof-20261104/CONFORMANCE.md`). Chaos suite 35/43. Engine suite 1,414/1,415 (the one failure depends on the checkout's location) | Temporal not executed (server download refused); OpenAI Agents SDK and CrewAI not yet attacked |
| A4 | Adapt while running | [1][75] | ◐ | FH-1: patch → replay removes 75.2% of real failing cases with 0 regressions, against retry at 0 (dev, given frontier-written contracts). SW-1: a sub-workflow the parent decides passes 27–32 of 32, against 11 for the node alone | Adapting over time is DUR-1 ⏳. A node deciding for itself chose a sub-workflow 6/32 times and gained nothing |
| A5 | Verify against locked contracts | [1] | ✅ | Verify nodes (code, capability, agent, ledger); tri-state verdicts (UNKNOWN never passes); hash-pinned graders; engine identity binding | Δ\* (an expected-diff contract derived in code) is in the lab, not in the A1-C pipeline |
| A6 | Do not build a meta-harness, an offline optimiser, a general agent loop, a visual builder, a memory store, a model gateway, or a LangGraph/n8n clone | [1] | ✅ kept | Visual UI is the owner's (D33). No offline optimiser was built. Harness² is one; see §K | — |
| A7 | Elevate a weak model to match frontier | [99][111] | ◐ | Look 2: A1-C v2 (Haiku) 29/60 at $0.029 per task, against Opus 5.5 xhigh 26/60 at $0.385. Descriptive only; no test was run against Opus (prereg §9.6). Dev60 VL-1 selection 32/60 | A tested, sealed comparison against Opus |
| A8 | Procedure distillation: a frontier-authored workflow, the cheapest qualified model per node | [1] | ◐ | JIT records stream: Sonnet interpreter → Haiku compiler 22/24 against an Opus agent 24/24 (dev, K = 1). Tier-down: cheaper tiers hold on the leaf judges, but fail on the expensive global readers (⏳ branch c30-9) | Held-out stream; promoting a tier-down |

## B. Construction: who builds, from what

| # | Idea | Source | Status | Evidence | Left |
|---|---|---|---|---|---|
| B1 | Haiku 5.5 is the constructor, working from templates | [23][35] | ◐ | C0: Haiku writing the IR 11/16 against Opus 16/16 ❌. BUILDER-1 template builder: Haiku 18/21, Mercury 18/21, one-shot Haiku 5/21 ✅. E8: Haiku with a practice-world loop 14/14, against an Opus one-shot 5/14 ✅ | Held-out construction beyond these beds |
| B2 | Can Haiku cheaply build what Opus would one-shot? | [35] | ◐ | Yes when it has a practice loop or templates (E8, BUILDER-1, CI-1); no when one-shot to the raw IR (C0) | — |
| B3 | Give the builder the templates and the corpus's hardest patterns | [72] | ✅ | CI-1 (held-out n8n items, K = 3): leave-one-out corpus pattern retrieval A2 reaches 80.7% pass@1 on oracle v1, against the one-shot 64.9% (93.0% against 80.7% on oracle v2, post hoc) ⏳ unmerged | Seal it; a second corpus |
| B4 | Train a small model to compose (corpus + Foundry syntax) instead of Haiku | [28][50][61] | 📐 | Composer question (#40) pending; templates, retrieval and the skill pack were chosen first as cheaper levers | Measure the composer only if retrieval saturates |
| B5 | Skill pack: the most information-efficient instructions for constructing workflows | [126] | 🔧 | `skills/foundry-construct/`, whose IR reference is generated from the schema. SKILLPACK-1 approved at $20 (D34) | Run SKILLPACK-1 |
| B6 | Scale adaptation (a 300 GB research program, auditing a huge messy codebase) | [126] | ◐ | Coverage ledger verify method (`src/ledger.mjs`); sizing planner (Clopper–Pearson); `scale.md` in the skill pack; data handles step 1 (blob store); step 2 label prerequisite committed on branch `data-handles` (`9fb74487`) | Step 2 producers and consumers (`data.import/split/inventory`, `$read`, blob-text render, BLOB_* checks), then a real large-input test |
| B7 | Fan-out proportionate to the model's capacity and the task, not "1000 agents" | [128] | 🔧 | `src/sizing.mjs`, `tools/sizing/plan.mjs` | Use it in a measured run |
| B8 | Messy, poorly defined tasks → the maximal optimal intent | [98] | ◐ | SPEC-0 bed with four-layer truth; inter-rater check: stated 6/6, not-wanted 23/23, κ 0.57 on implied against latent | SPEC-1/INTENT-1 paid runs |
| B9 | Tracker: log the user's conditions and check the build against them, without over-engineering | [72] | ✅ ⏳ | Held-out (14 new requests, 97 builds): caught 37/37/40 defective builds in the three samples, against 2 for no tracker; precision 0.90–0.97. Unmerged branch c30-6 | Not met: H1 (precision ≥ 0.95) and H2 (zero false alarms) |
| B10 | Information sharing between workflows and nodes: a shared board and private notes | [23][75] | ◐ | Memory study (merged): the board adds little over plain edges plus state slots; it stops three echo attacks; only the labelled store stops a secret leak | A board primitive only if a bed needs it |
| B11 | Agents inside a node: build their own sub-solution, or ask the governing builder? | [80] | ✅ (dev) | SW-1: when the parent decides, sub-workflows win (27–32 against 11 of 32); left alone, a node chose one 6/32 times. Recommendation: the parent decides | Not sealed; one bed |

## C. Deciding whether a workflow is needed

| # | Idea | Source | Status | Evidence | Left |
|---|---|---|---|---|---|
| C1 | Detect whether a task needs a workflow; testing is the biggest part | [23][67] | ❌ / ◐ | ROUTER-1 (held-out 193): the preregistered code router 9/132 false triggers, recall 0.67. Haiku asked directly 5/132, recall 0.97 (same-author labels) | ROUTER-2 sealed check, drafted |
| C2 | Primitives → a formula and threshold, tuned so pre-classified no-workflow tasks never trigger | [79] | ❌ | The lexicon fit on dev failed on test; a $0 n-gram classifier ranks as well (AUROC 0.918 against 0.915) | "Never" restated as a bounded false-trigger rate (D28) |
| C3 | A sensitivity slider | [23] | ✅ | Fixed in the merge review (M2): 0 never triggers, 1 always does, the result is monotonic in the slider, and no model call is made at the ends | — |
| C4 | Use Kev/Jev for the need decision and routing | [23][73][75] | ➖ | Jev dropped (D26); stock Kev ≤ the rule baseline on 4 of 5 probes | — |
| C5 | Routine coding needs no workflow; a startup's CI/CD or an OSS maintenance cycle may | [80] | 📐 | Need-router families include these classes | — |
| C6 | The need judge obeys the workspace's Allowed AI setting | today's merge | ✅ | `app/test/need-allowed-ai.test.mjs` | — |

## D. Engine, expressiveness, orchestration

| # | Idea | Source | Status | Evidence | Left |
|---|---|---|---|---|---|
| D1 | Represent any and all workflows (~94%+); nested and iterative; reject rather than flatten | [23][24] | ✅ | Corpus coverage plus the agent-framework corpus (#19); nesting depth 6; loops capped; unsupported semantics rejected by name | Re-measure on the current engine |
| D2 | Subagents, parallel branches and waits robust across hosts; the system owns the plumbing; worst real-world cases | [23][101] | ✅ | Chaos 35/43 → engine v2; conformance 11/11; worker-loss, changed-code resume and tamper tests | Run the 8 open chaos items on macOS and other hosts |
| D3 | Swarms (Kimi-style) in scope | [23] | ❌ (dev) ⏳ | Swarm ladder rung 1: the Haiku swarm lead started 0 workers in 8 of 8 sessions; swarm 4/7 = single agent 4/7 ($7.60). Unmerged branch c30-10 | A trained or forced fan-out arm, if pursued |
| D4 | Every component maximally efficient; a SOTA fix per compromise | [23][102] | ◐ | Compromise register: 28 items, waves 1–2 adopted (CLI pin C2, orchestration patches, …) | Wave 3 |
| D5 | Rust port | [23] | 💬 | No port; the hot path is model latency | — |
| D6 | Data handles for very large data (engine gap 1) | proposed from [126] | ◐ | Step 1 store built; the label prerequisite built and mutation-tested (5/5 mutants killed) | Step 2 |
| D7 | Node capabilities: per-node MCP servers, skills, computer use, connections; a broker; "exactly what it needs and nothing more" | [80][105][today] | ✅ (dev) | Merged (29 files). NODECAP-1 amendment (K = 2, $0.15): arms U 9.5, A 9.5, C 1, B 9 of 12; safety rules R1, R2 and R4 met. Tier-0 MCP outputs now carry their untrusted label into the engine (today) | Production integration work (§F2) |
| D8 | Principals, approvals, segregation of duties, effect gates, taint (data and control) | engine | ✅ | Conformance properties P8 and P10; control-taint fuzz | — |
| D9 | Coverage ledger: a fan-out proves it read every unit | proposed | 🔧 | `verify` method `ledger` | Use it in a measured scale run |

## E. Benchmarks, breadth, evidence

| # | Idea | Source | Status | Evidence | Left |
|---|---|---|---|---|---|
| E1 | The best existing benchmarks plus our own beds, each with executable oracles and controls | [1] | ◐ | Beds: AutomationBench (bridged), SOP-Bench (exact parity, 1,315/1,315), E7/E8, W-bed, records, kinetics, incident, gameqa, golive, NC-1, SPEC-0. Breadth ⏳: WorkBench sealed gold 132/132, AgentDojo parity, AppWorld parity (BG-3 at 86.1%, owner decision) | τ²/τ³, Terminal-Bench, SWE-bench Pro, ARC-AGI-3 not run |
| E2 | Baselines B0, B0+N (notes), B1 (a CC-workflow-style script), B2 (memory/skills), B5 (best-of-K, same verifier), a hand-written ceiling | [1] | ◐ | B0 everywhere; B1-style in E8/CI-1; VL-1 is a B5-like selection; hand ceilings on P1 records | **B0+N and B2 never run as arms** |
| E3 | Sealed held-out tasks by a separate author; no K = 1 comparative claims | [1] | ◐ | Sealed: SOP-Bench p2 only. AutomationBench looks are held-out but from a public split. Most comparisons are K = 1 dev | A separate-author sealed set for the product claims |
| E4 | Publish an AutomationBench score | [79] | ⬜ | The frozen test run (PREREG-AB-v1, test once ≤ $40) has not run; it needs the owner's explicit "publish" (D13) | Owner's call |
| E5 | Generalisation: game QA, science, data repair, research synthesis, creative/media, ops, web QA, puzzles | [1] | ◐ | GQA-1 (browser game, dev): the frozen workflow found 6.4 of 12 injected bugs per run, with valid, replayable repros, against 4.4 for a matched agent (p 0.024, post hoc). Most of the earlier, larger gap came from the agent's handicaps. Ops (incident/runbook), data (records), science-ish (kinetics), web QA (gameqa) | Creative/media, puzzles; sealed versions |
| E6 | Construction tests from the corpus ("build X from a description, check by execution") | [1][72] | ✅ ⏳ | CI-1, as in B3 | — |
| E7 | Breadth | [108] | ⏳ | Breadth program: WorkBench, AgentDojo, AppWorld adapters with parity gates; family factory | Paid breadth runs |
| E8 | Prove it creatively and cheaply against every competitor; frontier-style showcase workflows | [130] | ◐ | Conformance suite against LangGraph ($0); Opus 5.5 xhigh comparator; P1, VL-1, OT-0 against frontier agents | Showcase tasks (≤ $60, preregistered, with a $0 rehearsal) not started; Agents SDK and CrewAI attacks |

## F. Product, integrations, business

| # | Idea | Source | Status | Evidence | Left |
|---|---|---|---|---|---|
| F1 | Node visualisation (breathing dots, state colours, click to expand the chat), run history with summaries | [23][35] | ◐ → owner | Run-history UI (#22); run-graph data and routes (`foundry-run-graph/1`, ⏳ c30-8). D33: the owner builds the visual engine; we supply the data | — |
| F2 | Production-grade integrations: MCP, skills and connectors throughout | [today] | ◐ | Mechanism built (nodecap: launcher, sandbox, OAuth module, credentials from the environment, broker, approval for every effect) | Per system: auth lifecycle; an idempotency key per external write; rate limits; inbound webhooks; a real sandbox account (needs the owner's go: real accounts) |
| F3 | Dashboard, chat creation (BYOK/Mercury), MCP into coding agents, seamless for anyone | [101] | ✅ (product) | `app/` merged: onboarding site, cards, settings (Allowed AI), MCP server with 9 tools, approvals in the page | Persona walkthroughs on a real laptop |
| F4 | Onboarding for orgs and solo developers; what to ask them and what to connect | [105][123] | 🔧 | Onboarding workflow merged (teardown, site, persona walkthroughs, fixes) | Real users |
| F5 | Org-wide workflows; sections for control; invariants at layers; beat hand-curated org workflows | [100][today] | ◐ | Control primitives built; OT-0 (dev): Haiku plus validator 14/14 against Sonnet 5/14 and Opus 6/14 | The org-twin slice (2 processes, 1 shared invariant, 1 policy change) is designed, not built |
| F6 | Monetisation: an open core for solo developers, paid org tiers | [86][100][123] | 📐 | `research/business-*` (OPEN-CORE, org layers) | Owner's decision |
| F7 | Enterprise bar: break down the most complex proprietary and OSS business workflows and set them up cheaply | [56][72] | ◐ | E8 order saga, E7 ITSM slice, OT-0, CI-1 (n8n.io items) | The largest real org workflows (ERP-scale) not attempted |
| F8 | Ready for the owner's local agent to inspect and plug in on the laptop | [126] | ◐ | Laptop bridge (F1–F5 hardened); README run instructions | A one-command local quick start, checked on the laptop |
| F9 | Look at thesysdev/openui for node widgets | [56] | ➖ | UI is the owner's (D33) | — |
| F10 | Mobile layouts | [47] | ➖ | Owner: not wanted | — |

## G. Models and judgments

| # | Idea | Source | Status | Evidence | Left |
|---|---|---|---|---|---|
| G1 | Drop local models (too slow) | [16] | ✅ | Qwen3.5-2B: 268 s per call on 4 CPU cores, leaf agreement 0.80 | — |
| G2 | Fine-tune Kev 0.8B for every need, on the laptop's 4060 | [17][18] | ❌ / ⬜ | Laptop bridge built and used for J1 stock reads. Stock Kev ≤ the rule baseline on 4 of 5. Fine-tuning not run | Only if a judgment bed needs it |
| G3 | Mercury 3 as a second cheap model | [99] | ✅ | A1-C with Mercury 29/60 on look 2 (v1-M); BUILDER-1 Mercury 18/21; tokens listed at $0 under the allowance | Real Mercury cost per task |
| G4 | Auto-routing to models, with user control per node | [75] | 🔧 | Class routing in the model policy; per-role node models (A1-C roles) | Controls in the owner's UI |
| G5 | Opus 5.5 xhigh is the frontier to beat | [94][111][119] | ✅ (comparator run) | Dev60 28/60, look 2 26/60 at $0.385 per task | — |

## H. Process

| # | Idea | Source | Status | Evidence | Left |
|---|---|---|---|---|---|
| H1 | Preregister, freeze, keep every negative, root-cause every failure | [1][112] | ◐ | Every paid run since 10-21 was preregistered; failure anatomies for AutomationBench (dev60, P1), CI-1, swarm, tracker | README and RESEARCH need today's results |
| H2 | Never give up; attack ideologically; niche prior art | [43][55][105] | ongoing | ATTACK, blocker dossiers, frontier gap sweep, Harness² and Prime Agent code study (today) | — |
| H3 | No more new workflows (usage) | [53][63][87][127][132] | ✅ kept | D35; three workflows from before are still running | — |
| H4 | Commit and push everything; resume locally | [54][95] | ✅ | Rescue bundles and per-branch commits | Bundle the local-only branches again |

## I. Ideas adopted from the research (not the owner's words)

| # | Idea | Status | Evidence |
|---|---|---|---|
| I1 | JIT compilation of workflows from interpreter traces (THESIS-JIT) | ◐ | Records stream 22/24 (dev); kinetics data lost with a container |
| I2 | Code-owned harness A1-C: inventory, a requirement ledger from three readers, postconditions, a checker, a tool gate | ✅ held-out | P1 29/60 against 9/60 |
| I3 | Verifier lab: an RL2 ledger as a separate verifier; selection among forks (VL-1) | ❌ (inconclusive) | AUROC 0.837 on dev; VL-1 on look 2 +3 (+8/−5, p 0.58); Opus parity not met on cost |
| I4 | Δ\*: an expected-diff contract derived in code (ATTACK Move 1) | 🔧 | Built in the lab; not in A1-C's live path |
| I5 | Tri-state verdicts, mutation lab, κ budget, certification library | ✅ (engineering) | Merged |
| I6 | runtime2 with an effect registry (COMP) | ✅ (engineering) | $0 battery |
| I7 | Sequential plan with O'Brien–Fleming bounds over three looks | ✅ | Used for P1 |
| I8 | Engine identity, compare-and-swap, hash-chain anchors | ✅ | Conformance P4, P5, P11 |
| I9 | Model policy with no silent fallback; every escalation logged | ✅ | `policy/models.json` |
| I10 | Freeze guards with recorded allowances | ✅ | `manifest-allowances.mjs` (today) |
| I11 | Capability output labels (untrusted reads stay untrusted) | ✅ | Today, branch `data-handles` |
| I12 | Proposers may come from anywhere, but only the gate promotes (the answer to Harness² and Prime Agent) | 📐 | See `research/selfimprove-20261104/HARNESS2-PRIMEAGENT.md`; promotion experiment #105 |

## J. Owner questions answered in chat (no build needed)

| Question | Answer |
|---|---|
| Billing: subscription or card [7–14] | The subscription. Usage billing was off. |
| What template the workflows are built in [22] | Foundry's own typed IR, not n8n or LangGraph. |
| Rust [23] | No. |
| Haiku with world feedback [71] | A practice world the builder runs against before going live. |
| JIT compiler [44] | Interpret once with a strong model, compile the trace into a workflow, run it cheaply, de-optimise on a guard miss. |
| Is all the earlier work useless? [45] | No: the engine, the beds and the negatives carried over. |
| Cost per harness; expensive or cheap and durable? [34] | The one-time build is amortised. Example: SOP-Bench at $0.00055 per run against $0.0017 for the agent. |
| Haiku recreating the OpenScience harness [86] | Deconstruction mapped it (#66); most steps are expressible. |

## K. The answer to [today]'s question on Harness² and Prime Agent

The code study is in `research/selfimprove-20261104/HARNESS2-PRIMEAGENT.md`. In one line: adopt their loops as
**proposers** (propose → probe → compose; continual supplemental state with snapshots and rollback), and keep Foundry's gate
as the **only promoter**. Their own promotion steps are a model choosing among anonymised outputs (Harness²) and a
model-proposed edit checked only for structure (Prime Agent). VL-1 measured the first kind on look 2 and found it
inconclusive (+3, p 0.58). Prime Agent's own Factorio case shows the second kind learning to exploit.
