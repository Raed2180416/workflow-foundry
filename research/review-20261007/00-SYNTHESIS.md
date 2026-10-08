# Foundry review: where we stand and what to do next (synthesis, revision 2, 2026-10-08)

*Written for the owner. Revision 2, about 08:50 UTC on 2026-10-08, at HEAD `c7149b6`. It merges the seven review lanes
in this folder with the latest P1 and C0 numbers, and applies the findings of two critics
([`00-CRITIQUE-alignment.md`](00-CRITIQUE-alignment.md), [`00-CRITIQUE-rigor.md`](00-CRITIQUE-rigor.md)). The
**Review log** at the end lists every finding and how it was handled. Proposed wording changes to `docs/ROADMAP.md`
and `docs/THESIS.md` are in [`ROADMAP-AMENDMENTS.md`](ROADMAP-AMENDMENTS.md); nothing in `docs/` was edited.*

*Status: **development and diagnostic**. Nothing here is a sealed or claim-bearing result. P1, the agent-framework
corpus curation, the replication pilot and the Kev data build were still running, so numbers that can move carry a
time. This is a review artifact, not a status page: README stays the single entry point (ROADMAP §6.1), and §8
proposes moving the status table there.*

**Tags.** **[M]** measured: a command was run and is named. **[D]** documented: written in the named file, not re-run
here. **[I]** inferred: my reasoning or estimate. **[unk]** not known from anything available here.

---

## In plain words (read this first)

- **What works.** A workflow written by an expert lets the cheap model (Haiku 5.5) solve one hard synthetic task
  family 29 times out of 30, for under 2 cents a try. That is at least as reliable as one Sonnet call, at about
  1/19 of the cost per success, and 2.5× cheaper per success than asking Haiku directly. Foundry's own runtime
  is fast enough: it takes 1–3% of a real run's time.
- **What doesn't work yet.** When Haiku builds the workflow itself, the first tiny sample is worse (11/16 against
  Opus's 16/16), too small to call either way. Every workflow built so far marks itself "pass" as soon as any answer
  exists, even when the answer is wrong. Claude wrote every test so far; nothing "wild" has run. "~100% of
  workflows" is 35% today on paper, with none yet converted or run.
- **What changed since I last told you.** The table below lists 16 changes. The biggest: I no longer give a "fraction
  built"; "the workflow beats Sonnet" becomes "at least as good, much cheaper"; Kev no longer picks the tier; more
  C0 dev families and Kev laptop training wait; the replication benchmark gets the anti-recall guards I promised;
  the plan takes six weeks, not four.
- **What I need from you.** Write 20–30 tasks you actually want done, each with a way to check it (decision 9). Look
  at decisions 3, 4, 6 and 7 in §6. Every decision has a default that applies if you don't answer.

**The arms, defined once** (full glossary in Appendix A):

| Name | What it is |
|---|---|
| **F** | A Foundry workflow. **F-haiku** is built by Haiku 5.5, **F-opus** by Opus 5.5. **fhand** is the one an Opus agent hand-wrote for P1 after studying the family |
| **B0** | The model solving the task itself, with no workflow. **B0-call** is one direct call with no tools. **B0-agent** is Claude Code with tools (shell, files). In C0, "B0" means B0-agent |
| **B0+N** | B0-call plus notes carried from earlier tasks |
| **B1** | A plain script the builder model writes instead of a workflow. **B1-cc** is a real Claude Code workflow script (not built yet) |
| **B5** | Best-of-K: K independent tries, the same verifier picks one (not built yet) |
| **CPS** | Cost per verified success: all dollars spent divided by tasks actually solved |
| **K_c** | How many independent constructions each builder arm made (C0 dev: 1) |
| **d3, d4** | Difficulty levels of a task family |

---

## The 12 points that matter most

1. **The core bet has its first number. It is good, but narrow.** On held-out `records` tasks (d3–d4), the
   hand-written workflow on Haiku 5.5 passes **29/30 at $0.016 per trial**. One Sonnet 5.5 call passes 23/30 at
   $0.24, and one Haiku 5.5 call 22/29 at $0.031 [M P1, 08:44, partial]. The pre-registered rule ("success at least
   as good as one Sonnet call, cost per success lower") is met on the partial data. The workflow is cheaper per
   success than a plain Haiku call too: CPS ratio 0.39 [0.31, 0.46]. The setup favours us: one synthetic family, and
   an Opus agent wrote the workflow after studying it. This is a *ceiling*, not evidence about construction or about
   arbitrary tasks.
2. **When Haiku builds the workflow itself, the first sample is worse, but too small to call.** C0 dev had 2
   families, one construction per arm and 8 trials per cell, and its pre-registration says no claim can come from it.
   Haiku-built workflows passed 11/16, Opus-built 16/16 and Haiku-built scripts 16/16. F-haiku − F-opus = −0.31
   [−0.63, 0.00] [M C0]. The `codefix` failure also sank the Opus-built script (4/8), so it is a trap in the family,
   not yet evidence about Haiku [D DX]. On `codefix`, Claude Code with Haiku and no workflow passed 8/8 and was the
   cheapest per success [M C0].
3. **Foundry's own verdict said "pass" on every failed run of a constructed workflow** (5/5), and on the hand
   workflow's one failure [M]. All 7 workflows built so far accept as soon as "an answer exists" [D L5 §1.2]. Fixing
   this comes first: a construction lint that makes it an error, plus an oracle-discovery step during construction.
4. **The ground moves, and the cheap model is no longer "dumb".** On the same tasks a Haiku 4.5 call passes 0/30 and
   a Haiku 5.5 call 22/29 [M P1]. Part of Haiku 4.5's zero is one format rule that a code check would catch (19 of 30
   fail on it) [M]. Two consequences. The router must be tied to the executor model and cheap to re-fit. And Haiku
   5.5 is no longer the "akin to a 9b model" stand-in you described, so a Haiku 5.5 success proves less about weak
   models than you intend. I propose adding Haiku 4.5 as a weak-constructor stress arm (decision 10).
5. **"~100%" stays the target, defined so it can't be gamed: every real workflow is represented exactly, or rejected
   with a named reason.**
   - On the original 1,342-item corpus: 476 (35%) are declared today, **0 compiled and 0 executed**. The plan
     reaches 1,340 declared [M L2].
   - On the agent-framework slice (220 items from 22 framework sources, 08:45): 20% are native and 36% are covered
     with the 19 planned constructs. 61% need an agent tool loop, which arrives late in the plan [M AG].
   - Whether Haiku benefits from a new construct decides what goes into its construction kit, not whether the IR gets
     the construct (decision 6).
6. **Evaluation validity is the weakest link.** Claude wrote every bed, skill and builder prompt; the sealed families
   have never been used; nothing external has run. Next comes a "wild" ladder: the sealed families, then replication
   of real hand-built workflows (R-bench) and external benchmarks, then tasks you write. R-bench gets the guards
   against recall I promised: memorisation probes, perturbed twins, recency, and a firewall between test items and
   the template library.
7. **Third-party text must not reach an unisolated executor.** Four holes are open: control-flow taint,
   construction-time injection, executor network and login exposure, and model responses missing from the hash
   chain [M/D L7]. Each fix now gates the first run that needs it (§7). Closing the executor hole probably needs an
   API key, which collides with your "dont ask me to authenticate anythign". So the default is that no executor ever
   reads outside text, and R-bench uses a builder that runs no executor (decision 4).
8. **Swarms, subagents and a shared board are in scope, as bounded patterns over the IR, not as subsystems.** Each
   must beat a simple baseline first: best-of-K with the same verifier (B5), plain edges between nodes, or Claude Code
   alone [L3, L7]. The `wide` swarm operator runs in week 6; the board waits for a bed that needs it.
9. **The slider answers "how much is a correct result worth to you?"** Whether a task needs a workflow depends on the
   model, how often the task recurs, what success is worth, and whether a cheap check exists. Hard requirements
   (waits, triggers, approvals, risky effects) override the slider. **This changes what I told you on 10-07:** Kev
   now extracts task properties and does not pick the tier. First measure whether there is anything to route for
   (RX1, cross-fitted, about $85). If there isn't, don't build the router [L5].
10. **Haiku as constructor needs structure, not training.** That means construction as a checked Foundry workflow,
    oracle discovery, templates with typed slots, and a strict lint. The "edit" half of "construct and edit" has
    never been tested; experiment EX1 tests it. For now Opus builds the most complex tier (nested, multi-stage, with
    waits or human steps).
11. **Efficiency: fix the algorithm, keep Node.** Model calls are 76–81% of wall time and Foundry 1–3% (2 real runs)
    [M L4]. Fix the store (it rewrites the whole run on every event), adopt two CLI flags (−17 to −31% cost per call,
    n = 4–7) and the scheduler. **No Rust port** (about 19 person-weeks for at most 3%), except a reviewed 115-line
    Rust sandbox launcher.
12. **The plan: six weeks in a strict order.** First the engine fixes, then an engine freeze. Then structured
    construction, then R-bench pilots, then the sealed C0 round on the frozen engine, then `call`, `wide` and the
    first owner tasks. Further C0 dev families and Kev wave-1 training pause (decisions 7 and 8). The first
    end-to-end milestone targets the week of 11-18: one task you wrote goes through routing, Haiku construction, the
    run, the run view and an honest verdict. Expected experiment spend is about $560–825 at list price. The binding
    limit is your weekly allowance, not money.

---

## What changed since I last told you

Every row is something you read in this session that this document changes. "Now" uses numbers re-run at 08:44.

| # | What I told you (when) | What it is now | Why |
|---|---|---|---|
| 1 | "About a quarter to a third of the full vision is built" (10-08 08:06) | No fraction. §2 counts layers instead: built, measured on held-out tasks (2 of 14), measured on sealed or wild tasks (0 of 14) | The fraction had no rubric. Counting honest verdicts, wild-task evidence and composition as *not built* gives a lower picture |
| 2 | "Evaluation: Strong: 9 task families, audits, pre-registration, freezes" (08:06) | The *process* is strong. The *validity* is the weakest link | Claude wrote every bed; the sealed families are unused; nothing external has run |
| 3 | "the cheap model inside a workflow beats the strong model on its own … That's the core thesis showing up" (08:06) | At least as good as one Sonnet call, not provably better at this size: +0.20 [0.03, 0.36], but the pre-registered McNemar test gives p = 1.0, and the study is powered only for gaps above ~35 points. Cost per success is about 1/19 | "Beats" overstated it. The pre-registered rule is "reaches or beats", directional |
| 4 | "With tools, Haiku did worse … (14/20 vs 17/21) and cost about twice as much" (08:08) | Haiku agent with tools 23/29 vs Haiku call 22/29: tools neither helped nor hurt on `records`, and cost 3.4× ($0.105 vs $0.031 per trial). In C0 `codefix`, Claude Code with Haiku was the cheapest per success | More trials. Tools help on some families and not others, which is what a router must learn |
| 5 | "This is a natural Kev decision. Kev outputs a tier … The slider sets the probability threshold … labels can come straight from C0 results" (10-07 22:17) | Kev extracts task properties and does not pick the tier. A small head per executor model predicts success and cost. The slider is the dollar value of a success. Labels need paired runs | The right tier depends on the model, the price and how often the task recurs, not on the text alone (L5 §2.2) |
| 6 | Next step: "Run C0 on incident, kinetics and synth … the first cross-family construction number" (08:06) | Close C0 dev at `records` and `codefix`; the cross-family number comes from the sealed round (decision 8) | The `incident` audit isn't finished. `src` is frozen for C0, and the engine bump would change it. The weekly limit is at warning |
| 7 | Next step: "Kev wave-1 training on the laptop" (08:06) | Paused until a $5–10 probe compares Kev with Haiku 5.5 (decision 7) | Haiku 5.5 takes about 1–1.5 s and under $0.001 per typed call, which removed Kev's cost edge |
| 8 | "approved the hosted spend of up to $450 after a pilot" for Kev (10-07 22:35) | Held, not spent, until that probe reports (decision 7) | Same reason |
| 9 | Wild tier: "τ²-bench, AppWorld, Spider 2.0 / BIRD …, a SWE-bench Verified slice, and GAIA"; `ownerci`; "20–30 things you actually want done" (08:10) | The same list, plus an acquisition check of which ones run here (§3.7). `ownerci` is in rung 2. I ask you for 20–30 tasks, as told | Kept as told, with a check of which ones can actually run here. GAIA likely needs gated access and the live web [I] |
| 10 | R-bench: three task types (translate, rebuild from intent, improve), a direct-agent baseline, a 30-item shortlist plus 5 harnesses attacked by a stronger agent, and guards against "models simply recalling public workflows … renamed and perturbed variants, and items published after the models' cutoff" (08:13) | All restored in §3.7. Status: the 30-item shortlist exists (`research/replicate-20261008/SELECTION.md`, 312 h of harness work estimated); one pilot's fixtures are copied; 0 harnesses attacked; no oracle yet [M]. The memorisation guards are new in this document; SELECTION.md does not have them yet | Kept as promised; status stated plainly |
| 11 | "about 120–180 engineer-days … I'll check capability after stages 2 and 5" (10-07 22:52) | 125–190 engineer-days (lane 2's estimate, ±50%). The checks after IR stages 2 and 5 stay. They decide Haiku's kit and the build order, not whether the IR gets constructs (decision 6) | One estimate. Representation should not hinge on a construction result |
| 12 | Subagents "only through a bounded delegate node" (10-07 22:17) | That node is now called `executor`. The `delegate` on the stop list is something else: a Foundry-owned agent loop | Name change only |
| 13 | Agent-framework corpus: "about 120 items", then "about 165 … from 21 frameworks … A second, stronger agent independently re-checks every item" (10-07 22:52–22:57) | 220 items from 22 framework sources (08:45; 225 at 08:31, so the count moves). **No independent re-check is recorded on any item**: all 220 list `extractor: claude-sonnet` and no reviewer [M]. A 30-item re-check by a different model class is now planned (week 1) | The promise was not kept as stated |
| 14 | A swarm is "map over agents, a shared board, an aggregator, a verifier" (10-07 22:17) | The `wide` operator has no board. The board is a separate experiment | A board must earn its place against plain edges (L7) |
| 15 | Opus build "paid back after roughly 5–10 tasks" (08:06); "within 4–10 runs" (08:10) | Per family, against the same model solving directly with Claude Code: Opus-built 3.8 (`records`) and 9.6 (`codefix`) successes; Haiku-built 2.9 (`records`) and never (`codefix`) [M C0] | Per family, because the two families' direct-solve costs differ about 6×; a pooled figure misleads |
| 16 | Earlier: interop through export adapters | Harness independence means a written semantics plus a conformance suite. The adapters were deleted under D6. Today the IR runs only on Foundry's runtime | Kept from revision 1 |

---

## 1. The ambition, and what Foundry is and is not

**The ambition, in your words.**
- "a mini harness … something that can allow us to build focussed systems to execute tasks", able to "represent any
  and all workflows independent of a harness", and to build "the best possibel workflow for any tas obviously, thats
  the ultimate goal".
- A "dumb" model like Haiku constructs, edits and runs these workflows from templates. Kev makes the quick semantic
  calls, including whether a task needs a workflow, "from extremely complex … down to … tasks which dont need
  workflows", with a sensitivity slider.
- Workflows nest three deep, iterate, run in parallel or as swarms, spawn bounded subagents inside nodes, and share
  a board with shared state and private notes.
- It must be efficient and fully auditable, and you can watch a run as a few nodes with breathing dots and click a
  node to see its conversation.
- Later, in AMP: workflows working together in "alll possibly combinations".

Your sentence "it becomes essentially …" was cut off. I will not fill it in for you: decision 1 leaves it open, and
until you finish it this document quotes your own words above. (My private guess, marked as a guess: "a compiler and
runtime for task-specific agent systems that cheap models can drive.")

**What narrows, and what doesn't.** Your goal stays the best possible workflow for any task. For many tasks the best
workflow is none, just one call, and the router's job is to say so. What narrows is the claim we can defend today:
*checked* workflows pay off on tasks that recur or need structure. "Any task" is a goal we measure toward on the wild
tier, not a claim.

| Foundry **is** | Foundry **is not** |
|---|---|
| A typed, bounded workflow language (the IR). The target is a written semantics plus a conformance suite (neither exists yet), so any harness could run it. It is designed to be harness-independent; so far it runs only on Foundry's runtime [D L2 §2.7] | A general agent loop. Open-ended tool loops go to vendor executors (Claude Code, Codex) inside a bounded `executor` node [D T §4; L7 §3.3] |
| A runtime with durable records, replay per node, sandboxed code, budgets and verdicts [D R] | A memory store. AMP owns memory, and Foundry keeps no cross-run "lessons" store [L7 §2.9] |
| A constructor: cheap models fill templates under checks, and frontier models write the templates and build the hardest tier [I L5 §3] | A visual builder. The UI is a read-only run viewer [L6] |
| A selection layer: direct call, agent, reuse, template, construct, or construct+ (multi-stage), with a slider [L5 §2] | A model gateway or provider router. Model ids still come only from `policy/models.json`. (An internal egress proxy for executor model calls is a security boundary, not a gateway product.) [D R §3] |
| A source of evidence: independence labels, locked oracles, hash-chained records [D T §6] | A clone of LangGraph, n8n or Temporal. It **targets** their control semantics (today 35% declared, 0 compiled) and ships none of their product surface: no connectors, hosting or editor [I L2 §9] |

**Infinite processes.** Every run is bounded. Anything long-lived becomes a *trigger* that you activate and that starts
bounded runs. That is the "bounded semantics" you agreed to: represent a workflow exactly, or reject it with a named
reason [I L2 §5]. Two refusals are *design choices*, not unboundedness: free group chat and handoffs that pass the
full history. With a turn cap both are representable, and they are labelled "refused by design choice, representable
if you want them" (§3.1).

---

## 2. Where we stand against the end-to-end vision

| Layer | Status | Evidence | Caveat |
|---|---|---|---|
| **IR: represent any workflow** | **Partial.** 9 node kinds (`task`, `assert`, `human`, `map`, `loop`, `wait`, `agent`, `code`, `verify`). No `call`, triggers, error branches, signals, sessions or board | 476/1,342 corpus items (35%) declared native; **0 compiled, 0 executed** [M L2 §0, §7] | Declared coverage counts converter tokens; it compiles nothing |
| **Agent-framework slice** | Being curated | 220 items from 22 framework sources: 45 native (20%); 80 (36%) with the 19 planned constructs; 134 (61%) need an agent tool loop [M AG, 08:45] | Sonnet-extracted; no independent re-check recorded; all descriptions model-written |
| **Runtime** | Built. Fast enough today; breaks at fan-out | Runtime 1–3% of real-run wall time (2 runs); a 1,000-item map adds 73–135 s of pure overhead [M L4 §0] | Shared 4-vCPU VM |
| **Cheap execution (P1)** | **First directional number** | fhand-haiku 29/30 at $0.016. Sonnet call 23/30 at $0.24. Haiku 5.5 call 22/29 (thinking off) and 21/29 (thinking on; 6 of 8 failures are timeouts). Haiku agent with tools 23/29 at $0.105. fhand-sonnet 29/29 at $0.21. Haiku 4.5 call 0/30. CPS ratio fhand-haiku / Sonnet call 0.052 [0.043, 0.064] [M P1, 08:44, 242 of 288 trials, $21.08] | Partial (10 of 12 tasks per arm). One synthetic family, workflow hand-written by Opus. Powered only for success gaps above ~35 points [D PREREG §4] |
| **Construction by Haiku (C0 dev)** | **Partial; too small to call** | Probes: all 8 constructions passed. Test: F-opus 16/16, F-haiku 11/16, B1-haiku 16/16, B1-opus 12/16, B0-opus 16/16, B0-haiku 12/16 [M C0] | 2 families, K_c = 1, 8 trials per cell; "directional only" by pre-registration. Test seeds now inspected (DX), so they are burned |
| **Honest run verdicts** | **Broken** | Run verdict "pass" on all 5 failed F-haiku trials and on fhand-haiku's one failure; acceptance is "an answer exists" in 7/7 constructed artifacts [M; D L5] | Independent oracles caught it; the runtime didn't |
| **Need router and slider** | Design only | L5 §2 | Labels need paired runs |
| **Kev (typed judgments)** | Engine, laptop bridge, contracts library (30 tests) built; data groups being built; **nothing trained** | Stock Kev-0.8B at or below the rule baseline on 4 of 5 ports; CPU latency 2.5–13.7 s [M L1 gap 9]. Haiku 5.5 typed call ≈ 1–1.5 s and $0.0001–0.0005 [M L4 §8; D README] | Haiku 5.5 removed Kev's cost edge. GPU latency was measured only on the laptop |
| **Laptop bridge** | Built, attacked, fixed | Commit `d5d0c1f` [D L1 #48] | First real round trip not recorded |
| **Reuse library** | Not started | — | Phase 5. Its metrics (reuse, deopt and wrong-reuse rates) are not built |
| **Composition** (nesting by reference, parallel workflows, AMP) | Not started. Static nesting only (depth ≤ 6) | `src/validate.mjs:165` [D L2 §1] | — |
| **Subagents (`executor`)** | An adapter used by experiments; not an IR node | `src/executors/claude-code.mjs` [D L7 §1] | Network not isolated; CLI login readable in the sandbox |
| **Board and private notes** | Not built | `grep board src/` finds nothing [M L3] | — |
| **Audit** | Hash chain, model journal and receipts exist; **gaps** | Responses, decisions and transcripts are not bound into the chain; no external anchor [D L7 §4.1] | — |
| **UI** | **Prototype** run viewer (`tools/run-view/`) | 19 unit tests and 74 browser checks pass. It answers 6 of 7 diagnosis questions in ≤ 2 clicks, against 3 of 7 for the existing UI [I L6 §7, one run, scored by its author] | **You have not seen it yet.** The game-QA screenshots are a scripted fixture |
| **Security** | Labels, quarantine and sandbox exist; **gaps** | Probe B: an effect gated by `when` on untrusted data passes validation [M L7 A.3] | §7 |
| **Evaluation validity** | **Weakest link** | Every bed is synthetic and Claude-written; sealed families never used; no external benchmark [D L1 gap 6] | R-bench: shortlist only |
| **Efficiency** | Measured; fixes identified, **none applied** | L4 §6 | P1 is frozen, so engine changes wait for it |

**Counts instead of a fraction** (14 layers of the vision: IR, runtime, cheap execution, construction, honest
verdicts, router, Kev, composition, executor node, board, audit, UI, security, reuse):
- **Built and tested, with known gaps:** 6 (runtime, cheap execution of a given workflow, Kev engine and bridge,
  audit, UI prototype, security basics).
- **Partly built:** 3 (IR at 35% declared, construction by a free builder only, the executor adapter).
- **Not built:** 5 (honest verdicts, router, composition by reference, board, reuse).
- **Measured on held-out tasks of development families:** 2 (cheap execution in P1; construction in C0 dev).
- **Measured on sealed or wild tasks:** 0.

**"The core"**, the thing your "once we hve the core down, surely we can iterativelu test" refers to, is defined here
as five things:
- honest verdicts: the acceptance lint plus oracle discovery;
- structured construction: builder v0, measured by CX3;
- `call`: IR stage S1;
- the declared/compiled/executed measurement pipeline: IR stage S0;
- a sealed C0 number.

The plan in §5 reaches all five by about 11-24 [I]. The first **end-to-end milestone** is one task you wrote going
through the fixed-policy router, Haiku structured construction, the run, the run view and an honest verdict, with a
target of the week of 11-18. "~100% compiled" (IR stage S7) has **no date**: lane 2 estimates 125–190 engineer-days
(±50%) for one engineer, and how much agents shorten that is unknown [I].

**Spend so far [I].** About $88 at list price for experiment calls. That is the README ledger's $4.86, about $24 of
records-v3 dev pilots, P1 $21.1, C0 dev $35.3 and the Kev probe $2.5 (from L4's journal table and the results files).
Orchestration is the main driver of usage. The session transcript records **25.8 million subagent tokens** across 28
completed workflows and agents [M: distinct `subagent_tokens` values in the session journal]. That excludes the main
session and the workflows still running, and it has no dollar figure because the model mix per token isn't recorded.
These are notional list-price dollars: usage billing is off, so the binding limit is your weekly allowance, not your
card.

**What the full re-read of our chat found and this document had not surfaced** [D L1]:
- PR #1 has been open since 10-06, and `main` is still `6e1c06c`.
- No phase has a `REPORT.md` yet.
- The B2 baseline (memory and skills) is not built.
- Negative results not yet in `docs/RESEARCH.md`: records v2 being scriptable, the C0 preflight NO-GO, and the
  overnight agent losses.
- README still says "Haiku 4.5 is the cheap executor".
- README should link this review. ROADMAP §6.1 allows no parallel status document, so §2's table belongs in README
  (§8).

---

## 3. Answers to every question

Each answer gives the recommendation, the evidence, and the experiment that would prove it wrong. Kill rules use
non-inferiority margins: under the powered size, the outcome is "directional, no decision", and you decide (§5, rule
R4).

### 3.1 "Represent any and all workflows" and "why can twe get this to a 100 percent ? what are we missing ?"

**Recommendation.** Target about 100%, defined so it can't be gamed: **every real workflow is either represented
exactly, or rejected with a named reason.** Only exact representation counts. Report three numbers every time:
- **declared**: the constructs it uses exist in the IR;
- **compiled**: it lowers to valid IR under the production label policy;
- **executed**: it reproduces the original's behaviour on fixtures. This is measured only on items that have an
  oracle (96 corpus items with offline checks today, plus frozen R-bench fixtures), and it is reported as executed ÷
  oracle-eligible, never as a share of 1,342.

The headline is compiled and executed coverage on a **fresh held-out sample** of about 300 items, collected after the
IR is frozen (decision 2). Collection means re-running the pinned acquisition scripts for items published after the
freeze date: about 1–2 agent-days and no model spend [I], after IR stage S2.

**What "100%" means on the original corpus** [M L2 §7]:
- The declared ceiling is **1,340 of 1,342** after 19 constructs. The 2 items left over are Node-RED dashboard UI
  state, not workflows.
- Today 476 are declared, and 0 are compiled or executed.
- Nine constructs are each individually needed to pass 94% declared: schedule, webhook and event triggers; error
  branches; completion hooks; adaptive retry; `call`; cross-run state; and agent tool loops.

**What is missing.** The 19 constructs, in seven IR stages [L2 §3, §7]:

| IR stage | Adds | Declared after it |
|---|---|---|
| S1 | `call` by hash, local flows, `self` | 43.6% |
| S2 | error routes, `finally`, adaptive retry | 53.4% |
| S3 | triggers, admission policy, a resume contract | 75.6% |
| S4 | signals, durable waits, queries and updates | 80.7% |
| S5 | state capability, chat sessions, agent tool loops | 92.4% |
| S6 | bounded `machine` for arbitrary cycles, streams | 97.2% |
| S7 | flow parameters, `expand`, `detach`/`await`, sagas | 99.85% |

Before them comes S0: the measurement pipeline, a pure expression language, an output contract, and the semantics
spec skeleton with its conformance suite. The store rewrite and the sink-field label policy move into the engine bump
(§5), so S0 is about 18–27 engineer-days, not 30–45. The total is about 125–190 engineer-days [I L2 §0, ±50%].

**The agent-framework slice** ("maybe we should curate and add it ?"). It now holds 220 items from 22 framework
sources, among them LangGraph, CrewAI, AutoGen/AG2, OpenAI Agents SDK and Swarm, Google ADK, Claude Code workflows,
smolagents, Mastra, Strands and DSPy [M AG, 08:45].
- 45 are native (20%), and the 19 planned constructs bring that to **80 (36%)**.
- **134 (61%) need the agent tool loop**, which arrives in IR stage S5, after the S2 check. So the slice's *compiled*
  coverage stays around 20–25% for the whole six-week plan [I]. That is the honest picture.
- The rest need agentic constructs. Item counts and handling [M AG; I mapping]:

| Construct | Items | How to handle it |
|---|---|---|
| model-generated code execution | 47 | sandboxed `code`, no network, output tainted |
| supervisor delegation | 32 | `executor` or `call` |
| LLM router | 28 | `role: route` |
| handoff | 26 | routing. Handoffs that pass the full history: refused by design choice, representable with a turn cap |
| agent-as-tool | 26 | `executor` |
| interrupt and resume | 22 | `human` or a signal |
| shared scratchpad | 18 | the run board |
| multimodal input and output | 17 | image inputs (not built) |
| partial-output stream | 15 | streams |
| group chat | 10 | refused by design choice (failure data), representable with a turn cap if you want it |
| guardrail tripwire | 9 | verify gating |
| dynamic agent spawn | 7 | `expand` |
| checkpoint rewind | 5 | a `fork` verb |
| context compaction | 4 | a context policy |

- Greedy order with group chat excluded: 74% after 7 constructs, 78% after 8, 95% after 15. The ceiling is about
  95.5%, lower still once full-history handoffs are refused [M AG]. (The first draft's "95% after 12" counted the
  group-chat construct it said to refuse.)

**Correction kept from revision 1.** "1,340/1,342" holds for the 27-platform corpus only; covering agent frameworks
makes the construct list grow. Harness independence means a written semantics plus a conformance suite, not export
adapters, which were deleted under D6. That contradicts an earlier promise of interop adapters [D L1 #57]. A cheap
second check of harness independence is deferred (§5 defer table): a minimal second interpreter for the S0
conformance subset, or a lowering to a Claude Code workflow script, which would double as the B1-cc baseline.

**Blind spots next to the number** [D L2 §8]:
- connectors: 1,067 items call external services, so "represented" does not mean "runs against the real service";
- expression semantics;
- sagas;
- shared rate limits.

**Falsifiers.**
- **Lowering audit.** An independent agent hand-lowers 30 random items. A mismatch above 10% invalidates the
  compiled number.
- **Agentic coverage, made falsifiable.**
  - Freeze the construct-to-mechanism map and the refusal list by hash before the audit.
  - The falsifier counts items whose mechanism is not *implemented and compiled* by a named date (end of IR stage S5),
    judged by an agent that did not write the map.
  - If at least 20% are left, "any and all" is not yet defined.
- **Extraction check.** A different model class (Opus) re-checks 30 agentic items against source before the 36%
  figure is used in any decision. Corpus extraction read untrusted repositories.
- **Capability check after IR stage S2.** Does the S2 IR help a Haiku builder, against the S1 IR, on items that need
  the new constructs? The result decides what goes into Haiku's construction kit and in which order S3–S7 are built.
  **It does not decide whether the IR gets them.** Representation is judged on its own measures: compiled and
  executed coverage, and the lowering audit. Decision 6 asks whether to keep building toward ~100% even if Haiku
  doesn't benefit (default yes).

### 3.2 A workflow inside a workflow inside a workflow; recursion; iteration; composition edge cases

**Recommendation.** Yes, under the bounded semantics you agreed to [I, from L2 §4–5, L3 §3.6, L7 §3.4]:
- `call` depth defaults to 3, which covers your "three deep", with a hard ceiling of 8. Static nesting inside one
  document stays at most 6.
- Recursion only through `self` or local flows, with `maxDepth`. Recursion by hash is impossible: a document cannot
  contain its own hash.
- Every child gets a strictly smaller budget than its parent has left, so recursion ends even if the depth check
  fails.
- `loop` is capped at 1,000 iterations, with convergence criteria and "keep the best iteration" when the cap hits.
  Arbitrary cycles go in a bounded `machine` (at most 1,000 transitions): 27 of the 46 corpus cycles have several
  entry points that a single `loop` cannot express [M L2].
- Infinite processes become triggered runs (§1).

The full rule table and the **composition matrix**, one row per way workflows combine ("all combinations"), are in
Appendix C.

**Edge cases now with a rule and a test** (Appendix C has the details):
- **Partial failure at fan-in.** `onItemError: fail | collect | quorum(k)`. The reducer receives typed coverage (done,
  failed, cancelled). The verdict cannot be `pass` with collected errors unless acceptance says so. Test: 3 of 16
  workers fail.
- **Budget exhaustion mid-swarm.** Stop launching items. In-flight items keep only their reservation; unstarted items
  become `skipped: budget`. The result returns partial, with the verdict `inconclusive` (budget), never `pass`.
  Unused reservations go back to the parent. A static check `BUDGET_TOO_SMALL` catches depth-3 carving at fan-out 16
  that leaves a leaf less than one call's budget. Test: a 16-item map that runs out at item 9.
- **The weekly usage limit hit mid-run.** Pause, don't fail. Model ids and the CLI version are pinned per run. A
  resume on a different version is refused unless replay matches (ROADMAP D2).
- **Human steps deep in a tree.** The question carries its path (root → child → node), the workflow hash and the
  question hash. An answer to a stale question is rejected. One approval never covers sibling map items, unless it was
  declared as a bounded batch approval. You answer through the control channels in §3.17.
- **`call` before compensation exists.** `call` arrives in IR stage S1 and sagas in S7. Until then, a validator rule
  allows only idempotent or approval-gated effects in callees.
- **Versioning.** A revocation list overrides hash pins for security defects. Every document carries an IR version,
  with migration tests from S1 to S7. Constructed workflows record their template and kit versions. Kept workflows
  are re-qualified when the model id, CLI version, engine hash or template changes.
- **Siblings calling the same child with the same input.** The idempotency key is (callee hash, input hash, parent
  path), and one rate-limit gate is shared.
- Also specified [L2 §4]: cancellation propagates; a non-idempotent child in flight becomes `uncertain`; composite
  nodes never hold concurrency slots, so nested calls cannot deadlock; runs talk only through handles; the parent's
  chain commits to each child's head.

**Evidence.**
- Today's DAG plus bounded nesting cannot deadlock [I L1 W14].
- Nothing by reference exists yet [D L2 §1].
- The validator stays at ≤ 11 ms up to depth 5 [M L2 A.6]. The risk is the store, not the validator [M L4].

**Falsifiers.**
- The composition conformance suite: depth bombs, budget algebra, one writer per resource, cancellation storms, label
  laundering across `call`, and the edge-case tests above.
- **End to end:** `gridquest`, a runnable interactive bed, stands in **until the env port and image inputs exist**.
  The game-QA reference run is the end-to-end case after that; `gameqa` is unaudited and F workflows cannot run
  interactive beds today [D L1 #38].
- Recursive `call` against a flat `map` on long inputs (lane 3 idea #10). If recursion never wins, `call` stays for
  reuse and composition only.

### 3.3 "Where are we you think against the compelte e2e vision?"

See §2: counts instead of a fraction, "the core" defined, the first end-to-end milestone in the week of 11-18, and no
date for ~100% compiled. The central claim has one favourable number. Construction, honest verdicts and wild-task
evidence are the gap. That matches your own instinct ("once we hve the core down, surely we can iterativelu test and
do deep work on this"). The plan in §5 builds the core first, then iterates against harder and harder evaluation
rungs.

### 3.4 Kev measuring whether a task needs a workflow, from extremely complex down to none, with a slider

**Recommendation.** Build a two-stage router, and only if RX1 shows there is something to route for [L5 §2]:
1. **Hard requirements.** Code guards, plus Kev's task-property questions, force a workflow regardless of the slider
   when a task needs any of: a durable wait; a schedule or trigger; human approval; external effects with authority
   implications; or an audit trail *beyond the model-call journal*, such as approvals or effect records. Direct calls
   are journaled too, so "auditable" alone does not force a workflow. This guard can only *add* structure.
2. **Utility.** A small calibrated head, one per executor model, predicts success and cost for each mode and picks
   the best expected value.

**Your scale, mapped onto the modes.** The router shows your word and its reason:

| Your word | Mode | What runs |
|---|---|---|
| doesn't need a workflow | `direct` or `agent` | one call, or Claude Code alone |
| (already solved) | `reuse` | a kept workflow |
| simplest | `template` | one skeleton with filled slots, at most about 6 nodes |
| standard | `construct` | a bespoke workflow |
| extremely complex | `construct+` | multi-stage or nested, with waits or human steps; Opus-built for now (§3.5) |

**Kev extracts task properties and does not decide.** This changes what I told you on 10-07 (row 5 of the change
table). The head is cheap to re-fit when the executor model changes, which matters: Haiku 4.5 → 5.5 moved
single-call success on `records` from 0/30 to 22/29 [M P1].

**The slider asks "how much is a correct result worth to you?"** It runs from **cost first** (always the cheapest
mode; a workflow only when hard-required) through **Balanced** to **reliability first**. Underneath, each position is
a dollar value V of one verified success: about $0.10, $1 (Balanced) and $10, with the two ends at zero and infinity.
How often you expect to run the task (N) and how much waiting costs you also enter. The formula is in Appendix B.
Each position shows its *measured* operating point on held-out families (how often it builds a workflow, success,
dollars per task, wait), and says "uncalibrated" until it has one. Hard requirements override every position and say
why.

**Worked example, redone from P1 and C0 numbers** [I; it mixes P1 d3–d4 and C0 d3 tasks, so it is an illustration]:
- One Haiku 5.5 call: success 0.76, $0.031 per run. One Sonnet call: success 0.77, $0.24 per run. For a one-off
  task, **one Haiku call** is the best choice, not one Sonnet call. The first draft's Sonnet example used stale
  records-v2 numbers.
- An Opus-built workflow (C0 `records`): $2.47 to build, $0.046 per run, success 1.0 (K_c = 1). Against the Haiku
  call it pays off after about 274 runs at V = $0.10, after about 11 runs at V = $1, and from the second run at
  V = $10.
- A Haiku-built workflow (C0 `records`): $1.01 to build, $0.039 per run, success 0.75. At equal success with the
  Haiku call it never pays. Against a Sonnet call it repays its build in about 5 runs on cost alone.

**Break-even per family** (successes needed before the build is repaid, against the same model solving directly with
Claude Code) [M C0; K_c = 1]:

| Builder | `records` | `codefix` |
|---|---|---|
| F-opus | 3.8 | 9.6 |
| F-haiku | 2.9 | never |
| B1-opus (script) | 6.6 | never |
| B1-haiku (script) | 3.9 | never |

On `codefix`, Claude Code alone is so cheap ($0.035 per trial with Haiku) that nothing built repays itself.

**Other evidence.**
- Construction takes 6–17 minutes [M L5].
- In the corpus, 461 of the 829 written descriptions leak graph features into the text [M L5 §2.6]; all 220 agentic
  descriptions are model-written too. Router labels use only original descriptions.
- Router labels from RX1 and RX2 come from families whose C0 test seeds are now inspected. They are development data
  only.

**Falsifiers.**
- **RX1 headroom sweep** (pilot $85 on `records` and `codefix`; full $210), on the frozen engine E1 (§5). Taking the
  best mode per task from noisy estimates always looks better than any fixed mode (the winner's curse). So:
  - choose the mode on trial 1 and score it on trial 2, then the reverse (cross-fitting);
  - report the headroom under shuffled mode labels next to it;
  - apply the kill rule to the lower 95% bound.

  If that bound is under 3 points of success *and* under 20% of cost at every V and N: **don't build the router**.
  Ship the fixed policy plus the hard guards. The C0-dev artifacts all fail the new acceptance lint, so they are
  labelled "legacy", or rebuilt with K_c ≥ 2.
- RX2: if the router's captured headroom has a lower CI ≤ 0 on held-out families, it stays advisory.
- RX4 (sealed): if more than one slider position mispredicts its realised operating point, the positions become
  qualitative.
- **Deciding must not cost more than it saves.** A typed Haiku routing call is about 2% of a P1-sized task ($0.03),
  but as much as a trivial $0.0005 task. Mixed stream: always-direct vs always-workflow vs the router at 3 slider
  settings; one setting must dominate both.
- **Agentic coding** (you asked): `codefix` d4–d5 and `ownerci` supply labels. On `codefix` d3, Claude Code alone
  already passes 8/8, so `agent` is the default for open-ended coding unless the data say otherwise.

### 3.5 Haiku 5.5 as the workflow constructor: what else does it need?

**Recommendation.** Haiku is the **first rung of a construction cascade**. It builds the template and construct tiers
and escalates to Opus, as a logged event, if no probe passes within budget. Opus writes the library Haiku fills:
operators, worked examples, a repair cookbook [L5 §3.1]. **For now Opus builds the most complex tier**: nested,
multi-stage, with waits or human steps. Moving it to Haiku needs a decomposition experiment that is not in the
six-week plan (defer table, with a trigger).

**Is Haiku 5.5 still the "dumb model" test you meant?** Your bar was "haiku being much dumber is akin to a 9b model
… would prove … even a dumb model like haiku can construct". Haiku 5.5 passes 22/29 single calls where Haiku 4.5
passes 0/30 [M P1], and the 9B equivalence was never verified (L1 #18). A Haiku 5.5 success therefore proves less
about weak models. Decision 10 adds Haiku 4.5, which is in the policy file, as a weak-constructor stress arm in CX3
and C0 sealed (about +$10–20). Later, an 8–9B open model on your 4060 through the bridge.

We cannot fine-tune Haiku 5.5 (whether Anthropic offers it is unknown), so its "training" is structure and context,
in order of expected value [L5 §3; L3 §3.8]:
1. **Construction as a Foundry workflow** ("structured builder"), with code owning the loop. Its 12 typed steps:
   - intake;
   - **oracle discovery**: invariants with mutation controls, which fixes vacuous acceptance;
   - shape: "single call" is an allowed answer, which hands the task back to the router;
   - skeleton retrieval;
   - slots, one group per call, schema-constrained;
   - nodes;
   - assemble and lint;
   - a smoke run on probes;
   - diagnose;
   - a patch to one node, proven by replay;
   - escalate;
   - hand-off.

   It runs inside Foundry's runtime as narrow model calls, with no executor, so it is also the safe builder for
   outside text (§7). **It is not built.** "Structured builder v0" (oracle discovery, strict lint, skeleton slots) is
   a deliverable in weeks 1–2, built on the L5 design; its effort is [unk] until the first skeleton exists.
2. **Executable operator skeletons (templates)** with typed slots and offline self-tests. Add **"conventions once"**:
   read the per-task conventions once, check them, then apply them in code. Both `records` builders reinvented this
   [M L5 O2].
3. **Worked examples retrieved from other families.** Never from the task's own family, which would leak answers.
   Only reviewed skeletons enter the builder's context, each carrying a provenance label (§7, retrieval poisoning).
4. **Strict construction lint as feedback.** Each rule targets a failure already seen [M L5 §3.6; D DX]:
   - `ACCEPTANCE_EXISTENCE_ONLY` and `VERIFY_NOT_GATING`: acceptance in 7/7 artifacts is "an answer exists";
   - `ERROR_COLLECTION` becomes an error: the Haiku `records` workflow drops failed batches silently;
   - `REASONING_ON_EXTRACTION`;
   - `UNSCREENED_CLASS`: the Haiku builder put `codefix` on Sonnet and Opus without trying Haiku.
5. **A measured model card, a capability catalog, and the expected recurrence N in the brief.**
6. **Replay of unchanged nodes during smoke runs.** Testing is 45–76% of a Haiku construction's cost [M L5 O1].
7. **Kev as an advisory selector:** task properties, shape, and the probe-failure cause, learned from injected faults.
8. **The "edit" half.** Haiku repairs a broken workflow from a failing run record. Edits are offline, version-bound
   proposals that code applies only after replay, never inside a running run. (ROADMAP §3 rules out runtime
   self-modification by small models.) **Experiment EX1** tests editing:
   - *Inputs:* the 5 failed F-haiku runs with their two diagnosed defects, plus at least 20 faults injected into the
     C0-dev F-opus artifacts: a check that does not gate, a wrong check, a dropped batch, the wrong model class on a
     node, a misread convention.
   - *Task:* Haiku gets the failing run record and the lint output, and proposes a patch to one node.
   - *Scoring:* replay of the failing run, a regression slice, and the oracle on fresh dev seeds.
   - *Arms:* Haiku patch, Opus patch, Haiku rebuild from scratch, retry without change.
   - *Metrics:* fix rate, regressions, dollars per fix.
   - *Kill rule:* Haiku's fix rate non-inferior to Opus's at δ = 20 points, or edits escalate to Opus. Under-powered
     means "directional".
   - *Cost:* about $15–30 [I], in week 3.

**What the corpus is for** (you asked about training "given the corpus we are accumulating"). It has four roles:
1. R-bench items;
2. motif mining for the skeletons Opus writes;
3. retrieved worked examples, once items compile (0 compile today);
4. hard-requirement labels for the router (RX6, from the 449 original descriptions).

It is **not** training data, because it carries no success labels. The R-bench source firewall (§3.7) keeps role 1
apart from roles 2 and 3.

**Evidence.**
- Haiku built probe-passing workflows at 0.4× Opus's construction cost: $1.01 vs $2.47 on `records`, $0.90 vs $2.04
  on `codefix` [M C0].
- On test tasks: 11/16 vs 16/16, K_c = 1, CI touching zero [M C0].
- The two failure causes are what items 1 and 4 target [D DX]:
  - `records`: one Haiku node at low reasoning, with no check, decided a date order and got it wrong;
  - `codefix`: a check flagged a correct default-value fix as a signature change, and a repair node then undid the
    fix. The same check defect sank the Opus-built script (B1-opus `codefix` 4/8), so it is a family trap.
- Trained weak constructors work (W4S, FlowReasoner, MAS-GPT, WorkflowLlama), but every one was trained [D L5 §3.1,
  abstracts].

**Falsifiers.**
- **Mutation check** (free; replaces the first draft's CX2). The lint rules were written from these very failures, so
  "do violations predict failures?" on the same artifacts is circular, and the top rule has no variance (7/7 violate
  it). Instead, feed each artifact's acceptance and verify nodes the bed's bad controls and known-good dev answers,
  and count how many bad answers each accepts. CX2 proper runs only on artifacts built after the lint is frozen.
- **CX3** (about $25–35 for the 2 audited families): the structured builder against the free agent builder, both on
  Haiku, K_c = 3, fresh test seeds. If it is neither better on success nor cheaper, drop it.
- **CX4**: add one aid at a time; remove any aid that helps no family.
- **C0 sealed rule, defined on outcomes, not probes.** Probe passes were 8/8, so a probe-based rule could never fire.
  The rule uses verified *test* success and amortised CPS, with CIs, in a 2×2 design (Haiku and Opus × structured and
  free builder), so model and method are not confounded. Haiku stays the first-rung constructor if its success is
  non-inferior to Opus's at δ = 15 points and its amortised CPS ratio's upper bound is below 1. If the CI is too wide,
  the result is "directional", and the default is the Haiku-first cascade that CX5 measures. (The first draft's "below
  half of Opus" bar would have let 8/16 against 16/16 pass.)

### 3.6 "haiku 5.5 is building the environment right ? the nodes and shit … and why nto give it tools ?"

**Clarification.**
- **P1's single-call arm builds nothing.** Haiku gets the whole task in one prompt and writes the answer directly. It
  has no workflow and no tools.
- **In P1's workflow arm**, an Opus agent wrote the workflow beforehand, and Haiku only executes its narrow nodes.
- **Haiku building workflows is C0's F-haiku arm.** There Haiku *does* have tools: Claude Code in a sandbox, with
  shell, files, three probes, `/score` and a model gateway [D C0 PREREG-dev].

**Why not give the executing Haiku tools?** P1 tested exactly that. `b0agent-haiku` runs Claude Code with Bash, Read,
Write, Edit, Glob and Grep. At 08:44 it passed **23/29 at $0.105 per trial**, against **29/30 at $0.016** for the
workflow [M P1]. The cost gap is clear: CPS ratio 0.12 [0.09, 0.23]. The success gap is not: +0.17 [0.00, 0.39],
McNemar p = 0.5. Tools did not change success against the plain Haiku call (23/29 vs 22/29). In C0 `codefix`, the same
kind of arm passed 8/8 and was the cheapest per success. **Tools help on some families and not on others, which is
what the router has to learn.**

**Recommendation.** Tools come in three bounded forms:
1. `code` nodes for deterministic tools.
2. A capped `agent.tools` loop for short tool use: an allowlist, at most 16 turns, every turn journaled [L2 E3]. The
   IR needs it to *represent* the most common agentic construct (134 of 220 items [M AG]).
3. The **bounded `executor` node** for open-ended loops (debugging, multi-file edits, exploration), always followed
   by a `verify` node [L7 §3.2].

Lanes 2 and 7 disagree on point 2. The reconciliation [I]: the IR *represents* `agent.tools`, and its first
implementation runs inside the executor adapter. A Foundry-native loop is built only if a measured family needs replay
or repair turn by turn, and it **requires amending ROADMAP §3** ("a general agent loop") first.

**Falsifiers.**
- **Executor experiment** (lane 7 step 4): a workflow with an executor plus `verify`, against Claude Code alone, at
  equal spend. Claude Code alone is already 8/8 on `codefix` d3 with both Haiku and Opus, so first measure B0-agent
  on `codefix` d4–d5 dev seeds (d5 adds injection through code comments). Run where B0 passes under 70%, or on
  `ownerci`. No gain means executors are only a fallback.
- Lane 3 idea #6: does a spawn depth above 1 help? If it is not non-inferior plus 10 points, the default stays at 1.

### 3.7 "toy workflows right ? or cheating ? we need to say something arbitrary" and replicating niche workflows (R-bench)

**Honest answer.**

*Not cheating:*
- the experiment was pre-registered and frozen before any test task ran;
- the test seeds were never inspected;
- an independent host-side oracle scored every trial;
- negative results are kept;
- partial numbers I showed you (three times so far) change neither the stopping rule nor the verdict. The verdict
  uses only the final, pre-registered analysis.

*Not toy for a single call either.* `records` d3–d4 has 37–42 entities, five per-task conventions stated only in
prose, and planted namesakes. A 40-line heuristic passes 0/30 at d3, and a Haiku 4.5 call 0/30. The same-model
comparison matters more: the workflow beats a plain Haiku 5.5 call by +0.21 [0.07, 0.43] (McNemar p = 0.5), at 0.39×
its cost per success [M P1].

*But it is a favourable setup:*
- a single synthetic family, and Claude wrote the bed;
- an Opus agent wrote the workflow after studying the family on dev seeds;
- a Haiku 5.5 single call already gets 22/29.

So P1 is a *ceiling* result. **C0 dev hints at a drop when Haiku constructs** (16/16 to 11/16, K_c = 1, CI touching
zero), and the run verdict said "pass" anyway [M C0; D DX].

**Recommendation: a wild evaluation ladder, in five rungs** [I, from L1 gap 6 and W5, L2 §8, L5 CX6, and what I told
you at 08:10]:

| Rung | What | Why it is harder to fool | Status |
|---|---|---|---|
| 0 | development beds | — | now |
| 1 | **C0 sealed families**, by a separate author, never used | never-seen families | 3 one-shot families runnable; `sealed-3` is interactive and waits for the env port |
| 2a | **R-bench: replicate real workflows people hand-built** (below) | humans spent real effort on these, and we didn't write them | shortlist of 30; 0 harnesses done |
| 2b | **External benchmarks:** τ²-bench, AppWorld, Spider 2.0 / BIRD, a SWE-bench Verified slice, GAIA | not written by Claude | acquisition check in week 1: what installs locally, what needs credentials, containers or the live web. GAIA likely needs gated access and live web [I]; Tier B/C containers need Modal or Harbor credentials we don't have [D README] |
| 2c | **`ownerci`**: repairing real CI failures in this repo | real failures | bed being built and audited |
| 3 | **20–30 tasks you write**, sealed until the run | "say something arbitrary", literally; also things nobody has built a workflow for yet, which tests "does it need a workflow?" | decision 9 |
| 4 | your real recurring tasks, from ARC and AMP logs, redacted (later) | the real distribution | needs decision 11 |

**Sealing your tasks (rung 3).** An oracle Claude writes after reading the task is not sealed. So either:
- you send each task with its acceptance check or a few input/output examples; or
- you grade blind and paired against a rubric frozen before the run, recorded as human assistance.

Tasks are stored like `beds/sealed/`, with a hash commitment in the repo. If none arrive by 10-28, rung 3 is reported
as missing, not replaced.

**R-bench, the benchmark you proposed** ("cheaply recreate their workflow do their shit, and see if anything needs
improvement"). Each selected workflow yields three tasks, each scored separately (as told at 08:13):
- **translate:** from the original definition, produce an equivalent Foundry workflow. This is also the honest route
  to compiled coverage. Model-written descriptions may be used here only.
- **rebuild from intent:** from the author's *original* description and a few input/output examples. Model-written
  descriptions never enter this task: all 220 agentic descriptions and 461 of the corpus's written descriptions leak
  graph features.
- **improve:** the same job, cheaper, faster or more reliable. Five items carry a documented defect in the original
  (SELECTION §5).

Every task is judged by an executable oracle on hidden scenarios with two controls: the original (or a labelled
reference re-implementation) must pass, and item-specific broken versions must fail [D SELECTION §1].

**Guards against recall** (new; promised at 08:13; to be added to the R-bench pre-registration):
1. **Memorisation probe**, per item, before the build. Ask the builder model to reproduce the workflow from its title
   and platform alone, and score the overlap with the original graph. Items above a pre-registered threshold are
   "known"; known and unknown items are reported separately.
2. **Perturbed twins.** For each item, rename entities, change constants and flip one branch condition, then
   regenerate the oracle on the twin. A large gap between original and twin means recall.
3. **Recency.** Prefer items whose pinned source commit postdates the builder model's training cutoff, recorded from
   the model card or marked [unk].
4. **Source firewall.** Any repository or template family that supplies an R-bench item is excluded from skeleton
   mining, worked examples, and the agentic constructs designed for Haiku's kit. Near-duplicates are checked across
   all 27 platforms (graph hash plus description n-grams), because n8n templates are widely forked.

**Arms** (pilot, development only):
- the structured builder on Haiku and on Opus;
- B0-call: one direct call per scenario;
- B1: a plain script written by one direct call;
- the free builders (Claude Code) on Haiku and Opus, and B0-agent, **only after executor isolation passes its canary
  test** (§7).

That gives the 2×2 model × method design once isolation lands. Until then the method comparison waits, and
descriptions are redacted and secret-scanned. Item `n8n:18122` embeds Slack and Discord webhook URLs that look like
live credentials; they were not copied, and you may want to know they are public in that template [D SELECTION §7].

**Pilot deliverables, against what I told you.** I promised a 30-item shortlist, 5 harnesses attacked by a stronger
agent, and a measured setup cost per item.
- **Done:** the shortlist (`SELECTION.md`: 30 items, 20 redistributable, 312 h estimated, 58 h for the 5 pilots).
- **Started:** one pilot's fixtures (`experiments/replicate/items/`).
- **Not done:** the attacked harnesses and the measured cost [M, 08:45].

**Kill or stop rule for the pilot** (SELECTION's own health gate, replacing the first draft's "lowering fails on more
than 50%"):
- the original or the reference passes, and the broken controls fail, on at least 20 seeds;
- an item that fails is excluded;
- if more than 2 of the 5 pilots fail, stop and fix the shared mock kit.

**Contract changes R-bench needs** (decision 14): an oracle runtime of up to 60 s per scenario instead of 2 s, and a
runner shim in `experiments/replicate/` while `beds/` and `experiments/lib` are frozen. Originals that run as controls
run only in the no-network sandbox, inside the image-size cap, never on the host.

**Caveats.**
- Connectors are mocked, so this measures *logic* replication, not deployment. No real accounts are touched.
- Non-redistributable items (n8n terms) stay in `/opt/corpus/`; only our fixtures are committed.

**Falsifier.** If F's advantage over B0 and B1 disappears on rungs 2 or 3, the P1 result is an artefact of our own
beds [L1 W5]. The pilot (5 items, about $30–60 in model calls plus 58 h of harness work) is report-only. The
claim-bearing round uses a fresh sample frozen after the IR freeze.

### 3.8 "do oyou think we need to train a small llm to figure out what nodes, or templates to adapt or to build from?"

**Recommendation.** Only as a last resort, in this order [I L5 §3.8; L3 §3.7]:
1. Retrieval plus templates.
2. Construction as a workflow (CX3).
3. The context ladder (CX4).
4. **Kev as the selector.** "Which skeleton, which shape" is a choice among N options, which is exactly Kev's format.
   Kev can be fine-tuned on your laptop.
5. Only then a 7–8B open-weight generator that emits *a skeleton choice plus slots*, not whole IR.

**The corpus**: see §3.5, "What the corpus is for". It feeds skeletons and examples, but it is not training data.

**Evidence.**
- Trained small constructors work: W4S (7B, about one GPU-hour of RL), WorkflowLlama (8B, about 106K samples),
  MAS-GPT, FlowReasoner [D L5 §3.1, abstracts].
- We have 8 constructions with test outcomes [M C0]. That is nowhere near training data.
- Local generative models are parked on this CPU (268 s per call) [D README].

**Trigger to train.** Both must hold:
- after CX3 and CX4, Haiku's construction on sealed families is still not non-inferior to Opus at δ = 15 points
  (§3.5);
- at least a few thousand executed (brief → skeleton plus slots → verified) rows exist.

**Kill rule:** if CX3 and CX4 make Haiku non-inferior at δ = 10 points on a powered sample, don't train. If the
sample is under-powered, you decide.

### 3.9 Swarms: how they work, and are they in scope?

**How swarms work** [D L3 §0]. Every system surveyed uses one primitive: spawn a worker with a fresh, isolated context
and a task, then get a condensed result back. They arrange it in four topologies: orchestrator and workers (Kimi,
Anthropic's research system, Claude Code workflows), handoff (OpenAI Swarm), a shared board (MetaGPT, Claude Code agent
teams), and a learned topology. They differ in three things: who decomposes the work (a model, a script or a trained
policy); what workers share; and how the work stops. Kimi's orchestrator is *trained* (PARL), unlike a Claude Code
workflow script.

**Recommendation.** In scope, as **an operator family over the IR**:
- **`wide`:** a planner emits a bounded, typed list of subtasks; code checks it for overlap and gaps; a `map` of cheap
  typed workers runs it; a code reducer merges the results; an independent `verify` checks them.
- **Variants:** `panel` and `loop_until_dry`.
- **No board inside `wide`.** That differs from my 10-07 description ("map over agents, a shared board, an
  aggregator, a verifier"); the board is a separate experiment (§3.12).

Not as a subsystem: **no 100–300-agent defaults** (cap about 32 without evidence), no free group chat, no learned
orchestrator. **Every swarm must beat B5** (best-of-K with the same verifier, at equal tokens) [L3 §3].

**Evidence.**
- Swarms buy breadth and wall-clock time, not depth: Kimi +17.8 points on BrowseComp and Anthropic +90% internally,
  both vendor-reported.
- They lose on sequential work: −2 to −15 points on SWE-bench Verified, and −70% on sequential planning (Kim et al.).
- They use about 15× the tokens.
- Independent agents amplify errors 17.2×, centralised ones 4.4×.
- Parallel subagents exhausted our weekly limit once as far as the records show, 10-06 20:00 → 10-07 11:00 UTC
  [D README; T:3571 describes the same incident]. The meter has been at warning since 10-07 21:44 (T:3731).
- Our own ceiling: the `claude -p` route manages 2.3–3.4 calls per second on 4 vCPU, and the store adds 73–135 s at
  1,000 items [M L4].

**Falsifier.** Lane 3 idea #1, in week 6, on `records` only. No bed whose generator scales the item count exists,
and the stop list forbids new beds. `wide` on Haiku runs against a Sonnet call, a Sonnet agent, B5, and a real Claude
Code workflow script. 30 tasks × K = 3 × 5 arms is about 450 trials, about **$80–150** [I]; the first draft's $30–50
was too low. It fails if:
- it is not non-inferior at δ = 10 points (this n resolves only about 25-point gaps, so smaller gaps are
  "directional");
- its cost per verified success is not below 0.5× the baseline's;
- it loses to B5.

B5 is built here for the first time.

### 3.10 Claude Code dynamic workflows (and "ultracode") versus Foundry

**How they work** [D L3 §1.4]:
- Claude writes a deterministic JavaScript script using `agent()`, `pipeline()` and `parallel()`.
- Agents can be given schemas.
- Up to 16 agents run at once, 1,000 per run.
- The budget is a token pool for the turn.
- Resume **replays the longest unchanged prefix in start order**, so a failure mid-fan-out reruns siblings that had
  already finished.
- `workflow()` nests one level; subagents nest 3 levels.
- Ultracode writes a workflow for *every* substantive task.

**Same:** fan-out, structured outputs, journaled resume, caps, and the rule that a computed prompt is never consent.

**Different:** Foundry has typed control fixed before untrusted data is read; narrow typed nodes instead of
open-ended agents; replay per item; dollar budgets per node; independence labels; and a model class per node.

**Recommendation.** Treat Claude Code workflows as **executors inside Foundry and as the baseline to beat (B1-cc)**,
not as something to rebuild. C0's B1 is a sandboxed Node script, not a real Claude Code workflow [D L1 #32]. Before
B1-cc enters any pre-registration, a $1 smoke checks that a Claude Code workflow script can run headless in the
sandbox. If it can't, the arm is dropped and the reason recorded.

**Falsifiers.**
- Lane 3 idea #4 ($2, week 1): inject a failure at item k of a 16-item fan-out. Foundry should re-execute exactly 1
  item. Claude Code's *documented* resume would re-execute 16 − k + 1. The Claude Code side is labelled "documented
  behaviour" unless it is run too. If Foundry re-executes more than one, or its output changes, that is a replay bug.
- B1-cc as an arm in the C0 sealed round and in the `wide` experiment.

### 3.11 Subagents inside nodes: "am I overcomplicating?"

**Recommendation.**
- **For narrow nodes, yes, it would be overcomplicating.** `agent`, `code` and `verify` never spawn. The runtime
  spawns, through `map`, `call` or `expand`, so every spawn is journaled and budgeted.
- **For open-ended steps, no.** Use one node kind, `executor` (what I called the "delegate node" on 10-07)
  [L7 §3; L3 §3.4]. It has:
  - nested agents set to 0 by default;
  - a budget reserved from the parent;
  - a timeout and heartbeats;
  - a transcript whose hash goes into the chain;
  - `egress: none` by default, with model access through a host-side egress proxy (a security boundary, not a gateway
    product);
  - effects marked `uncertain` when egress is on;
  - a mandatory `verify` afterwards.
- **Limits:** at most 2 executors running at once and 16 per run.

**Evidence.** Today the executor sandbox has no network isolation, and the CLI login is readable inside it. A nested
`claude -p` call would run outside every ledger; only an after-the-fact transcript scan catches it [D L7 §3.4].

**Falsifier.** The executor experiment and lane 3 idea #6 (§3.6).

### 3.12 Shared message board, shared state, private notes

**Recommendation** [L7 §2; L3 §3.5]:
- **A run-scoped board of typed facts, not chat.**
  - Topics have a schema, a reducer (append, set union, last-writer-wins with compare-and-swap, claim) and declared
    writers. Nodes declare their reads.
  - Each read happens at one sequence number, recorded in the receipt, so replay is exact. "Shared understanding"
    means every node sees the same view at the same sequence number.
- **Private notes** are a per-node scratch space, never shared, journaled for audit. They leave only through a typed
  output field.
- **No Foundry store that persists across runs.**
  - Cross-run *knowledge* ("lessons") becomes a versioned workflow change proven by replay, or an AMP claim. **AMP owns
    memory.**
  - Cross-run *application state* (a cursor, a dedupe set, a chat session) is a typed state capability with
    compare-and-swap, behind the ContextPort, not a Foundry store.
  - This amends ROADMAP §2.2's `workflow` scope and the §3 wording (decision 5; ROADMAP-AMENDMENTS).

**Evidence.**
- Typed edges between nodes already give single-writer shared state, which is enough for most workflows
  [D L7 §2.1].
- A board pays off only when many writers feed one stream, branches read each other sideways, results accumulate
  across iterations, or a person writes in mid-run.
- Free chat between agents is a top-three failure category (MAST) [D L7 §0].
- The pre-registered B0+N arm is a cross-run notes store for a *single call*, not a board or node-private notes, and
  15 of its 19 failures are timeouts (17/36 at 08:44) [M P1]. It is **not evidence about boards**.

**Schedule.** The board experiment (lane 7 step 2: board vs no board vs B5 on `gridquest`, $20–40) needs board v1,
which is engine work, and its security preconditions (§7). It is **deferred past 11-24**, with a trigger. The cheap
private-notes test (lane 7 step 3: the scratch field on `records`, a few dollars) runs in week 6 if capacity allows.

**Falsifier.** If the board is not at least 15% better per dollar than the same workflow without it, park it and
keep edges.

### 3.13 Auditability

**Recommendation.**
1. **Close the hash-chain gaps first** (engine bump):
   - `requestHash` and `responseHash` on every model call;
   - decisions recorded as chain events;
   - executor transcript hashes;
   - a journal root at seal (a board root only once a board exists);
   - run heads anchored in the committed experiment manifests;
   - `foundry verify RUN` [L7 §4.4].
2. **Then a flight recorder.** It is a pure fold over records that already exist: timeline, node cards, costs
   including cache efficiency, anomalies, and a "why-index". The run viewer (§3.17) is its face.

**Evidence.**
- Today an edited `model_calls` row does not break verification, because responses are not bound.
- Decisions sit outside the chain.
- Nothing anchors the chain outside SQLite [D L7 §4.1].
- The run viewer answers 6 of 7 "what happened?" questions, self-scored on one run [I L6].

**Falsifiers.**
- Edit one journal byte: `verify` must fail.
- ROADMAP §2.10's exit criterion: you answer "why did this happen?" on **10** recorded failing runs, in under 2
  minutes each, with and without the viewer. A 3-run version is the pilot.

### 3.14 "is this implementation efficeint ? … rust …"

**Recommendation.** Fix the algorithm and the model route, and keep Node. Ranked by measured gain [M L4 §6]:
1. **Two CLI environment flags**, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and `FORCE_PROMPT_CACHING_5M=1`:
   −0.6 to −0.8 s per call, −17 to −31% cost per call, throughput at 6 concurrent calls from 1.89 to 3.01 per second
   (n = 4–7 per request shape). Adopt after P1. They change reported cost, so cost per success before and after the
   flags is **not comparable** (§5, rule R3). The lanes agree once their numbers are combined: the CLI writes its
   prompt cache at the one-hour price (2×), which is why lane 7 found caching mostly costs money. The 5-minute cache
   beats both that default and turning caching off [M L4 §2.4; M L7 §5.2].
2. **Per-node store rows** instead of rewriting the whole run blob on every event. A store-less in-memory prototype
   shows a 1,000-item map going from 89 s to a 1.65 s floor [I L4 §0.3, prototype]. The target for the real change is
   under 5 s. It also removes the event-loop stalls that would freeze a viewer in the same process.
3. **A work-conserving scheduler:** −6.5 to −8.8% wall time on the real DAG.
4. **A native sandbox launcher** (115 lines of Rust, a reviewed security component): a code node from 212 ms to
   41 ms.
5. **Shorter outputs on extraction nodes.** Two nodes are 52% of the Haiku 5.5 spend.

**Not measured yet, so "every single possible compeontn is maximally efficient" is honestly "no":**
- the construction loop (6–17 minutes; testing is 45–76% of its cost);
- orchestration (25.8M subagent tokens so far, §2);
- Kev serving on the GPU;
- the context compiler at large inputs;
- the viewer's server under several live runs.

**Rust: not now, except the reviewed 115-line sandbox launcher.**
- Porting the kernel is about 19 person-weeks (14–26) [I L4 §7.2].
- The gain on real runs is at most 1.5–3% of wall time.
- The design is still moving.

**Revisit only when all four hold** [L4 §7.5]:
- after the store fix, runtime overhead is still at least 10% of wall time or cost;
- the IR is frozen;
- a conformance corpus exists;
- there is a deployment reason, such as embedding in AMP's Rust daemon.

**Falsifier.** Lane 7 step 1: per-event cost stays flat (under 5 ms at 10,000 events), with replay conformance
unchanged.

### 3.15 "frontier research or any oss": the top ideas

Use them as **semantics and baselines, not dependencies**. Avoid Restate (BSL 1.1) and Inngest (SSPL) as dependencies
[M L3 §4]. Ranked by capability per unit of effort [L3 §5; L5 §4]:

| # | Idea (source) | Cost (list $) | Kill rule | When |
|---|---|---|---|---|
| 1 | `wide` operator plus a critical-path metric (Kimi, Anthropic) | 80–150 | loses to B5 or B0 (§3.9) | week 6 |
| 2 | Need gate with a cascade baseline (MaAS, DAAO, Adaptive-RAG, RouteLLM) | reuses runs | no headroom (RX1) | week 3 |
| 3 | Agent-framework corpus slice | ≈ 0–10 | ≥ 20% unimplemented by end of IR-S5 (§3.1) | running |
| 4 | Replay per item vs prefix replay (Claude Code) | ≈ 2 | Foundry re-executes more than one item | week 1 |
| 5 | Verify panels with independence labels (vote > debate) | ≈ 20 | no panel beats a single Sonnet check at equal $ | deferred |
| 6 | Executor spawn-depth governance | 60–100 | depth > 1 not non-inferior + 10 points | deferred |
| 7 | Weaver-style ensemble of weak verifiers, distilled into Kev | ≈ 10 + GPU | ensemble ≤ best single verifier + 2 points | deferred |
| 8 | Run board vs isolated explorers (MetaGPT, agent teams) | 20–40 | board ≤ isolated, per $ | deferred (§3.12) |
| 9 | Per-node prompt search, GEPA/MIPRO-style in JS (DSPy, MASS: prompts before topology) | 15–30 | < 5 points at node level | deferred |
| 10 | Recursive `call` for long inputs (RLM) | ≈ 20 | never beats a flat `map` | after IR-S1 |

Semantics to adopt:
- child workflows and continue-as-new (Temporal);
- a `fork` verb for rewinding a run (DBOS);
- "activate when all prerequisites are present" (MetaGPT);
- a small pure expression language, CEL-like.

**The 2026 signal:** small *trained* orchestrators (ToolOrchestra-8B, AgentFlow-7B, WideSeek-R1-4B) now beat large
general models. That strengthens the case for a trained Kev gate, and weakens any plan that relies on a *prompted*
small model orchestrating without checks [D L3 §4.9].

### 3.16 Later in AMP: "parallel workflows working together … alll possibly combinations"

**Recommendation.** Phases 6–7, after `call`, `detach`/`await` and the board exist. Appendix C's composition matrix
lists each combination with its status, IR stage, refusal reason if any, and conformance test. The rules
[L2 §4.10; L3 §3.6]:
- runs are addressed only by handle, never by an ambient run id;
- signals, queries and updates are journaled;
- a tree-scoped board;
- one writer per resource;
- a **central reducer plus a verifier** (independent topologies amplify errors 17.2×, centralised ones 4.4×);
- mandatory timeouts, plus a wait-for graph that reports suspected deadlock;
- composition *across* stores goes through MCP or A2A capabilities.

AMP integration stays an experiment (D4 deferred). AMP can back the context and state ports later. With "all
combinations", approvals multiply; see W15.

**Falsifier.** The composition conformance suite, plus the end-to-end case (`gridquest` until the env port exists;
§3.2).

### 3.17 Node visualisation: breathing dots, a live line, click to open the chat

**Built as a prototype**: `tools/run-view/`. Screenshots are `ui-*.png` in this folder.
- Each node has a breathing coloured dot, a one-line live note, and a click that opens its transcript: prompt, typed
  reply, checks, escalations, costs and receipts.
- It replays recorded runs, or follows a live run through a read-only server. Commit-to-browser lag is p50 12 ms, and
  a 1,000-item run folds in 45 ms [M L6].

**Three expectations to set:**
- The "chat" is a read-only transcript. A viewer that can act would hand authority to untrusted model text. A safe
  middle path is an "ask about this node" box that makes a separate model call over the journal, with no authority.
  It is a proposal that needs its own experiment (deferred).
- A "visual understanding" node needs image inputs, which don't exist yet (deferred, §5).
- **The game-QA screenshots `ui-6` and `ui-7` are a scripted 69-event fixture with text stand-ins for screenshots**
  [D L6 §0]. No game-QA workflow has run.

**Where you act** (the viewer never acts):
- `foundry answer RUN --node … --answer …` and `foundry approve RUN APPROVAL --approved|--rejected`
  (`bin/foundry.mjs:149–150`), and the same actions in the existing `web/` UI (`src/http.mjs:72–83`).
- Cancel exists only over HTTP today (`src/http.mjs:83`). The week-1 engine bump adds `foundry cancel RUN` and a
  **stop-all** with a process-group kill. On 10-07 your "stop everythign for now" was messy: the first kill matched
  itself, a scheduled check-in would have restarted work, and workflow inputs had to be rebuilt from transcripts
  [D L1].
- **Test:** cancel a three-deep tree while an executor runs, a human step is pending and a map is in flight. Expect no
  orphan processes, `finally` within its grace period, a list of effects whose outcome is unknown, and a message
  telling you what stopped.

**Next step:** look at `ui-6-gameqa-escalation.png` and `ui-7-gameqa-transcript.png` (fixtures) and tell us whether the
level of folding and the wording are right. **Kill rule:** the 10-run "why did this happen?" test of §3.13, with a
3-run pilot first, before the viewer moves into `web/`. It stays a read-only inspection face; ROADMAP §3's "no
tracing UIs" line needs the amendment in ROADMAP-AMENDMENTS. `tools/` is a new top-level directory, not yet in the
AGENTS.md layout.

### 3.18 "really deeply reason worst case sceanrios revaluate the entire concept"

See §4. The concept survives, with two corrections [I]:
- **The defensible claim narrows; your goal doesn't.** The goal stays the best possible workflow for any task,
  including "none". What we can defend today: "cheap models execute *checked* workflows that frontier models, or
  structured Haiku construction, produce, on tasks that recur or need structure." "Any task" is measured on the wild
  ladder, not claimed.
- **The verdict layer moves to the front.** A workflow that certifies "pass" on wrong answers is worse than none.

This review shares its authors' blind spots: every lane, this synthesis and both critics are Claude (W16).

---

## 4. Worst cases for the concept

| # | Worst case | Current evidence | What settles it |
|---|---|---|---|
| W1 | **A single strong call or a plain agent keeps winning** | *Against:* fhand-haiku 29/30 vs Sonnet call 23/30, at 0.052× the CPS; vs the Haiku 5.5 call at 0.39× [M P1]. *For:* the Haiku 5.5 call already gets 22/29 [M P1]; in C0, F-opus only ties B0-opus (16/16 each), and on `codefix` B0-haiku is cheapest per success (K_c = 1) [M C0] | C0 sealed on the **3 one-shot** families. **Kill rule:** if a single call is non-inferior to F-haiku with the CPS-ratio upper bound ≥ 0.85 on 2 of 3 sealed families, shrink the claim to "rescuing a weak model" [L1 W1] |
| W2 | **Plain scripts, or Claude Code workflows, match F** | *For:* the Haiku builder's scripts 16/16 vs its F workflows 11/16. *Against:* with the Opus builder, F 16/16 vs scripts 12/16, and F's execution CPS is 0.21×. B1-opus's `codefix` loss is the same family trap that sank F-haiku [M C0; D DX]. K_c = 1, directional | C0 sealed with K_c = 2 and a B1-cc arm; F ablated without checks, escalation and verify |
| W3 | **Construction never pays for itself** | Per family vs B0: F-opus 3.8 / 9.6, F-haiku 2.9 / never, B1-haiku 3.9 / never (`records` / `codefix`) [M C0, K_c = 1] | C0 amortisation curves per family; a census of how often your real tasks recur (decision 11) |
| W4 | **Cheap constructors fail on unseen families** | 11/16 vs 16/16 on dev (K_c = 1, CI touching zero); failures are construction defects, one of them a family trap [M C0; D DX] | C0 sealed 2×2; CX3/CX4; the outcome-based rule of §3.5 |
| W5 | **We only win on tests our own model family wrote** | Claude wrote every bed, skill and builder prompt; audits keep finding bypasses [D L1 gap 6] | The wild ladder (§3.7): R-bench with recall guards, external benchmarks, your own tasks |
| W6 | **Self-certified success: judges and verdicts are wrong** | Run verdict "pass" on 5/5 failed F-haiku trials and on fhand-haiku's 1 failure [M]; stock Kev ≤ rules on 4/5 ports [M L1]; the repo's earlier 0/21 skills arm had 21 false successes [D L1] | The acceptance lint plus oracle discovery; verdict-vs-oracle agreement reported for every arm |
| W7 | **Untrusted content takes control** | The validator accepts an effect gated by untrusted data [M L7 A.3]; construction-time injection untested; executor egress open; 47 of 220 agentic items execute model-written code [M AG] | §7 gating, then an injection slice once items 4–5 land. Requirement: zero effects or exfiltration through F |
| W8 | **Scale breaks it** | 1,000-item map: 73–135 s overhead; the CLI tops out at 2.3–3.4 calls/s; the weekly limit stopped all work once [M L4; D README] | Store rows plus the flags; load tests (1,000-item map, 300 nodes, 10 concurrent runs) |
| W9 | **"Represents ~100%" means neither "runs" nor "covers agent patterns"** | 0 compiled; agentic slice at 36% with the planned constructs, and about 20–25% compiled through the plan [M L2; M AG] | Declared/compiled/executed reporting, a fresh held-out sample, the lowering audit |
| W10 | **Model churn invalidates the evidence** | Haiku 4.5 → 5.5 in one day moved single-call success on `records` from 0/30 to 22/29 [M P1] | Re-qualify frozen artifacts after each model or CLI change; re-fit the router head with ≤ 100 labels (RX5) |
| W11 | **Deciding costs more than it saves** | A typed Haiku routing call is about 2% of a P1-sized task, but as much as a trivial $0.0005 task [I L5 §5] | Mixed stream: always-direct vs always-workflow vs the router at 3 settings; one setting must dominate both |
| W12 | **Scope collapse: new asks eat the allowance before numbers exist** | About 61K lines in about a day; this review ran 7 lanes on the same allowance [D L1 W12] | **Rule R6:** no new subsystem without a pre-registered experiment that needs it |
| W13 | **The labs absorb it** | Claude Code workflows plus ultracode shipped [D L3 §1.4]; plugin eval reports with/without deltas [D L1 W13] | Measure the differentiators: replay per item (idea #4), independence labels, dollars per node. Selection across vendors is untestable here: single vendor [D L1 gap 15] |
| W14 | **Composed workflows fail together** (deadlocks, double-counted budgets, two writers, spawn bombs) | No composition semantics exist yet [D L2] | The composition conformance suite (Appendix C) |
| W15 | **You become the bottleneck** | Every trigger activation, approval and human step goes to you; with "all combinations" in AMP, approval fatigue follows [I] | Count approvals per run on the wild ladder; offer bounded batch approval |
| W16 | **This review shares its authors' blind spots** | Every lane, the synthesis and both critics are Claude, so W5 applies to this re-evaluation too [I] | You spot-check 3 claims of your choice against their cited files |
| W17 | **Private data in your tasks** | Rung-4 tasks from ARC/AMP logs may contain secrets [I] | Redact before anything enters the journal, the corpus or exports; AGENTS.md forbids copying credentials |
| W18 | **The "dumb model" proxy gets smarter every release, so the claim drifts** | Haiku 5.5 vs 4.5 (W10); the 9B equivalence is unverified [D L1 #18] | The Haiku 4.5 stress arm (decision 10); later an 8–9B open model through the bridge |

---

## 5. Plan for the next six weeks (2026-10-08 → 2026-11-24)

The first draft packed about two months of work into four weeks, ran comparisons on an engine that the same week was
changing, and let third-party text reach unisolated executors in week 1. This plan fixes the order.

**Constraints.**
- **Usage.** The 7-day limit is at warning until **2026-10-14 11:00 UTC** [D L1 #20]. It resets weekly after that.
- **Pause rule.** Any single experiment estimated above **$500** pauses for you. The self-imposed soft cap is $1,500
  at list price [D README]. List-price dollars are a yardstick; your allowance is the real limit.
- **Throughput.** P1 ran about 24 trials per hour at concurrency 4 [M]. The RX1 pilot (about 1,000 trials) alone is
  about 40 hours of wall time [I].

**Rules for every week** (R1–R6; R1 is decision 13):
- **R1 Usage.** At most 4 concurrent agents, and at most 2 for review or orchestration fan-out. While the 7-day meter
  shows a warning, only pre-registered runs already in flight continue. Heavy runs start just after a reset. Every
  week has a budget in percent of the weekly allowance (proposal: at most 60% for experiment calls), set once week 0
  has calibrated how much allowance a list-price dollar uses. This overrides your "Full speed" choice, so it is
  decision 13.
- **R2 Engine freeze.** The engine bump ends in a named freeze point **E1**: conformance green, hash recorded. No
  comparative run starts before E1, and every comparative run until 11-24 runs on E1. IR work (S0, S1) happens on a
  branch and merges only after the C0 sealed round's last trial.
- **R3 Comparable costs.** Each pre-registration records the CLI flags and the engine hash. Cost per success is
  compared only within one engine and flag setting. Cross-stage comparisons also report cost recomputed from journaled
  token counts at one fixed price table.
- **R4 Powered decisions.** Every kill rule names a non-inferiority margin δ and a family-clustered CI, with a power
  table in the pre-registration. Below the powered size, the outcome is "directional, no decision", and router/no
  router or train/no train decisions wait for a powered read or for you.
- **R5 Seeds and sealing.**
  - The C0-dev test seeds 6001–6004 of `records` and `codefix` are burned. `PREREG-dev.md` gets a dated amendment
    (it still says "never inspected").
  - Every new experiment uses fresh seeds.
  - The sealed families are read once, by one pre-registration holding every arm (C0 sealed, the RX4 slider check, the
    CX5 cascade, the injection slice). After that they become development data.
  - The rerun of the 5 failed F-haiku trials is a regression test, not evidence.
- **R6 No new subsystem** without a pre-registered experiment that needs it (W12).

**Week 0, now → 10-14 11:00 UTC. Writing and finishing only.**
- **Agents:** a single writing agent. No new model runs except finishing P1. Work already in flight (the R-bench
  harness, agentic curation, bed audits, the Kev data groups) finishes its current step and starts nothing new. For
  Kev, see decision 7.
- **Deliverables:**
  - P1 finished and written up as `research/core-20261006/REPORT.md`, quoting the pre-registered rule's result on the
    final rows only;
  - C0 dev `REPORT-dev.md` for `records` and `codefix`, plus the `PREREG-dev.md` seed amendment;
  - one docs commit: README status and cost ledger, the model roles, the decisions below, and the negative results;
  - allowance calibration: the meter percentage against the list dollars of P1 and C0, and the orchestration share
    (free);
  - pre-registration drafts for CX3, the cross-fitted RX1 pilot, EX1, and R-bench (with the recall guards);
  - the structured builder v0 design.
- **Number vs baseline:** P1 fhand-haiku vs the Sonnet call (success and CPS, as pre-registered).
- **Cost:** about $5 (the rest of P1).
- **Kill rules:** P1's own (over $60 total or $20 per arm). If the final CPS-ratio upper bound reaches 1, or
  fhand-haiku's success CI falls below Sonnet's, report "no directional support".

**Weeks 1–2, 10-14 → 10-27. The engine bump, then freeze E1. Work that needs no engine runs alongside.**
- **Engine bump** (about 20–30 engineer-days of work, run in parallel by agents) [I]:
  - the two CLI flags;
  - per-node store rows and the work-conserving scheduler (lane 2's P-store and P-sched, 8–12 engineer-days);
  - the reviewed sandbox launcher;
  - hash-chain binding and anchors, without the board root;
  - control-flow taint **together with** the sink-field label policy (lane 2's G3, 4–6 engineer-days), plus a
    false-positive test;
  - the strict construction lint, with acceptance required to gate;
  - the usage-limit pause (§7 item 10);
  - `foundry cancel` and stop-all;
  - viewer fields G1–G4;
  - executor isolation: network namespace and no login inside the sandbox; the egress proxy if decision 4 is yes.
- **Alongside, with no engine dependency:**
  - structured builder v0: skeletons, oracle discovery and slot schemas;
  - R-bench harnesses for the 5 pilots: shared mock kit, fixtures, references, broken controls, health gates (58 h);
  - the acquisition check for the external benchmarks (free);
  - the 30-item agentic re-check by Opus, and freezing the construct map and refusal list;
  - the free mutation check;
  - idea #4, replay per item ($2);
  - `PREREG-sealed.md`.
- **Numbers:**
  - per-node overhead before and after (1,000-item map, 89 s → target under 5 s);
  - cost and latency per call before and after the flags;
  - the label-policy rejection rate on every bed workflow and on a compiled corpus sample;
  - idea #4's re-execution count;
  - the mutation check: bad answers accepted per artifact.
- **Cost:** about $10–15.
- **Kill rules:**
  - replay conformance must stay byte-identical, or the store change reverts;
  - if more than 10% of honest workflows newly need an approval under taint plus sink policy, redesign before E1 [I
    threshold].

**Week 3, 10-28 → 11-03. Structured construction and routing headroom, on E1.**
- **Deliverables:**
  - CX3: structured vs free Haiku builder, K_c = 3, 2 families, plus the Haiku 4.5 stress arm if decision 10 is yes;
  - CX8: replayed smoke runs;
  - EX1: editing;
  - the RX1 pilot, cross-fitted;
  - the Kev vs Haiku 5.5 probe;
  - the B1-cc headless smoke;
  - the B0-agent probe on `codefix` d4–d5.
- **Numbers:**
  - CX3 test success and dollars vs the free builder;
  - EX1 fix rate per dollar;
  - RX1's lower-bound headroom over the best fixed mode;
  - Kev vs Haiku 5.5 on accuracy, calibration and latency.
- **Cost:** about $155–195 (CX3 $25–35, Haiku 4.5 arm $10–20, CX8 $3, EX1 $15–30, RX1 $85, Kev probe $5–10, smokes
  and probes about $11).
- **Kill rules:**
  - CX3: no better and no cheaper → drop the structured builder;
  - RX1: lower bound under 3 points and under 20% cost everywhere → no router; ship the fixed policy plus hard guards;
  - Kev loses to Haiku 5.5 → that port uses Haiku or rules.

**Week 4, 11-04 → 11-10. R-bench pilots; seal the sealed round.**
- **Deliverables:**
  - 5 R-bench pilots, health-gated, with the recall guards, on the arms §3.7 allows (structured builder on Haiku and
    Opus, B0-call, B1-call; the free builders only after isolation);
  - your tasks collected and sealed (decision 9);
  - `PREREG-sealed.md` frozen on E1.
- **Numbers:** R-bench replicated / attempted, per task type, known vs unknown items, original vs twin.
- **Cost:** about $30–60 in model calls.
- **Kill rule:** the health gate (§3.7).

**Week 5, 11-11 → 11-17. The C0 sealed round, on E1, read once.**
- **Arms:** the 2×2 builders (Haiku and Opus × structured and free; the free builders need isolation), B1 and B0,
  B1-cc if its smoke passed, the CX5 cascade, and the Haiku 4.5 stress arm. The injection slice joins only if §7
  items 4 and 5 have landed; otherwise it is postponed and reported as missing.
- **Families:** the 3 one-shot sealed families. `sealed-3` waits for the env port.
- **Number:** sealed success and CPS for every arm.
- **Cost:** expected about $200–260 [I], from C0-dev unit costs (about $1.9 per construction and $0.19 per trial),
  under the $350 kill line.
- **Kill rules:** the W1 rule (2 of 3 families); the §3.5 outcome rule; B1 ≥ F for both builders → the typed IR is kept
  only where verdicts and replay are needed.

**Week 6, 11-18 → 11-24. Composition and the first owner tasks.**
- **Deliverables:**
  - IR-S0 and IR-S1 merged after the sealed round, giving the **first compiled coverage number** on the corpus and the
    agentic slice (earliest; likely later, since S0–S1 is about 27–40 engineer-days [I]);
  - `wide` vs B5 on `records`;
  - the first run of your sealed tasks: **the first end-to-end milestone**;
  - the executor experiment, only if isolation passed;
  - the private-notes test, if capacity allows.
- **Numbers:** compiled coverage; `wide` vs B5; your tasks F vs B0 vs B1; the executor workflow vs Claude Code alone.
- **Cost:** about $160–290 (`wide` $80–150, your tasks $20–40, executor $60–100).
- **Kill rules:**
  - `wide` loses to B5 → no swarm default;
  - the executor shows no gain over Claude Code alone → executors are a fallback only.

**After 11-24, in order:** IR-S2 and its capability check; CX4; router v0 offline, only if RX1 found headroom; Kev
training only on ports where Kev beat Haiku 5.5; R-bench grown to about 30 items; the board experiment, if its trigger
fires.

**Totals [I].** Experiment calls for the six weeks come to about **$560–825** at list price. With about $88 already
spent, that is $650–915 in total. If the Kev hosted approval ($150–450) were also spent, the total would reach about
$800–1,365, against the $1,500 soft cap. Orchestration is extra and counts against the allowance. No single experiment
exceeds $500.

**Stop or defer** (each with its reason and the trigger that reopens it):

| Item | Why | Reopens when |
|---|---|---|
| A Rust kernel port | ≤ 3% gain; the target is moving [M L4] | the four conditions of §3.14 |
| Triggers, durable waits, sessions, streams (IR S3–S6) | after the S2 capability check, which sets Haiku's kit and the build order (decision 6) | S2 done |
| A full board (waits, summaries, cross-run scopes) and the board experiment | needs board v1 and its security preconditions; no bed needs it yet [L7] | a pre-registered bed with parallel explorers sharing findings |
| A swarm subsystem; fan-outs above 32 | an operator plus B5 first [L3] | `wide` beats B5 |
| A Foundry-native agent loop | executor first; needs a ROADMAP §3 amendment [L7 §3.3] | a measured family needs turn-level replay |
| Training any generator, Haiku or 7–8B | the §3.8 trigger is not met | §3.8 trigger |
| The full Kev wave-1 build (13 ports of 42) | Kev's cost edge is gone; compare against Haiku 5.5 first [I L1 gap 9] | the week-3 probe, port by port (decision 7) |
| Haiku building the `construct+` tier | needs a decomposition experiment [L5 §2.4] | CX3 and C0 sealed show Haiku non-inferior on `construct` |
| Image inputs and the env port (your game-QA "visual understanding node"; `sealed-3`) | `gameqa` unaudited; about 0.5–1 week for image inputs on agent nodes (`schemas/workflow.schema.json:63`, `src/context.mjs:49–53`) plus the env contract [I] | first slot after 11-24, before Phase 6's game-QA reference |
| Reuse (Phase 5): admission, wrong-reuse, deopt and reuse rates | the narrowed claim depends on it, but recurrence is unmeasured | your recurring-task list or logs (decision 11) |
| A second interpreter, or lowering to a Claude Code workflow script | tests harness independence | IR-S0 conformance suite exists |
| "Ask about this node" in the viewer | needs an experiment on authority-free answers | viewer passes its 10-run test |
| Moving the viewer into `web/`; editing or approving from it | after the C0 freeze; never an editor [L6] | 10-run test passes |
| New beds beyond the pending audits | wild-tier tasks instead | — |
| ARC/AMP integration | Phase 7 experiment (D4) | Phase 7 |
| More review lanes | W12 | — |

---

## 6. Decisions needed from you

Each decision says what happens if you say yes, what happens if you say no, what it costs you, and the default that
applies if you don't answer.

**Needed now**

1. **Finish "it becomes essentially …"**
   - *If you finish it:* it goes into THESIS §1 as your words.
   - *If not:* the documents quote "a mini harness … to build focussed systems to execute tasks" and leave the
     sentence open.
   - *Cost to you:* one sentence. *Default:* left open.
2. **Define "~100%".** Represent exactly or reject with a named reason. The headline is compiled plus executed (on
   items with an oracle), on a fresh held-out sample of about 300 items collected after the IR freeze, with declared
   reported alongside, and the agentic slice included.
   - *If yes:* this becomes the coverage claim in ROADMAP.
   - *If no:* tell us which number you want as the headline.
   - *Default:* yes.
3. **Model roles.**
   - Haiku 5.5 runs workflows (measured: P1).
   - Haiku 5.5 constructs from templates (measured: C0 dev; CX3 next) and edits (to be measured: EX1). Edits are
     version-bound proposals applied by code after replay, never inside a running run.
   - Opus writes the template library, builds the `construct+` tier, and is the escalation constructor.
   - Opus and Sonnet build Foundry itself.
   - Local generative models stay parked.
   - Kev is the *candidate* local judge, kept on a port only where it beats Haiku 5.5 and rules.

   *If yes:* recorded in THESIS and ROADMAP §2.3 and §2.5. *If no:* say which role changes. *Default:* yes.
4. **Executor access to models, in plain terms.** Running Claude Code inside a node safely, with no network, means
   its model calls go through a small proxy on the host. That would likely ask you to put an API key in the
   environment. You told me on 10-06 not to ask you to authenticate anything, so the default is **no**.
   - *If no:* Claude Code never runs inside a node on text from outside (corpus items, benchmarks, your
     repositories). R-bench and C0 sealed use the structured builder only; the free-builder arms, B0-agent on outside
     text, the injection slice and the executor experiment wait. Before relying on this, I will check whether a
     host-side proxy can work without any new credential.
   - *If yes:* you provision one key; executors get `egress: none` and per-node, revocable tokens.
   - *Default:* no.
5. **No mutable cross-run store in Foundry.** Lessons go to AMP or into a replay-proven new version; application state
   goes to a typed state capability behind the ContextPort.
   - *If yes:* ROADMAP §2.2 drops the `workflow` scope, and §3 gets a clarifying clause.
   - *If no:* a Foundry cross-run store needs its own design and a security review (poisoning across runs).
   - *Default:* yes.
6. **Keep building toward ~100% representation (IR S3–S7, about 125–190 engineer-days by lane 2's estimate) even if
   the new constructs don't help Haiku build?**
   - *If yes:* the S2 check only orders the work and sets Haiku's kit.
   - *If no:* constructs that don't help Haiku wait.
   - *Default:* yes, at a lower priority than the wild ladder.
7. **Kev.** Two data-group workflows are running now.
   - *Recommendation:* let them finish their current group, then pause further groups and laptop training until the
     Kev vs Haiku 5.5 probe ($5–10, week 3) reports. The laptop bridge, the contracts library and the probes stay. The
     $150–450 hosted approval is held, not spent, until then.
   - *If you'd rather keep building:* the data groups continue in parallel, at the cost of allowance during the
     warning week.
   - *Default:* pause as recommended.
8. **Close C0 dev at `records` and `codefix`.** This reverses the 08:06 plan to run C0 on `incident`, `kinetics` and
   `synth`: their audits aren't finished, `src` is frozen for C0, and the sealed round is the claim-bearing one.
   - *If yes:* the lessons go into the kit before the sealed round.
   - *If no:* dev rounds on more families delay the sealed round by about a week each.
   - *Default:* yes.
9. **Write 20–30 tasks yourself**, as I asked at 08:10, each with an acceptance check or a few input/output examples,
   sealed until the run.
   - *If yes:* rung 3 runs in week 6, and the first end-to-end milestone uses one of them.
   - *If none arrive by 10-28:* rung 3 is reported as missing, and the wild evidence is R-bench and the external
     benchmarks only.
   - *Cost to you:* an hour or two. *Default:* missing.
10. **Haiku 4.5 as a weak-constructor stress arm** in CX3 and C0 sealed (about +$10–20), because Haiku 5.5 is no longer
    "akin to a 9b model".
    - *If no:* Haiku 5.5 results stand for "cheap" but not for "dumb".
    - *Default:* yes.
11. **Your recurring tasks.** Can you list your 10 most frequent recurring tasks, or export a few weeks of ARC/AMP task
    logs (we redact them)?
    - *If no:* "workflows pay off on tasks that recur" stays unchecked, and reuse stays deferred.
    - *Default:* no list.
12. **Rust: not now**, except the reviewed 115-line sandbox launcher (the triggers to revisit are in §3.14).
    *Default:* confirmed.
13. **The usage rule R1** (at most 4 agents; only in-flight pre-registered runs while the meter warns; heavy runs
    after resets; weekly allowance budgets). It overrides your "Full speed" choice.
    - *If no:* full speed, with the risk of another stop like 10-06.
    - *Default:* yes.
14. **Two R-bench enablers.**
    - (a) ROADMAP §2.9 says the builder's context must not contain untrusted content. Amend it to: "builders may read
      third-party task text only with provenance taint, no effects, no egress and mock capabilities".
    - (b) The bed contract allows R-bench oracles up to 60 s per scenario and a runner shim.
    - *If no:* R-bench cannot run.
    - *Default:* yes to both.
15. **Phases interleave.** The original brief says "Phases 1→6 in order". This plan runs construction, routing,
    composition and the wild ladder in the same weeks, in a dated order; each phase still ends with its own report.
    - *If yes:* ROADMAP §5 and the kickoff prompt say so.
    - *If no:* composition and the router wait for Phases 2–5 to finish, which delays your nesting and router asks
      by weeks to months [I].
    - *Default:* yes.

**Can wait** (they govern work deferred past 11-24):
- The slider's default position (Balanced, V = $1, about 1 in 15 low-stakes tasks deliberately routed differently so
  the router learns honestly): only once a router exists.
- Who may activate triggers (proposal: model-built workflows declare triggers; only you activate them): at IR stage
  S3.
- Resuming a run under a newer engine when replay reproduces its checkpoint: THESIS D2's recommendation already says
  this, so nothing to decide now.

**For your information.**
- `n8n:18122`, a public n8n template, embeds Slack and Discord webhook URLs that look like live credentials. Nothing
  was copied.
- PR #1 has been waiting for review since 10-06.

---

## 7. Security and integrity: what must pass before which run

None of these is optional for R-bench items, corpus fixtures, external benchmarks or your repositories. The first
draft promised them "in the Stage-1 bump" while its plan ran third-party text through open-network executors in the
same week. **Each item now gates the first run that needs it.** Details for every item are in Appendix D.

| Item | Must pass before | Test that must pass first |
|---|---|---|
| 5 **Executor isolation**: no network, no login inside the sandbox, per-node revocable tokens; needs decision 4 for model access | any builder, B0-agent or B1 run in Claude Code on R-bench, corpus, external benchmark or your repositories; the injection slice; the executor experiment | a canary file and a canary in task data never leave; a network probe shows no egress; token reuse from another node is rejected |
| 1 + 2 **Control-flow taint and the sink-field policy, together** | any R-bench validation and any compiled-coverage number | probe B fails with `LABEL_POLICY`; honest "webhook → write row" items pass; at most 10% of honest workflows newly need approval |
| 4 **Construction-time provenance taint** | any builder reading third-party text (R-bench translate and rebuild, the injection slice) | a planted-instruction slice: zero effects or exfiltration through F |
| 6 **Model-written code** only as sandboxed `code`, no network, tainted output | any agentic item that executes model-written code (47 of 220) | a planted escape attempt fails |
| 3 **Declassification budget** | any workflow mapping a quarantined node over many untrusted items into an effect | the 26-letter enum-spelling attack is rejected |
| 7 **Hash-chain binding** (without a board root until a board exists) | any claim-bearing run (C0 sealed) | edit one journal byte → `verify` fails |
| 8 **Acceptance lint** | CX3 and every later construction | rerun of the 5 failed F-haiku trials: verdict not `pass` (a regression test) |
| 10 **Usage-limit pause** (shared backoff gate) | lands in the engine bump; protects every heavy run | 16 map items hitting a 429 retry once, staggered |
| 13 **Corpus and R-bench sources inert**; originals as controls only in the no-network sandbox, within the image-size cap | R-bench harness building | acquisition-manifest check |
| 15 **Retrieval poisoning**: only reviewed skeletons enter the builder's trusted context; every retrieved snippet carries a provenance label | the first corpus-mined skeleton or worked example | a poisoned snippet in retrieval changes no effect and no acceptance check |
| 16 **Board threats**: injection through topics (S1), confused deputy (S5), flooding (S6) | any board experiment | lane 7's S1, S5 and S6 fixtures |
| 9 **Triggers**: models declare, you activate; rate limits; wait timeouts | IR stage S3 | activation without your approval is rejected |
| 11 **Read-only viewer**, strict CSP, sanitised text, redaction on export | moving the viewer into `web/` | the 74 browser checks, including hostile text |
| 12 **Sandbox launcher reviewed** as a security component; the old path kept as a logged fallback | replacing the shell path | the 15 sandbox tests plus escape tests beyond the suite |
| 14 **Laptop bridge**: signed, allowlisted jobs | the first real round trip | the bridge test suite |
| 17 **Corpus extraction re-check** | using the 36% agentic figure in any decision | 30 items re-checked by Opus against source |

---

## 8. Proposed ROADMAP and doc changes

The exact old and new text, with rationale and whether you need to decide, is in
[`ROADMAP-AMENDMENTS.md`](ROADMAP-AMENDMENTS.md). In short:
- **THESIS §1, §4, §10:** "cheap open-weight models" becomes "cheap models (Haiku 5.5 today; open-weight models once a
  GPU route exists)"; the ambition is added in your words; the new decisions are recorded.
- **ROADMAP §2.1:** the coverage goal (exact or reject; three numbers); `call` with depth and budget rules; the
  `executor` node's isolation; the `wide` and `panel` operators; `agent.tools` represented; `machine`; map error and
  budget semantics; image inputs.
- **§2.2:** no `workflow` scope; the board is built only behind its experiment.
- **§2.3:** model roles.
- **§2.5:** the construction cascade (Haiku first, Opus escalation and `construct+`); oracle discovery and the lint;
  edits as replay-proven proposals.
- **§2.6:** acceptance must gate; verdict agreement with the oracle reported.
- **§2.8:** the need router and slider, built only if RX1 finds headroom.
- **§2.9:** the gating table; builders reading third-party text under provenance taint; executor isolation.
- **§2.10:** the read-only run viewer and the control surface.
- **§3:** clarifications (agent loop, memory store, gateway, tracing UI, self-modification) and a swarm clause.
- **§4:** claims C6 (representation) and C7 (need routing); the wild ladder and R-bench; protocol rules R2–R5.
- **§5:** phases interleave in a dated plan (the original brief said phases in order; decision 15); Phase 6's
  end-to-end case uses `gridquest` until the env port exists.
- **§6:** the usage rule and the no-new-subsystem rule.
- **Outside `docs/`:** README (status table, link to this review, "Haiku 4.5 is the cheap executor" is stale) and the
  AGENTS.md objective ("Cheap open-weight models execute").

---

## Appendix A. Glossary

| Term | Meaning |
|---|---|
| **Acceptance** | The check at the end of a workflow that decides its verdict. "Existence-only" acceptance passes as soon as any answer exists |
| **Allowance** | The weekly usage limit of the plan that pays for every model call and agent; list-price dollars are only a yardstick |
| **Amortised CPS** | Cost per verified success including the one-off construction cost |
| **Break-even** | How many successes a built workflow needs before its construction cost is repaid |
| **Compare-and-swap (CAS)** | A write that succeeds only if the value hasn't changed since you read it; it prevents two writers clobbering each other |
| **Construction** | Building a workflow for a task. **Free builder:** an agent (Claude Code) writes it freely. **Structured builder:** a Foundry workflow builds it in small checked steps |
| **Control-flow taint** | Treating a decision as untrusted if it depends on untrusted data, so it can't trigger effects without approval |
| **Cross-fitting** | Choosing on one half of the data and scoring on the other, to avoid flattering yourself |
| **Declared / compiled / executed** | The three coverage numbers (§3.1) |
| **δ (non-inferiority margin)** | How much worse an arm may be and still count as "as good" |
| **E1** | The engine freeze point after the week 1–2 engine bump |
| **Egress** | Network traffic leaving a sandbox |
| **Executor** | A full external agent (Claude Code, Codex) used as one bounded node |
| **IR** | The workflow language: typed nodes and edges in JSON |
| **IR stages S0–S7** | The seven construct batches toward ~100% coverage (§3.1); not the plan's weeks |
| **Kev** | The small local judge model (0.8B) for typed yes/no and choose-one-of-N calls |
| **Lint** | Static checks on a built workflow that reject known-bad patterns |
| **Oracle** | An independent, executable check of whether a task was really solved |
| **Pre-registration** | Writing down arms, sizes, metrics and kill rules before running |
| **Provenance taint** | A label on text derived from untrusted input that travels with it |
| **R-bench** | The replication benchmark: rebuild real hand-made workflows and check them on hidden scenarios |
| **Replay** | Re-running a recorded run from its journal, reproducing every model reply |
| **Rungs 0–4** | The wild evaluation ladder (§3.7) |
| **Sealed family** | A task family written by a separate author and never seen during development |
| **Sink-field policy** | Untrusted data may fill data fields (a row's values) but not control fields (a recipient, path or URL) |
| **Slider** | Your setting for "how much is a correct result worth to you?" (§3.4) |
| **`wide`** | The swarm operator: planner, checked subtask list, cheap workers, reducer, verifier |
| **Winner's curse** | Picking the best of several noisy estimates overstates how good it is |

## Appendix B. The slider formula

With N expected uses, construct a workflow when

    p̂_F − p̂_D ≥ (ĉ_F − ĉ_D + λ_t·Δt + Ĉ_F / N) / V

- p̂ is the predicted success of the workflow (F) and of the direct mode (D);
- ĉ is the cost per run, and Ĉ_F the one-off cost of construction;
- λ_t is what a minute of waiting is worth to you, and Δt the extra minutes the workflow takes;
- V is the dollar value of one verified success: the slider.

Risk aversion is a second notch: use the lower confidence bound of p̂ instead of its mean. Hard requirements override
both and say why [L5 §2.8].

## Appendix C. Composition: rules, matrix and edge cases

**Rules** [I, from L2 §4–5, L3 §3.6, L7 §3.4]:

| Rule | Value |
|---|---|
| Static nesting inside one document | ≤ 6 (as today) |
| `call` depth | default 3; hard policy ceiling 8 |
| Runs per tree | ≤ 1,000 |
| Recursion | only through `self` or local flows, with `maxDepth`; by hash impossible |
| Termination | each child gets a strictly smaller budget than its parent has left |
| Iteration | `loop` ≤ 1,000 iterations, with convergence (`delta`, `patience`) and `onExhausted: best`; arbitrary cycles in a bounded `machine` (≤ 1,000 transitions) |
| Infinite processes | triggered runs, activated by you |
| Executors | ≤ 2 concurrent, ≤ 16 per run; nested agents 0 by default |
| Swarm fan-out | ≤ 32 without evidence |

**Composition matrix** ("alll possibly combinations"):

| Combination | Supported now | IR stage | Refused (why) | Conformance test |
|---|---|---|---|---|
| Sequence | yes (edges) | — | — | existing suite |
| Independent parallel | yes (parallel `map`, fan-out) | — | — | 1,000-item load test |
| Parallel with a shared board | no | board v1 (deferred) | — | CAS conflicts, replay at a fixed sequence number, flood |
| Nested `call` (by hash) | no; static nesting only | S1 | — | depth bomb, budget carving, cancellation storm |
| Recursion via `self` or a local flow | no | S1 | by hash: impossible | `maxDepth` exceeded is rejected; budget strictly decreasing |
| `map` over `call` | no | S1 | — | frame keys; idempotency key (callee hash, input hash, parent path); shared rate gate |
| Race, first-wins, first-k | no | S7 (`detach`/`await`) | — | losers cancelled; completion order journaled |
| Pipeline or stream | no | S6 | unbounded streams | back pressure |
| Trigger chains | no | S3 | activation by a model | activation without approval rejected; loop detection |
| A supervisor of workflows | partly (executor adapter) | S1 + S7 (`expand`) | free-form spawning | spawn-bomb cap; privileges may only narrow |
| Across stores (MCP, A2A) | no | Phase 7 | ambient run ids | handle-only addressing |
| Group chat | no | — | design choice (MAST failure data); representable with a turn cap | — |
| Full-history handoff | no | — | design choice; representable with a turn cap | — |

**Edge cases** (rule, then test):
- *Partial failure at fan-in:* `onItemError: fail | collect | quorum(k)`; typed coverage to the reducer; no `pass` with
  collected errors unless acceptance allows it; ties to the `ERROR_COLLECTION` lint. Test: 3 of 16 workers fail.
- *Budget exhaustion mid-swarm:* stop launching; in-flight items keep their reservation; unstarted items are
  `skipped: budget`; partial result with verdict `inconclusive` (budget); unused reservations return. Static
  `BUDGET_TOO_SMALL`. Test: a 16-item map that runs out at item 9.
- *Usage limit mid-run:* pause, not fail; model ids and CLI version pinned per run; mixed-version resume refused unless
  replay matches.
- *Human steps in nested runs:* the question carries its path, workflow hash and question hash; stale answers are
  rejected; the parent's deadline keeps running unless the node declares otherwise; no approval covers sibling items
  unless it is a declared batch approval.
- *`call` before sagas:* callees may have only idempotent or approval-gated effects until S7.
- *Versioning:* a revocation list overrides hash pins for security defects (running runs stop at the next boundary;
  pending triggers are disabled); an IR version per document with migration tests S1→S7; template and kit versions
  recorded; re-qualification on model, CLI, engine or template change.
- *Siblings calling the same child with the same input:* one idempotency key, one shared rate-limit gate.
- *Already specified in L2 §4:* budgets and deadlines carved with reservations; cancellation propagates; a
  non-idempotent child in flight becomes `uncertain`; sagas compensate in reverse journaled order; frame keys and
  labels compose through `map` in `loop` in `call`; composite nodes hold no concurrency slots; runs talk only through
  handles; a callee upgrade is a proposal checked by replay; the parent's chain commits to each child's head; human
  steps deep in a tree surface at the root.

## Appendix D. Security items in detail

| # | Gap today | Fix | Source |
|---|---|---|---|
| 1 | `when`, `until`, map count and waits on untrusted data can decide whether an effect fires; the validator says `valid: true` | Program-counter taint: the condition's labels join into every node it controls; an untrusted condition plus an effect needs approval or quarantine (`UNTRUSTED_CONTROL`) | [M L7 A.3, S2] |
| 2 | Label policy is all-or-nothing on effect arguments | Sink-field policy: untrusted data may reach data sinks; control sinks need approval or a quarantined endorsement. Ships with item 1 | [D L2 G3] |
| 3 | A 64-bit quarantined output mapped over 1,000 items yields 64 Kbit of "trusted" data | A run-level declassification budget in bits; effect arguments built from declassified values must match an allowlist or enum | [I L7 S3] |
| 4 | Builders read untrusted task text and write *trusted* workflow text | Provenance taint on derived workflow text; your approval before such a workflow uses effects or egress; the router reads trusted fields only, and its hard guard can only add structure | [D L1 gap 10; L7 S10; L5 §2.5] |
| 5 | No network namespace; CLI login readable in the sandbox; Bash on by default; nested `claude -p` detected only afterwards | `egress: none` by default (private network namespace plus a unix-socket proxy); no login inside the sandbox; per-node, budget-scoped, revocable tokens; nested model use blocked up front | [D L7 §3.4, S4, S5] |
| 6 | Model-written code (47/220 agentic items) | Run only as sandboxed `code` with no network; output labelled untrusted; never on the host | [M AG; I] |
| 7 | Responses, decisions, transcripts and the journal are not bound; no external anchor | `requestHash`/`responseHash`; `decision.recorded`; `transcriptHash`; `journalRoot` at seal; heads anchored in committed manifests; `foundry verify RUN` | [D L7 §4.4] |
| 8 | Acceptance reduces to "an answer exists"; failed batches dropped silently | Lint errors `ACCEPTANCE_EXISTENCE_ONLY`, `VERIFY_NOT_GATING`, `ERROR_COLLECTION`; every report shows run verdict vs oracle | [M L5; D DX] |
| 9 | Triggers and long-lived authority | Model-built workflows *declare* triggers and never activate them; rate limits; mandatory wait timeouts; runs addressed only by handle | [I L2 §5, §10] |
| 10 | Retry storms on rate limits; `-p` runs fail at the usage limit | A shared per-provider backoff gate; a usage-limit pause instead of failure | [I L7 §3.5; L3 §2.5] |
| 11 | The viewer becoming an actor | No approve, answer or resume buttons; strict CSP; sanitised text; redaction on export (regex redaction cannot catch secrets of unknown shape) | [M L6 §6] |
| 12 | A swapped sandbox launcher | Review as a security component; keep the old path as a logged fallback | [D L4 §6, §9] |
| 13 | Corpus and R-bench sources | Inert data: never run install hooks; execute only against mocks; originals as controls only in the no-network sandbox; licence and redistributability per item | [D AGENTS.md; SELECTION §7] |
| 14 | The laptop bridge | Keep signed, allowlisted jobs; re-verify on the first real round trip | [D L1 #48, W7] |
| 15 | Retrieval poisoning | Only reviewed skeletons in the builder's trusted context; provenance label on every retrieved snippet; corpus-mined text untrusted until reviewed | [I, critique A P1-11] |
| 16 | Board threats | Event labels = writer label; effectful readers can't read untrusted topics unless quarantined; per-writer caps; per-node gateway tokens | [D L7 §6 S1, S5, S6] |
| 17 | Corpus extraction by Sonnet agents over untrusted repositories | A 30-item re-check by another model class before the figures drive a decision | [M AG; critique A P1-11] |

---

## Review log

Every finding from the two critiques, and what this revision did with it. **Fixed:** applied as asked or equivalently.
**Partly:** applied in part, with the reason. **Rejected:** not applied, with the reason. "A" is the alignment critique
and "B" the rigour critique; section references are to this revision.

**Critique A (owner alignment and completeness)**

| ID | Finding | Handling |
|---|---|---|
| A P0-1 | Twelve contradictions with what the owner was told, eleven unflagged; stale numbers | **Fixed.** "What changed since I last told you" (16 rows, checked against the transcript); both analysis scripts re-run at 08:44 and every number updated in one pass, including the top list |
| A P0-2 | "~100%" made conditional on helping a Haiku builder | **Fixed.** §3.1 falsifier reworded as proposed; the S2 kill rule now orders work and sets Haiku's kit; decision 6 added (default yes) |
| A P0-3 | The edit half has no experiment | **Fixed.** EX1 specified (§3.5) and scheduled in week 3; decision 3 says "edits (to be measured: EX1)"; edits are offline replay-proven proposals |
| A P0-4 | R-bench lacks the promised guards | **Fixed.** Three task types scored separately; memorisation probe; perturbed twins; recency; source firewall with near-duplicate check; no model-written descriptions in rebuild; B0 arm; pilot deliverables vs promise stated (§3.7) |
| A P0-5 | Security order contradicts itself; decision 4 collides with "dont ask me to authenticate" | **Fixed.** §7 is a gating table; R-bench arms restricted to builders without an executor until isolation lands; injection slice after items 4–5; decision 4 rewritten in plain terms, "likely" restored, credential-free check promised |
| A P0-6 | The plan stops running Kev work and promised next steps without saying so | **Fixed.** Decision 7 (pause after current groups; $150–450 held); decision 3's Kev clause reworded; decision 8 states the reversal of the 08:06 C0 plan with reasons |
| A P1-1 | Our words as the default for his ambition sentence | **Fixed.** Default "left open"; his words quoted; the guess marked as a guess and kept out of decisions and amendments |
| A P1-2 | "Not 'any task'" reads as a retreat | **Fixed.** §1 and §3.18 use the proposed wording |
| A P1-3 | Haiku 5.5 is no longer the "dumb ~9B" stand-in | **Fixed.** Sentence in §3.5 and point 4; decision 10 (Haiku 4.5 stress arm); W18 added |
| A P1-4 | Map his complexity scale onto the modes; slider in his terms | **Fixed.** Mapping table in §3.4; slider phrased as "how much is a correct result worth to you?"; formula moved to Appendix B |
| A P1-5 | Hardest tier is Opus-built, unstated | **Fixed.** Stated in §3.5, point 10 and decision 3; defer row with trigger |
| A P1-6 | Game-QA visual node disappeared; unrunnable end-to-end falsifier | **Fixed.** Defer row for image inputs and env port with an estimate [I]; `gridquest` replaces game-QA as the end-to-end case until then |
| A P1-7 | Board/private notes unscheduled; B0+N evidence confounded | **Partly.** B0+N bullet restated ("15 of 19 failures are timeouts; not evidence about boards"); private-notes test in week 6 if capacity allows; the board experiment is **deferred with a trigger**, because board v1 is engine work that does not fit before 11-24 |
| A P1-8 | "All combinations" and edge cases missing | **Fixed.** Composition matrix and the seven edge cases with rules and tests (§3.2, Appendix C); refusals by preference relabelled |
| A P1-9 | No control surface; the 10-07 stop was messy | **Fixed.** §3.17 names the channels; `foundry cancel` and stop-all in the engine bump, with the three-deep cancellation test |
| A P1-10 | Evaluation leakage beyond R-bench | **Fixed.** CX2 replaced by the mutation check; sealed families read once (rule R5); owner-task sealing procedure; interim-looks statement (§3.7); router labels dev-only (§3.4) |
| A P1-11 | Injection paths omitted (retrieval poisoning, board, corpus extraction) | **Fixed.** §7 items 15–17 and Appendix D |
| A P1-12 | Reuse vanished | **Fixed.** Defer row with trigger; decision 11 (recurring tasks or logs); reuse metrics noted as not built (§2) |
| A P1-13 | Harness independence has one implementation | **Fixed.** §1 reworded; second interpreter or lowering deferred with trigger |
| A P1-14 | "Given the corpus" unanswered | **Fixed.** "What the corpus is for" in §3.5, referenced from §3.8 |
| A P1-15 | Usage rule overrides "Full speed"; totals; list-price meaning | **Fixed.** Decision 13; totals with and without the Kev approval against the $1,500 cap; list-price sentence in §2 and §5 |
| A P1-16 | The promised revised roadmap is missing | **Fixed.** §8 summary plus `ROADMAP-AMENDMENTS.md` with exact text; the "phases in order" change is decision 15 |
| A P1-17 | Replace the fraction; define the core; give dates | **Fixed.** Counts in §2; "the core" defined; first end-to-end milestone in the week of 11-18; S7 has no date (stated) |
| A P1-18 | Plain language | **Partly.** Front page, arms box, glossary (25+ terms), wild rungs and plan weeks renamed, decisions as if-yes/if-no/default, formula and rule and security tables moved to appendices. The body still uses technical terms where precision matters; each is in the glossary |
| A P2-1 | How swarms work | **Fixed.** §3.9, with Kimi's trained orchestrator noted |
| A P2-2 | Game-QA screenshots are a fixture | **Fixed.** §3.17 and the §2 UI row |
| A P2-3 | "Ask about this node" | **Fixed.** Proposal in §3.17, deferred with trigger |
| A P2-4 | Break-even numbers conflict | **Fixed.** Per-family table in §3.4; pooled figure dropped |
| A P2-5 | Two UI kill rules | **Fixed.** 10 runs, with a 3-run pilot |
| A P2-6 | "Audit trail" as a hard requirement makes the slider moot | **Fixed.** Defined as "beyond the model-call journal" (§3.4) |
| A P2-7 | Itemise orchestration | **Partly.** 25.8M subagent tokens across 28 completed workflows [M]; no dollar figure, because the model mix per token is not recorded |
| A P2-8 | Process items from the re-read | **Fixed.** Paragraph in §2; README link proposed in amendments |
| A P2-9 | "Gateway" wording vs non-goal | **Fixed.** Called an egress proxy, a security boundary (§1, §3.11); §3 amendment proposed |
| A P2-10 | Haiku 4.5's zero is mostly one structural violation | **Fixed.** Point 4 (19 of 30) |
| A P2-11 | Missing worst cases | **Fixed.** W15, W16, W17 added (and W18 from A P1-3) |
| A P2-12 | B5 and B1-cc never built | **Fixed.** B1-cc smoke in week 3; B5 built with `wide` in week 6 |
| A P2-13 | Name the Rust exception | **Fixed.** Point 11, §3.14, decision 12 |
| A P2-14 | Unmeasured components | **Fixed.** List in §3.14 |

**Critique B (rigour and feasibility)**

| ID | Finding | Handling |
|---|---|---|
| B P0-1 | Security fixes land after the runs that need them | **Fixed.** §7 gating table; R-bench construction runs need item 5 or use the in-runtime structured builder only; §2.9 amendment as decision 14(a); originals run only in the no-network sandbox |
| B P0-2 | K_c = 1 results stated as findings | **Fixed.** Point 2 and the §3.6 paragraph replaced with the proposed text (numbers updated to 08:44); §3.7 "hints"; W2 and W4 tagged with the B1-opus `codefix` cause |
| B P0-3 | Stages depend on unbuilt things | **Fixed.** Structured builder v0 as a weeks 1–2 deliverable (effort [unk] stated); R-bench kill rule → SELECTION's health gate; sealed round on 3 one-shot families with W1 "2 of 3"; `PREREG-sealed.md` a deliverable; $1 B1-cc smoke; `wide` on `records` only; board root dropped; external benchmark acquisition check scheduled (week 1) and decision 9's fallback changed |
| B P0-4 | Engine changes collide with frozen comparative runs | **Fixed.** Rules R2 (E1 freeze; IR on a branch until after the sealed round) and R3 (flags and engine hash recorded; cost recomputed at a fixed price table); P-store, P-sched and G3 moved out of S0, and S0 restated as 18–27 engineer-days |
| B P0-5 | Four weeks hold two months; usage not budgeted | **Fixed.** Re-planned over six weeks in the proposed order; week 0 is writing only with one agent; allowance calibration and per-week allowance budgets; honest date for compiled coverage (earliest 11-24) |
| B P1-1 | RX1 headroom biased upward | **Fixed.** Cross-fitting, shuffled-label null, kill on the lower bound, E1 only, legacy label for C0-dev artifacts (§3.4) |
| B P1-2 | 3- and 5-point thresholds unresolvable | **Fixed.** Rule R4 (δ, clustered CI, power table, "directional, no decision"); thresholds restated as non-inferiority margins in §3.5, §3.8, §3.9 and §3.15 |
| B P1-3 | C0 sealed kill rule cannot fire; model and method confounded | **Fixed.** Rule on test success and amortised CPS; 2×2 design; the "half of Opus" bar replaced by δ = 15 points, with the reason (§3.5) |
| B P1-4 | Pooled break-even misleads | **Fixed.** Per-family only, with K_c = 1 and the B0 meaning noted |
| B P1-5 | B0+N is a timeout artefact | **Fixed.** Restated in §3.12 (15 of 19 failures at 08:44) |
| B P1-6 | Coverage claims run ahead (a–f) | **Fixed.** (a) "targets", (b) "target" for semantics and conformance, (c) executed ÷ oracle-eligible, (d) acquisition plan for the held-out sample, (e) group chat excluded and recomputed at 220 items, (f) agent tool loop share and compiled 20–25% stated |
| B P1-7 | The agentic falsifier cannot fail | **Fixed.** Map and refusal list frozen by hash; "implemented and compiled by end of S5", judged by a different agent; agentic descriptions kept out of rebuild tasks and router labels |
| B P1-8 | Plan items conflict with ROADMAP §3 and THESIS without amendments | **Fixed.** Every row has an amendment in `ROADMAP-AMENDMENTS.md` (gateway, memory store, self-modification, agent loop, tracing UI, open-weight claim); `tools/` noted as a new top-level directory |
| B P1-9 | Usage-limit incident count inconsistent | **Fixed.** "Once" (10-06 20:00 → 10-07 11:00); T:3571 describes the same incident; the lane 1 "twice" appears to double-count it |
| B P1-10 | Missing baselines; S1 lacks a capability number; owner tasks lack an oracle protocol | **Partly.** B0 and B1 added to R-bench; owner-task sealing protocol added. S1's capability number (S1 vs S0 on the Haiku builder) is **not** scheduled before 11-24, because S1 merges only in week 6; it opens the post-11-24 list |
| B P1-11 | The executor experiment's baseline is at ceiling | **Fixed.** B0-agent probe on `codefix` d4–d5 in week 3; run where B0 < 70%, or on `ownerci` |
| B P1-12 | CX2 has no variance | **Fixed.** Replaced by the free mutation check; CX2 kept only for rules that vary, on post-freeze artifacts |
| B P1-13 | C0-dev test seeds burned, record says otherwise | **Fixed.** Rule R5: dated `PREREG-dev` amendment (week 0), fresh seeds, the rerun labelled a regression test |
| B P1-14 | Worked example uses stale numbers | **Fixed.** Redone from P1 and C0 numbers (§3.4); "one Haiku call", not "one Sonnet call", for a one-off |
| B P1-15 | No false-positive test for the security fixes | **Fixed.** Items 1 and 2 ship together; rejection rate measured on beds and the corpus sample; redesign above 10% |
| B P1-16 | Cost estimates low or at the kill line | **Fixed.** C0 sealed expected $200–260 under the $350 line; `wide` $80–150; R-bench hours carried next to dollars; CX3 re-estimated for 2 families ($25–35) |
| B P1-17 | Decision 8's `incident` option cannot happen | **Fixed.** Removed; decision 8 closes C0 dev at `records` and `codefix` |
| B P2-1 | Tags and sample sizes | **Fixed.** The 1.65 s figure is tagged as a prototype floor with a 5 s target; n given for the flags, the runtime share and the UI count (self-scored, [I]); effort tagged [I] |
| B P2-2 | Kev wave 1 is 13 ports | **Fixed.** "13 ports of 42" in the defer table |
| B P2-3 | UI exit test count | **Fixed.** 10 runs (A P2-5) |
| B P2-4 | W11 overgeneralised | **Fixed.** Qualified (about 2% of a P1-sized task) |
| B P2-5 | Point 4 overgeneralises from one release | **Fixed.** Stated for `records` and the 4.5 → 5.5 switch |
| B P2-6 | Swarm evidence tags | **Fixed.** Vendor-reported marked; −70% on sequential planning added |
| B P2-7 | Idea #4 compares measured with documented behaviour | **Fixed.** Labelled "documented behaviour" unless the Claude Code side is run |
| B P2-8 | Parallel status document | **Partly.** This file now calls itself a review artifact; moving the §2 table into README is proposed for the week-0 docs commit. Not done here, because this task may write only into this folder |
| B P2-9 | Defer decisions 6, 7 and 9 | **Fixed.** Moved to "Can wait"; D2 already covers decision 6 |
| B P2-10 | R-bench description pool conflict | **Fixed.** Written descriptions go to translate only, never to rebuild |
| B P2-11 | Add the same-model P1 comparison | **Fixed.** Point 1 and §3.7: the workflow at 0.39× the CPS of a plain Haiku call |
| B P2-12 | P1 numbers moved | **Fixed.** Re-run at 08:44 (242 rows); the P1 REPORT will use final rows and the pre-registered rule only |
| B P2-13 | "A fifth of the way" has no rubric | **Fixed.** Fraction dropped; counts given (A P1-17) |
| B P2-14 | Usage-limit pause should land with the bump | **Fixed.** §7 item 10 is in the engine bump |
| B P2-15 | `codefix` d3 treated as hard | **Fixed.** §3.4 and §3.6 state that B0 agents pass d3 8/8; the executor experiment and coding labels move to d4–d5 or `ownerci` |

**Other changes in this revision, not asked for by either critic.**
- The agentic slice was re-counted at 220 items (critic B counted 225 at 08:31); the shares hold.
- fhand-haiku's one failure also self-reported "pass" [M]; added to point 3 and W6.
- The P1 decision rule is stated as met on partial data, alongside the McNemar p-value that disagrees with the
  bootstrap CI.
- The finding that no independent re-check is recorded on any agentic item [M] is new.
