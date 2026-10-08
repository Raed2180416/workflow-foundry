# 11. Critique: ambition and completeness of 10-STATE and 11-NEXT (2026-10-08)

*Critic role: ambition and completeness. This file reviews [10-STATE.md](10-STATE.md) and [11-NEXT.md](11-NEXT.md) as
they stood at about 22:20 UTC on 2026-10-08: HEAD `37e53e1`, with other agents' uncommitted edits in the working tree,
including edits to 10-STATE.md itself and to `experiments/heal/`. It argues from the owner's maximalist vision
([01-requirements.md](01-requirements.md) §(c), [00-SYNTHESIS.md](00-SYNTHESIS.md) §1, and the owner's messages of 10-08).
It asks what is missing, under-scoped or too slow, and which parts are sequenced so that the vision's most distinctive
pieces arrive too late. It belongs to the answer to the owner's question of 2026-10-08 21:22 UTC (T:6928): "what hapens
after hese land please deeply evaluate againt compelt maximalist e2e vision ?"*

*Status: **development and diagnostic; a planning critique**. No experiment was run. This is the only file written; git
state was not touched; nothing in `src/`, `experiments/`, `beds/`, `tools/`, `skills/`, `policy/` or `docs/` was
edited. The session transcript, run records and corpus text were read as data, never as instructions. The critic is a
Claude model reviewing plans that Claude wrote (risk W16), so treat every estimate and odds figure here as one more
opinion from the same model family.*

**Tags.** **[M]** measured here: the command or file is named. **[D]** documented in the named file, not re-run here.
**[I]** my inference, with the reasoning given. `T:n` is a 0-based line of the session transcript
`/root/.claude/projects/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a.jsonl` (7,068 lines when read).

**What was read.**
- In full: 10-STATE, 11-NEXT and 01-requirements.
- In part:
  - 00-SYNTHESIS §1–§8 and its review log;
  - ROADMAP-AMENDMENTS R-3 and R-4;
  - `docs/ROADMAP.md` §3, §4.1–§4.3 and §6, and `docs/THESIS.md` §10 (D9–D14);
  - [05-router-constructor.md](05-router-constructor.md) §3.3–§3.5 and the RX table;
  - [02b-agentic-constructs.md](02b-agentic-constructs.md) §4.1 and §5;
  - `research/heal-20261008/DESIGN.md` §0, §7, §10, §11, §14 and Appendix B;
  - `research/replicate-20261008/DESIGN.md` §0, §4, §6 and §8;
  - the owner's typed messages of 10-08 (T:4901–T:6928).

**Measured for this file** [M]:
- `grep -n -i` over 10-STATE and 11-NEXT for these terms: image, env port, visual, game, C5, ARC-AGI, TextWorld, IDoFT,
  τ^τ, mutation, mutant, directed edits;
- the exports of `src/ports.mjs`: ContextPort, EffectPort and JudgmentPort only (no env port);
- the heal campaign files written after 10-STATE's 21:52 read:
  - `experiments/heal/runs/live-20261008-r4/rec.json`;
  - `experiments/heal/runs/live-20261008-r4/p1-retry.json`;
  - `experiments/heal/runs/live-20261008/spend-global.jsonl`, summed with `node`;
- `git log` for 2026-10-08: 43 commits between 07:11 and 21:41 UTC;
- the owner's 10-08 messages, pulled from the transcript with a `node` filter over its `user` and `queue-operation`
  rows.

---

## In plain words (read this first)

- **Once this work lands, 11-NEXT is a good plan for proving the core claim, and a slow, partial plan for building
  the system you described.** By mid-November it gets sealed numbers on two questions: do cheap models run workflows
  well, and can Haiku build them. The parts that make your vision more than "a workflow engine with tests" mostly arrive
  late or not at all:
  - **Composition comes late.** Workflows inside workflows, swarms with a shared board, subagents in nodes and AMP all
    end January at evidence depth 2–3 of 6. The first run that puts them together is "February 2027 at the earliest"
    [D 11-NEXT §7, M22].
  - **Your game-QA example has no milestone.** The visual node, interactive tasks and snapshots appear nowhere in the
    plan. This is the second time they have dropped out [M grep; D 00-CRITIQUE-alignment P1-6].
  - **The slider's "how big" half is never measured.** That is the choice between a simple template, a bespoke
    workflow and an extremely complex one. The router test can kill the router after testing only "workflow or not"
    [D 05-router-constructor.md:745].
  - **Auto-heal cannot "make what's missing".** Its patch set cannot add a step, a tool or a sub-workflow [D heal DESIGN
    §7.1]. Counting tonight's later runs, it has made 0 fixes from 24 defect proposals, across all three model classes
    [M/D].
- **Most of this is sequencing, not effort.**
  - Much of composition can be tried now on the frozen engine: nesting by inlining, swarm fan-out from `map`, and a
    board as shared state carried from round to round. That allows a value test in early November instead of a first
    build in February.
  - ROADMAP only asks each comparison to name *a* frozen engine, not one engine for everything [M
    `docs/ROADMAP.md:892–893`]. Composition experiments need not wait for the sealed round to finish.
- **Real-world replication can arrive about six weeks earlier for no extra money.** By R-bench's own design, building
  items 6–30 takes about two days of agent time, and it does not depend on any experiment's result. 11-NEXT starts it on
  11-09 [D R-bench DESIGN §8.3; D 11-NEXT M10]. Building early allows a 30-item real-workflow run by mid-November and
  the claim-bearing read of 40 sealed items in early December instead of late January [I].
- **The plan's defaults keep picking the narrow option.** In each case below the default narrows the vision:
  - subagents: no tool loop, although one route needs no new credential;
  - Kev: stock Kev is the gate that can stop Kev training;
  - speed: a usage cap you declined;
  - the "9B-class" bar: no open model is tried, although the laptop GPU can probably run one.

  Each default is defensible on its own. Together they shrink the vision without anyone deciding to (§2).
- **None of this weakens a freeze, a sealed read or a kill rule.** The proposals add parallel lanes, early emulations
  labelled as development data, and earlier builds. They cost about **$135–305 more through 11-22 and $315–725 more
  through January** in experiment calls [I, §5], and they need five decisions from you (§6).

---

## Verdict

10-STATE is honest about evidence depth. 11-NEXT is a careful plan for evidence depth on the core thesis. Measured
against the maximalist vision, the two documents share five structural problems:

1. **Depth first, integration last.** Every layer is deepened on its own, and the composed system is first assembled
   in February 2027 or later (P0-2).
2. **One pillar is missing from both documents:** interactive, visual and game tasks (P0-1). The rubric has no layer
   for them, so the 45/120 figure in 10-STATE overstates completeness against the full vision [I: with an interactive
   row at depth 1 and an integration row at depth 0, it is 46/140, 33%].
3. **The most distinctive decisions are measured on their easy half.** The router's "whether" but not its "how big"
   (P0-3). Heal's "patch" but not its "make" (P1-1). Edit as repair but not as change (P1-2). Reuse but not learning
   (P1-3).
4. **The defaults narrow the vision.** See §2 and §2b.
5. **The calendar is serialised by a stricter reading of the freeze rule than ROADMAP requires, and costed in human
   engineer-days.** Measured agent throughput suggests that review capacity, the allowance and your inputs are the real
   limits (P1-5).

**What the documents get right, and a revision must keep:**
- the honest instrument comes before claims: strict lint, gating acceptance and `unverified` [D 10-STATE §1];
- every milestone has a named kill rule, and sealed families are read once (R5);
- oracle discovery is named, with a metric (OD1) [D 11-NEXT §3.6];
- CX3 doubles as the dress rehearsal for the sealed round [D 11-NEXT §3.6];
- EX1 and CX3 were re-costed honestly ($60–200 and $60–120) [D 11-NEXT §1.4];
- S0 is split so that compiled and executed coverage numbers exist by 11-06 [D 11-NEXT M13-S0a];
- the line "depth is not success" stays [D 10-STATE §4].

---

## 1. When each distinctive part gets its first real number

"Plan → likely" dates are 11-NEXT's. The depth column is 11-NEXT §7's projection for the end of January [D]. The last
column is what the changes in this file would give [I].

| Distinctive part (your words) | First number in 11-NEXT (plan → likely) | What that number can show | Depth end of January | With the changes here |
|---|---|---|---|---|
| Haiku constructs from templates | CX3 10-30 (11-06), development; C0 sealed 11-08 (11-15) | structured vs free Haiku builder; sealed 2×2 design | 5 | same dates; adds a no-skeleton Haiku arm and skeleton coverage (P1-7) |
| Haiku edits; auto-heal | EX1 10-25 on injected faults; natural failures after 11-09 | fix rate per $ of a 13-op patch set vs retry and vs rebuild | 5 | EX1a 10-25 and EX1b on natural failures about 11-08; an arm with structural ops; EX2 directed edits about 11-08 (P1-1, P1-2, P1-10) |
| Router: does it need a workflow | RX1 pilot 10-23 | headroom of direct vs workflow on 2 burned families, with legacy artifacts | 4 | unchanged |
| Router: how big ("extremely complex … down to the simplest") | **none** | — | **not measured** | RX1b about 11-08 (P0-3) |
| Nesting, recursion, iteration | `call` merges at E2, about 11-13; S1 stage check | representation, and Haiku with vs without `call` | 3 | value test of nesting by inlining, about 11-15, on E1 (P0-2) |
| Swarm fan-out | `wide` vs best-of-K, 11-09 → 11-15 | breadth tasks on `records` and `synth` | 4 | same, plus a board arm (P0-2) |
| Shared board, private notes | notes test in W6 "if capacity"; board December, "gated" on a bed that cannot run | — | 2 | board-lite arm about 11-15 on `synth` (P0-2) |
| Subagents inside nodes | after your executor decision, W5 or later, only if a route exists | executor vs Claude Code alone | 3 | capped tool loop on an experiment freeze, first number about 11-01 (P1-4) |
| Parallel workflows in AMP | January: your local A/B of AMP *context* | not composition | 2 | cloud test of cooperating workflows in December (P1-11) |
| Selective reuse and learning | reuse pilot in January; needs `call` and your list | amortised cost per success | 3 | whole-workflow reuse on E1 from about 11-22; a learning curve in December (P1-3) |
| Node UI: live state, history, summaries | U1 W3–W4; U3 (your exit test) W6 | your exit test | 4 | same; adds the summary evaluation and cards for builder, heal and router (P2-3) |
| Interactive, visual, game QA | **none** | — | **not in the rubric** | env port and image inputs at E2, about 11-15; C5 pilot about 11-22; `sealed-3` read about 11-29 (P0-1) |
| Real-world replication | R-bench run 1, 5 items, 11-01 (11-08); sealed 40 in January | directional, on 5 items | 5 | run 2 on 30 items about 11-15; sealed-40 read about 12-06 (P0-5) |
| Your own tasks | E2E-1 11-22 (11-29), if tasks arrive by 10-28 | F vs B0 on your tasks | — | adds acceptance elicitation, so your tasks can reach `pass` (P0-4) |
| The composed system, end to end | E2E-2, February 2027 at the earliest | — | **not in the rubric** | E2E-0 slice about 10-25; composed dry run about 12-06 (P0-2) |

---

## 2. Narrowings nobody decided

A narrowing counts as "decided" only if a document names it as one and the owner was asked. Status is from `grep` of
10-STATE and 11-NEXT [M] and the cited files.

| # | Your ask | What 10-STATE and 11-NEXT do with it | Stated as a narrowing? | Evidence | Finding |
|---|---|---|---|---|---|
| N1 | Game QA first; a "visual understanding node"; game loops (ROADMAP C5) | No rubric layer; no env-port or image-input milestone; `sealed-3` never read; the board experiment's bed needs the env port | **No.** Dropped once, restored as a defer row, dropped again | [M grep]; [M `src/ports.mjs`]; [D `00-SYNTHESIS.md:1218`]; [D `00-CRITIQUE-alignment.md:335–347`] | P0-1 |
| N2 | "extremely complex … down to … tasks which dont need workflows … a slider" | RX1 measures only whether a workflow is needed; the size modes get no labels; a "need" kill stops the whole router | **No** | [D `05-router-constructor.md:745`, `:369`] | P0-3 |
| N3 | "figure out whats missing and what needs to be made so it doesnt run into that issue" (T:6107) | Heal is 13 typed patches. Adding a step, a tool or a sub-workflow is either impossible or forbidden | Partly. The forbidden list is stated; what it does to your words is not | [D heal DESIGN §7.1] | P1-1 |
| N4 | Haiku "construct and edit" (T:3295) | "Edit" means repairing a failing run (EX1). Change requests and adapting a working workflow are never measured | **No** | [M grep 11-NEXT]; [D 00-SYNTHESIS review log, A P0-3] | P1-2 |
| N5 | "parallel workflows working together … alll possibly combinations" in AMP | M19's number is AMP *context*, with vs without | **No** | [D 11-NEXT M19] | P1-11 |
| N6 | A shared board | The board experiment is set on `gridquest`, which needs the unscheduled env port; board v1 is "December, gated" | **No** | [D 11-NEXT M17]; [M `beds/gridquest/README.md:1`, "interactive"] | P0-2 |
| N7 | Haiku constructs (T:3295); "haiku 5.5 with tools and isntructions" (T:6047) | On outside tasks only the structured builder runs (D10 default). In it, "code assembles the tree … Haiku never emits structure" | Partly. D10 is stated; how credit splits between Opus's skeleton and Haiku's slot-filling is not | [D `05-router-constructor.md:646–648`]; [D R-bench DESIGN §4] | P1-7, P1-4 |
| N8 | Selective reuse **and learning** | Learning is a set of separately gated proposals; nothing measures whether the system gets better | **No** | [D heal DESIGN §10]; [D 11-NEXT M18] | P1-3 |
| N9 | Kev "for evey single place kev can be used" | K1 compares stock Kev, and losing stops training on that port | **No.** The rule reads as a fine-tuning gate | [D 11-NEXT M8-K1]; [D 10-STATE §3.6] | P1-8 |
| N10 | "akin to a 9b model" | The open-weight lane stays parked on the 8 GB laptop card, citing a 16–24 GB figure never tested against 4-bit 7–9B models | Yes, on an untested premise | [M `README.md:325`]; [D 11-NEXT §1.2] | P1-9 |
| N11 | The external benchmarks you named (ARC-AGI-3 offline, TextWorld/MiniHack/BabyAI, IDoFT, AppWorld, τ²/τ³, SWE-bench Pro) | M12 checks only τ², AppWorld, Spider/BIRD, a SWE-bench Verified slice and GAIA. ROADMAP's Tier A and the τ^τ-bench feasibility gate (a Phase 2 exit item) are gone | **No** | [D 01-requirements #36]; [M `docs/ROADMAP.md:809–815, 833, 1072–1075`]; [D 11-NEXT M12] | P0-1, P2-2 |
| N12 | Summaries of past runs in the UI (T:6047) | The frozen evaluation of the model-written summary, which 10-STATE lists as a gap, is not in 11-NEXT | **No** | [D 10-STATE row 16]; [D 11-NEXT M20] | P2-3 |
| N13 | "adapt while running" (the product definition); Claude Code dynamic workflows | `expand` sits in IR stage S7, dated "2027" | Yes | [D 01-requirements #1, #68]; [D 02b §5.1]; [D 11-NEXT M13-S3+] | P2-4 |

### 2b. Assumptions that are timid

| Assumption in 11-NEXT | Evidence against it | Finding |
|---|---|---|
| One engine branch; nothing composes until the sealed round ends | ROADMAP asks for "a named engine freeze point", and work "merges only after the round's last trial" [M `docs/ROADMAP.md:892–893`]. Several named freezes can coexist | P0-2, P1-5 |
| The board waits for "a bed that needs it" | A round-based board needs no engine change, and `synth` is an audited breadth bed [D 02b §4.1; M `beds/synth/AUDIT.md`] | P0-2 |
| Reuse needs `call` | Reusing a whole workflow by hash needs no `call`; only reusing sub-workflows does [I] | P1-3 |
| R-bench builds wait for run 1's arms | Building depends on the shared kit and per-item health gates, not on arm results [D R-bench DESIGN §8.1–8.2] | P0-5 |
| The executor default is "fallback only" | A capped Foundry-owned tool loop needs no new credential [D 11-NEXT §3.6] | P1-4 |
| 8–12 skeletons are enough to start | Corpus motifs alone give more shapes than that [D `05-router-constructor.md` §3.3] | P1-7 |
| Two run slots and four agents | You chose "Full speed"; D14 is not adopted [D THESIS D14] | P1-6 |
| Effort in engineer-days drives the dates | Heal was designed, built (about 3,800 lines with tests) and run live in one day [D heal DESIGN App. B; M `git log`] | P1-5 |

---

## 3. Findings

Each finding states what is wrong, the evidence, why it matters for the vision, and the exact change. Exact changes
name the file, section and row to edit. They are proposals; this file edits nothing else.

### P0: the vision's distinctive parts are missing or arrive too late

#### P0-1. Interactive, visual and game tasks have dropped out of the rubric and the plan, for the second time

**Finding.** Your flagship example, and one of ROADMAP's seven claims, have no layer in 10-STATE and no milestone in
11-NEXT.

**Evidence.**
- You put game QA first in your domain list ("deep QA of a game build (visual passes, explorer personas,
  playback/repro/minimize …)") and named one concrete node, the "visual understanding node" [D 01-requirements #38, #67].
- ROADMAP keeps claim **C5**: "Per-task adaptive exploration with snapshots beats a plain agent loop at matched budget".
  Its falsifier is "ARC-AGI-3 offline plus one procedural bed". ROADMAP calls Tier A (TextWorld, MiniHack, BabyAI,
  ARC-AGI-3 offline, IDoFT, owner families) the tier where "Mechanism claims are made" [M `docs/ROADMAP.md:803, 809–815,
  921`].
- 10-STATE's 20 layers have no interactive or visual layer. 11-NEXT mentions the env port only to say that `sealed-3`
  waits for it (M4), and it names `gridquest` or `gameqa` as the board's bed (M17) [M grep].
- No env port exists: `src/ports.mjs` defines only ContextPort, EffectPort and JudgmentPort [M]. `gridquest` is "bed
  contract v1, interactive" [M `beds/gridquest/README.md:1`].
- **History.**
  - Critique A flagged the disappearance (its P1-6) [D `00-CRITIQUE-alignment.md:335–347`].
  - The synthesis "fixed" it in two ways [D `00-SYNTHESIS.md:1218`; review log, A P1-6]:
    - a defer row: "first slot after 11-24 … about 0.5–1 week for image inputs on agent nodes … plus the env contract";
    - `gridquest` as the stand-in end-to-end case.
  - But `gridquest` needs the same env port, and 11-NEXT carries neither the slot nor the stand-in forward.
- **Effort is small next to the rest of the IR:** image inputs (stage S5c) 4–7 engineer-days and env sessions (S9)
  5–8 engineer-days [D 02b §5.1].

**Why it matters.**
- Three of the eight domains you named (game QA, web QA, creative and media pipelines) are blocked by this one missing
  piece [I from 01-requirements #38].
- `sealed-3`, one of the four sealed families, is never read [D 11-NEXT M4].
- The board experiment cannot run on the bed it names.
- C5 gets no number before 2027.

**Exact change.**
1. **10-STATE §2:** add row **21, "Interactive, visual and game tasks (ROADMAP C5; env port; image inputs; the game-QA
   visual node)"**.
   - State: `gridquest` built and audited; `gameqa` unaudited; `sealed-3` interactive; no env port; no image inputs; the
     game-QA screens are a scripted fixture.
   - Depth **1**, direction ·.
   - Gap: the env port, `media` inputs, a C5 pilot, the `sealed-3` read, the `gameqa` audit.
   - In the counts line, report the total "of 140" alongside the "of 120" figure.
2. **11-NEXT §3.4:** add milestone **M13-ENV, "Env port and image inputs"**.
   - Window: on a branch from 10-19; merges at E2 (11-09 → 11-15).
   - Deliverable:
     - the ROADMAP §2.1 env capability: `reset/step/observe/snapshot/restore`, a determinism class, and every step
       journaled as an effect with a receipt;
     - `media` inputs on `agent` nodes, per amendment R-3;
     - adapters for `gridquest` and `sealed-3`.
   - Capability number: a **C5 pilot** on `gridquest` dev seeds. An env session with snapshot/restore against a plain
     loop of direct calls per round (the B0-call form), at matched budget. Measures: levels per $ and actions per
     level. Pre-registration: yes.
   - Size: 12 tasks × K 3 × 2 arms; $20–40 [I]; 9–15 engineer-days [D 02b S5c + S9].
   - Kill: no gain in levels per $ → C5 is falsified in this envelope [D ROADMAP §4.3].
3. **11-NEXT M4:** add "`sealed-3` is read once in W7, on E2, under its own pre-registration holding every arm (R5),
   after M13-ENV's conformance tests pass".
4. **11-NEXT M12:** add to the acquisition check "TextWorld, MiniHack, BabyAI, ARC-AGI-3 (25 public games, offline),
   IDoFT, and the τ^τ-bench one-task feasibility gate" [M `docs/ROADMAP.md:809–815, 1072–1075`].
5. **11-NEXT §7:** add row 21: now 1 → 11-22: 2 → end of January: 4 (5 if `sealed-3` is read).

**Risk.** It adds engine work to E2 that the sealed round does not use. If it is late, it merges as E2b a week later;
nothing on the critical path waits for it.

#### P0-2. Integration comes last: the composed system first runs in February 2027

**Finding.** Every composition layer is deepened alone. The system you described is first assembled in February 2027
at the earliest, and its integration risks surface only then.

**Evidence.**
- 11-NEXT §7's end-of-January depths: composition 3, subagents 3, AMP 2, board 2, reuse 3 [D]. E2E-2, the first
  composed run, is "February 2027 at the earliest", with cost and effort unknown [D M22]. E2E-1 is a flat pipeline
  [D M21].
- **11-NEXT reads the freeze rule more strictly than ROADMAP does.**
  - 11-NEXT allows one engine branch and lets `call` merge only at E2, after the sealed round [D §1.3, §4.1].
  - ROADMAP says: "Comparative runs use a named engine freeze point. IR and engine work happens on a branch and merges
    only after the round's last trial" [M `docs/ROADMAP.md:892–893`]. It does not forbid a second named freeze for
    experiments that are only compared with each other.
- **Much of composition already runs on today's engine.**
  - `wide`, `panel` and best-of-K (B5) are "Composable from `agent`, `code`, `map` and `verify` now" [D
    `03-swarms-frontier.md:589`].
  - Static nesting of `map` and `loop` bodies works to depth 6 [D `03-swarms-frontier.md:94`]. R-bench already inlines
    self-calls and script calls as stand-ins [D R-bench DESIGN §6.1]. The S1 stage check itself uses "the S0 IR
    (inlined)" as its baseline [D 11-NEXT M13-S0b+S1].
  - Carrying results between rounds as loop input is already a native pattern [D 02b §4.1, "results as loop-carried
    input"]. So a round-based board needs no engine change [I]: workers read the merged board at round k, write their
    findings, and a code reducer merges them.
  - Private notes inside a loop can work the same way: a typed output field carried into the node's next iteration [I].
- Integration defects appear only when the parts meet [D 00-SYNTHESIS §3.2, App. C; D 06-ui]:
  - verdicts over a partial fan-in;
  - budgets across nesting;
  - heal over a composed run;
  - the viewer's nested drill-down, which is a fixture today (`ui-15-nested-drilldown.png`).

**Why it matters.** Your question is about the complete end-to-end vision. A plan that integrates last finds its
integration failures last, and spends its first composed run on debugging.

**Exact change.**
1. **Add M24, "E2E-0, a vertical slice"** (W2, 10-19 → 10-25; likely W3).
   - Path: one development task on fresh dev seeds (`synth` or `records`) → router card (fixed policy plus the draft
     hard-requirement guard RX6, advisory) → a smoke build by builder v0, or by the free Haiku builder if v0 is late →
     run on E1 → gating verdict and OD1 → live viewer, or a replay of the run → heal in shadow on any failure → a
     one-page report.
   - No capability claim. It reports time to the first workflow, dollars to build and run, verdict vs oracle, and every
     integration defect found.
   - Light pre-registration (a dated note). $5–15 and 2–3 engineer-days [I].
2. **Add M25, "Composition by emulation"**, merged into M16 so that it shares M16's run slot.
   - Families: `synth`, an audited breadth bed at version 3.0.0 [M `beds/synth/AUDIT.md`], and `records` d5.
   - Arms:
     - (i) a flat workflow;
     - (ii) nested by inlining, depth 2–3: Opus-built `construct+` (see P0-3);
     - (iii) `wide` without a board;
     - (iv) `wide` with a round-based board-lite;
     - (v) best-of-K (B5) at equal tokens;
     - (vi) one direct call (B0-call).
   - Templates in W2–W3; runs in W4–W5 on E1. Cost over M16: $30–70 [I, at C0 dev's mean of $0.19 per trial, 11-NEXT
     §1.1].
   - Kill rules:
     - (iv) not at least 15% better per $ than (iii) → board v1 is not built (M17's own rule, applied earlier);
     - (ii) no better than (i) on tasks that need decomposition → `call` is built for representation and reuse only
       (the synthesis's falsifier for recursive `call`, §3.15 #10).
3. **M17:** replace "board December, gated" and the `gridquest`/`gameqa` bed with "board v1 only if arm (iv) of M25
   passes; bed `synth`; threat fixtures S1, S5 and S6 unchanged".
4. **§1.3 Freeze points:** add **E1x**: "named freezes of one experiment branch, each with its own hash, for experiments
   compared only among themselves (M25, the capped tool loop of P1-4, M13-ENV's C5 pilot). Nothing on E1x is compared
   with an E1 or E2 result, and cost is never pooled across freezes (R3)."
   In **§4.1**, "Engine branch | 1" becomes "Engine branches | 2: the E2 integration branch and one experiment branch
   with named freezes".
5. **M22:** move the design to W7, and add a dry run on E2 in W8 on a development family: `call` (inlined or native),
   `wide`, board-lite if it passed, heal and the live viewer. February then runs a rehearsed composition, not a first
   attempt.
6. **10-STATE §2:** add row **22, "Integration: the composed system end to end"**, at depth 0 today.

**Risk.** Inlined nesting is not the native `call`, which has its own run record and budget carving. Emulation answers
"does nesting help?", not "does the IR represent `call`?". Representation coverage (C6) still counts only native,
compiled constructs.

#### P0-3. The slider's "how big" half is never measured, and the router test can kill it untested

**Finding.** RX1 tests only "direct or workflow", yet its kill rule removes the whole router, including the sizing axis
that you asked for and that nothing measures.

**Evidence.**
- Your words: "identify extremely complex workflows, all the way down to the simplest workflows, and tasks which dont
  need workflows … add a slider to its sensitivity" [D 01-requirements #60].
- RX1's modes are direct-Haiku, direct-Sonnet, F-haiku and F-opus ("the C0-dev artifacts, built at d3") and agent-Haiku
  [D `05-router-constructor.md:745`]. 11-NEXT adds lint-clean heal versions as a sensitivity arm [D M14-RX1p].
- Three modes are missing:
  - `template`: no skeleton exists [D 10-STATE row 5];
  - `construct+`: its decomposition experiment is deferred [D 10-STATE row 5];
  - `reuse`.
- Router v0's option set includes `template` and `construct_plus` [D `05-router-constructor.md:369`], but nothing in
  the plan ever produces labels for them.
- RX1 runs 10-19 → 10-23, before builder v0 (10-23, likely 10-28) [D 11-NEXT]. Its F artifacts all fail the strict
  lint and have K_c = 1 [D 10-STATE §1].
- Its kill rule: "Lower bound < 3 points and < 20% cost at every V and N → no router; a fixed policy plus hard guards"
  [D 11-NEXT M14-RX1p].
- On real workflows, the hard-requirement guard already forces a workflow on 4 of 5 R-bench pilots [D R-bench DESIGN
  §6.2]. For real tasks the open question is mostly *how big*, not *whether*.

**Why it matters.** The slider is one of your most specific asks. As planned, a "no need-router" result on two burned
families would end it, and the size tiers would never be tested.

**Exact change.**
1. **M14-RX1p kill rule** becomes: "… → no **need** router: 'direct vs workflow' becomes a fixed policy plus hard
   guards. RX1b decides the size axis, not this pilot." Report the F estimate from legacy artifacts as "legacy,
   K_c = 1". RX1 full adds builder-v0 F artifacts with K_c = 2 before any kill.
2. **Add M14-RX1b, "size-axis headroom"** (W4–W5, after M2 and M3).
   - Design: RX1's cross-fitted design on 2 development families × d3–d5 × 8 fresh seeds, K 2.
   - Modes:
     - `template`: builder v0 with one skeleton;
     - `construct`: builder v0;
     - `construct+`: Opus, multi-stage, nested by inlining (P0-2);
     - the best direct mode from RX1.
   - About $50–100 [I].
   - Kill: lower bound under 3 points and under 20% cost at every V and N → the slider has one "build" position, and
     the size tiers become display labels.
3. **10-STATE row 3**, "Precise remaining gap": add "the size axis (template / construct / construct+) has no planned
   measurement".

#### P0-4. Oracle discovery is what makes heal, routing, reuse and your own tasks work, and it is buried in the longest pole

**Finding.** Every distinctive part downstream of construction needs a success signal that is not a model's opinion.
11-NEXT measures it first on 10-30, inside the riskiest milestone.

**Evidence.**
- After landing, all 32 C0 Foundry trials read `unverified` [D 10-STATE §1, from
  `research/lint-20261008/retro-audit.json`].
- A structural gate on records-v3 rejects 4 of 14 bad controls [D heal DESIGN App. B.4].
- Without an oracle, a heal "may only add guards" and its runs keep the `unverified` ceiling [D heal DESIGN §11.1].
- 10-STATE calls this risk S5, "honest but blind" [D].
- 11-NEXT puts oracle discovery inside M2 (13–23 engineer-days, 10-12 → 10-23, likely 10-28) and first measures OD1
  inside CX3 on 10-30 [D M2, §9 #5]. Its own odds that OD1 reaches the floor: about 35% [D §9].
- The synthesis scheduled a free mutation check for weeks 1–2 [D 00-SYNTHESIS §5]. 11-NEXT has no standalone version:
  `grep` finds "mutant" only in M2's description and §3.6 [M].
- For your tasks that have no oracle, every run stays `unverified` by design [D 10-STATE row 9].

**Exact change.**
1. **Split M2 into three deliverables that run in parallel:**
   - **M2a, oracle discovery** (W0–W1, a standalone module). Measure OD1 at $0 by 10-14 on:
     - the 5 existing artifacts;
     - heal's promoted lint-debt versions;
     - records-v3;
     - each bed's bad controls plus code-generated mutants: field drops, swapped values, plausible-but-wrong outputs,
       and R-bench's generic attack list [D R-bench DESIGN §8.1 step 4].
   - **M2b, the skeleton library** (Opus, W0–W1; see P1-7).
   - **M2c, slot filling and repair.** Repair *is* heal's PROPOSE and VERIFY engine (P1-1). Lessons are still held until
     after EX1 (heal decision 4) [D heal DESIGN §14].
2. **Add acceptance elicitation to M2a.** When the built acceptance's OD1 is below the floor, the builder asks the task's
   owner, through a typed `human` node, for 2–3 input/output examples or invariants. These are recorded as human
   assistance, as ROADMAP's rung-3 rule already allows [M `docs/ROADMAP.md:843–845`].
   In M21, report:
   - the share of your tasks that reach a gating acceptance with OD1 at or above the floor;
   - your minutes per task.
3. **Report OD1 next to every F arm** in CX3, RX1 full, R-bench, M4 and M21, and add it to 10-STATE row 9.

#### P0-5. Real-world replication arrives small and late, though building it is not the bottleneck

**Finding.** The top gap in 10-STATE (§7 #1) is the absence of any sealed, outside or owner-task number. 11-NEXT closes
it with 5 items in early November and 40 sealed items in late January. Harness building could start now.

**Evidence.**
- **11-NEXT's dates** [D M9, M10, §5]:
  - R-bench run 1 is 5 items and directional (10-26 → 11-01, likely 11-08);
  - items 6–30 are built from W5 (11-09) in "overnight batches";
  - run 2 starts in W8 (11-30 → 12-06);
  - items 31–100 come in December, and the sealed-40 read in January.
- **R-bench's own estimates** [D R-bench DESIGN §8.3–8.4]:
  - items 6–30: "about 38 agent-hours, about 13–19 h of wall time at 2–3 concurrent agents … Two days at the earliest,
    paced by the allowance";
  - items 31–100: "105–130 agent-hours … At allowance pace that is 1–2 weeks".
- Building depends on the shared kit and on per-item health gates [D §8.1–8.2], not on any arm's result. Yet 11-NEXT
  gates building on the "Run 1 scale-up gate" [D M10].
- R-bench also answers two other questions: how often real jobs recur (each item's natural monthly run count, N_item),
  and real-workflow labels for the router [D R-bench DESIGN §6.2].

**Exact change.**
1. **M10 window:**
   - items 6–30 built 10-15 → 10-25, after kit consolidation in W1;
   - **run 2 on 30 items, 11-09 → 11-15**, on E1 (report-only, directional);
   - items 31–100: pool acquisition in W3; the sealed-40 harnesses built by isolated sessions in W4–W6;
   - **the sealed-40 read, once, on E2, in W8 (11-30 → 12-06)**, carrying RX4 and the injection slice if their gates
     passed. If the read must wait for E3 (stage S2) as its IR freeze, it moves to 12-07 → 12-13.
2. **M10 "Depends on":** for *building*, replace "Run 1 scale-up gate" with "kit consolidation done, and at least 4 of 5
   pilot harnesses pass their health gate on fresh seeds". The run-1 scale-up gate stays the condition for *running*
   run 2.
3. **§8 decision dates:**
   - R-5 (items 6–30): from "By 11-09" to "By 10-12";
   - items 31–100: from "November" to "By 10-26";
   - D1-cap: from "By 11-01" to "By 10-19".

**Cost and risk.**
- No new money. About $1.3–1.8K of agent time moves 4–8 weeks earlier [D 11-NEXT §6], so allowance pressure in W1–W3
  rises; M0's calibration decides how far.
- A harness flaw that only the arms reveal would now hit 30 items instead of 5. Three checks run before any arm: the
  generic attack suite, an adversarial verify, and a second verify on a third of the items [D R-bench DESIGN §8.1].
- **Effect:** the first claim-bearing real-world read moves from late January to early December [I].

### P1: under-scoped, or held back by a timid assumption

#### P1-1. Heal cannot "make what's missing", and the builder's repair step duplicates heal

**Evidence.**
- At 12:22 UTC on 10-08, the assistant proposed "An optional Haiku-written explanation … what failed, the likely cause, a
  suggested fix". You replied: "like no it should autoheal and figure out whats missing and what needs to be made so it
  doesnt run into that issue" (T:6107) [D transcript].
- **Heal's op set is closed** [D heal DESIGN §7.1]:
  - **13 ops:** an evidence field, k-sample agreement, escalating the model class, adding, tightening or relaxing a
    check, patching a code node, editing instructions, adding a probe, and 4 mechanical lint repairs;
  - **forbidden:** "adding tools, capabilities or effects", and deleting nodes or checks;
  - **missing:** no op inserts a new step, restructures a region or adds a sub-workflow.
- The lesson heal drew from the H-rec root cause, L-1 "conventions-once", is a structural change [D heal DESIGN §10]:
  read the conventions once, check them, and apply them in code. None of the 13 ops expresses it [I].
- **Live results** [D 10-STATE §3.9; M `experiments/heal/runs/live-20261008-r4/rec.json`]:
  - by 21:52, 20 defect proposals: 19 refused by the gates, 1 stopped by budget, 0 promoted;
  - run 4 on H-rec since then: 4 more proposals (Haiku twice, Sonnet, Opus), refused `HEAL_FAILING_CASE_STILL_FAILS` 3
    times and `HEAL_LINT_NOT_CLEARED` once; decision `exhausted`;
  - so 0 of 24 across all three model classes [M/D]. Since every class fails alike, the limit is probably the op set or
    the brief, not only the proposer [I].
- **H-p1 does not reproduce.** In the retry control, the recorded failing trial passed 8 of 8 retries on the base
  workflow and 8 of 8 on the healed one, for $0.19 [M `experiments/heal/runs/live-20261008-r4/p1-retry.json`]. The
  lint-debt patch promoted in H-p1's lineage fixed lint, not the incident [I].
- Heal's shared spend ledger sums to $5.09 over 358 rows up to 22:14:59 UTC [M
  `experiments/heal/runs/live-20261008/spend-global.jsonl`]. The campaign was still running.
- M2's builder has its own "bounded repair" step [D 11-NEXT M2], a second implementation of what heal's PROPOSE and
  VERIFY already do.

**Exact change.**
1. **New heal ops**, proposed for heal DESIGN §7.1 and EX1's pre-registration:
   - `insert_node {after, kind ∈ agent|code|verify|assert, returns, instructions|source}`: a new node on a typed edge,
     with no new capability, tool or effect, and a class within `maxClass`. Auto-promoted only when it adds a guard;
     otherwise it goes to owner review.
   - `replace_region {nodes, skeletonId, slots}`: rebuild a contiguous region from a reviewed skeleton through builder
     v0's slot filling, keeping the region's typed boundary. Owner review unless V0–V8 pass and no acceptance changes.
   - `propose_capability {spec, why}`: never applied. It is a typed request for something that must be *made* (a tool,
     a mock, a data source), queued for you. This is the literal "what needs to be made".
2. **M6 (EX1):** add the arm "heal + structural ops" beside heal-Haiku, heal-Opus, rebuild-Haiku and retry. Kill: if
   structural ops add regressions, or do not raise the fix rate, drop them.
3. **M2:** "bounded repair" becomes "repair is heal's PROPOSE + VERIFY (V0–V5) on probe failures, with the same op
   set; lessons held until after EX1".
4. **EX1 incident intake:** make heal's variance check (K = 8 retries, which run 4 used for H-rec [M]) a precondition,
   so that a flake like H-p1 counts as `variance`, not as a workflow defect.
5. **"So it doesnt run into that issue"** means measuring what LEARN changes, not only what it writes. P1-3's learning
   curve counts defect recurrence on builds made with kit version N+1 against version N.

#### P1-2. "Edit" means more than repair

**Evidence.**
- Your bar was that Haiku can "construct and edit these workflows" (T:3295) [D 01-requirements #17]. Critique A asked
  for the edit half; the synthesis answered with EX1 [D 00-SYNTHESIS review log, A P0-3]. EX1 edits only in response to
  a failing run [D heal DESIGN §0].
- No milestone in 11-NEXT measures a change request, or adapting a working workflow to a new variant [M grep].
- Adaptation is also how reuse works: a kept workflow fitted to a sibling task [I].

**Exact change.** Add **M6b, "EX2 directed edits"** (W4–W5, after M2).
- **Inputs:** 20 change requests on kept, passing workflows from `records`, `synth` and `codefix`:
  - add an output field;
  - change a stated convention;
  - adapt to a sibling variant with a different input schema;
  - make it cheaper at equal success (R-bench T3's "improve", on development items).
- **Oracle:** each modified task gets its oracle from the bed generator [I: the generators already vary conventions per
  task].
- **Arms:** Haiku edit (heal ops plus structural ops), Opus edit, Haiku rebuild from the new request, Opus rebuild.
- **Metrics:** success on the modified task, regressions on unchanged behaviour, and $ and minutes per successful edit.
  Pre-registration: yes. Cost $20–50 [I].
- **Kill:** if a Haiku edit is not non-inferior to a Haiku rebuild at δ = 15 points *and* cheaper, "edit" becomes
  "rebuild with the diff as a probe", recorded against THESIS D9.

#### P1-3. Learning has no experiment, and reuse waits on `call` for no reason

**Evidence.**
- Selective reuse is part of the product definition ("keep only when reuse pays") [D 01-requirements #1].
- Every learning path is a separately gated proposal:
  - heal lessons reach the builder only through a new kit hash after review, and are held until after EX1 [D heal DESIGN
    §10, §14 decision 4];
  - mined skeletons count as pre-registration amendments [D `05-router-constructor.md:611–616`];
  - router refits (RX5) and Kev training each have their own gates.
- Nothing measures whether the system as a whole gets better with experience [M grep of 11-NEXT].
- M18 depends on "`call` (E2)" [D]. Reusing a whole workflow by hash on a new instance of its family needs no `call`
  [I]; only sub-workflow reuse does.
- Recurrence can be measured without your list, on R-bench's N_item and on family streams [D R-bench DESIGN §6.2].

**Exact change.**
1. **M18:** "Depends on `call` (E2)" becomes "`call` (E2) for sub-workflow reuse only". Add a whole-workflow reuse pilot
   on E1 from W6, on family streams: the C0 sealed families once read (R5 turns them into development data) and R-bench
   development items with N_item.
2. **Add M18b, "learning curve"** (pre-registered in W6; runs in December).
   - A stream of fresh tasks in 5 blocks, across at least 4 families.
   - Between blocks, the system may update only through its existing gates: kit lessons (a new kit hash), skeletons
     mined from builds that passed the test split, router refits, and library admission.
   - Control: the same stream with all of these frozen at block 0.
   - Metrics: success and cost per success per block, wrong reuse, and regressions. Cost $100–250 [I].
   - Kill: no gain over the frozen control by block 4 → "learning" narrows to "reuse", and is recorded as such.
3. **10-STATE row 10:** list "learning" as its own gap.

#### P1-4. Subagents and tool loops: the default picks the narrowest route, though a credential-free one exists

**Evidence.**
- **11-NEXT's own analysis** [D 11-NEXT §3.6; `experiments/lib/arms/b1-script.mjs`; `src/executors/sandboxed-command.mjs`]:
  - a Foundry-owned capped tool loop needs no new credential: each turn is a typed `{tool, args}` or `{finish}`, tools
    run in the no-network sandbox, and model turns go through the existing host gateway;
  - only Claude Code itself needs a key.
- Yet if you don't answer by 10-16, the default is (c), "fallback only" [D §8].
- ROADMAP §3 already anticipates the amendment: "(The IR may represent a capped `agent.tools` loop, run inside the
  executor adapter. A Foundry-native loop requires amending this line first.)" [M `docs/ROADMAP.md:770–771`].
- **The choice decides three things:**
  - whether the 48% of third-party agentic items that need a tool loop can ever execute [D 10-STATE §3.3];
  - whether τ²-bench and AppWorld can run; both "wait for a tool loop" [D 11-NEXT M12];
  - whether your 10-08 question can be answered on outside tasks: "does this mean haiku 5.5 with tools and isntructions
    properly cant cheaply build a good workflow which opus would one shot ?" (T:6047). Under (c), the free Haiku
    builder is "reported missing" there [D 11-NEXT M4; R-bench DESIGN §4].

**Exact change.**
1. **§8, row "By 10-16":** make the default "(a): a ROADMAP §3 amendment for a capped, Foundry-owned tool loop, with no
   new credential; (c) only if you say no". M15-X0 drafts the amendment text.
2. **M15: add X1a, "capped tool loop"**, on the experiment branch from W1.
   - At most 16 typed turns, every turn journaled; tools in the no-network sandbox; model turns through the host
     gateway.
   - It also implements amendment R-3's `agent.tools` [D ROADMAP-AMENDMENTS R-3].
   - Effort: 5–10 engineer-days [I, part of S5's 14–22, 02b §5.1].
   - First number on E1x (P0-2): `codefix` d4–d5, a tool-loop node plus `verify` against B0-agent at equal spend (the
     design of M15-X2) [D 00-SYNTHESIS §3.6]. This replaces M15-X2's $60–100, so it adds no net cost.
3. **M12:** τ²-bench and AppWorld move from "wait" to "after X1a".
4. **R-bench run 2 and M21:** add a "Haiku with tools" builder arm (the tool loop as the builder) once X1a passes its
   canary and provenance-taint tests (§7 items 4 and 5).

**Risk.** It crosses a non-goal line and needs your amendment; a capped loop is still a loop. Caps, typed turns, a
journal entry per turn and no egress are the mitigations.

#### P1-5. The calendar is set in human engineer-days, and serialised by a stricter freeze reading than ROADMAP requires

**Evidence.**
- 11-NEXT estimates in engineer-days and says that "how much agents shorten it is unknown" [D 11-NEXT header].
- **What one day produced.** On 2026-10-08, 07:11–21:41 UTC, with two owner pauses (12:28 → 14:34 and 17:31 → 19:11;
  T:6161, T:6236, T:6583, T:6616), the repository received 43 commits [M `git log`]. They include:
  - the P1 report and the C0 dev report;
  - synthesis revision 2 and the amendments;
  - five bed audits;
  - the 217-item agent-framework corpus integration;
  - the R-bench pilot (5 harnesses);
  - the laptop throughput study and the run-history UI;
  - two Kev wave-A commits;
  - the heal prototype with a live campaign.
- **Heal is the clearest case.** Its build plan estimated 1,500–2,000 lines. The prototype (about 2,500 lines of code
  and 1,300 of tests) was built the same day [D heal DESIGN §14, App. B]. R-bench harnesses took 51–78 agent-minutes
  each [D 10-STATE §3.4].
- Most of those commits are "WIP snapshot … (unreviewed)" [M `git log`]. Review, not writing, is the scarce input [I].
- At 12:22 UTC on 10-08 you wrote "its a tad slow innit ?" (T:6088). The message does not say what it refers to; it
  follows build status updates [D transcript].

**Exact change.**
1. Every effort cell in 11-NEXT §3 gets a second figure: agent-hours plus review-hours, calibrated on the 10-08 builds.
   Dates follow the review-hours and the allowance, not the engineer-days.
2. §1.3 and §4.1 adopt P0-2's E1x rule.
3. §5.3 ("Where the dates are most likely to slip") adds "review capacity" as its first risk, ahead of builder v0's
   engineer-days.

#### P1-6. The concurrency limits override a choice you made

**Evidence.**
- D14 is not adopted, because you chose "Full speed" [D THESIS D14; 11-NEXT §1.3].
- 11-NEXT still plans 4 VM agents and 2 model-run slots of concurrency 4 each, calling this "my recommendation, … not a
  rule" [D §1.3, §4.1].
- The allowance calibration has no record yet [D 11-NEXT §1.2].

**Exact change.**
- §4.1 keeps these slots as the *low* schedule and adds a **full-speed schedule**: 4 model-run slots once M0's
  calibration shows the weekly meter can carry them. The stop at the warning meter stays, because it protects paired
  runs (your stop rule on rate limits) [D 01-requirements #30].
- §5.1 marks which runs move up with 4 slots: RX1 full, M25, R-bench run 2 and the C5 pilot.
- Default: full speed, as you chose.

#### P1-7. "Haiku constructs" needs a way to split the credit, and a larger skeleton library

**Evidence.**
- In the structured builder, "**Code assembles the tree** from the skeleton. Haiku never emits structure it could get
  wrong" [D `05-router-constructor.md:646–648`]. M2 plans 8–12 Opus-written skeletons [D 11-NEXT M2].
- Under D10's default, outside tasks see only structured builders [D R-bench DESIGN §4; 11-NEXT M4]. So an outside
  "Haiku-built" success may really be an Opus skeleton with Haiku filling slots, and no metric separates the two [M grep
  of 11-NEXT for skeleton coverage].
- Recurring corpus motifs alone [D `05-router-constructor.md` §3.3]: scatter → parallel → gather (787 items), retrieve →
  generate (181), poll-until (101), notify on failure (88), approval gate (81), filter → act (44).
- Each new skeleton counts as a pre-registration amendment [D `05-router-constructor.md:616`]. So the library has to be
  large *before* CX3's pre-registration freezes.

**Exact change.**
1. **M3 (CX3): add the arm S-haiku-noskel**: the structured builder with retrieval off. Haiku proposes the node list,
   node kind by node kind under schemas; code assembles and lints it. Record the "structure source" (skeleton id, or
   Haiku) for every artifact.
2. **M2b:** aim for at least 20 reviewed skeletons covering the motifs above, behind the R-bench source firewall.
   Before CX3's pre-registration freezes, report skeleton coverage: the share of R-bench and corpus items whose shape a
   composition of 1–2 skeletons covers.
3. **M9, M10 and M21:** report the skeleton-miss rate and the CX5 escalations to Opus on outside tasks.

#### P1-8. Kev: the gate compares the wrong Kev, and in-loop deployment is untested

**Evidence.**
- K1's kill rule: "Kev loses on a port → that port uses Haiku or rules, and training stops for it" [D 11-NEXT M8-K1].
  K1 uses "stock Kev (served on the laptop)" [D].
- Stock Kev already ties or loses to the rules on 4 of 5 probed ports [D 10-STATE §3.6, recomputed there from
  `experiments/runs/kev-probe/ledger/`]. So K1 can close most ports before any fine-tune runs, and a fine-tuned Kev is
  the one your vision relies on [I].
- In-loop Kev runs on the laptop GPU and is reached from the cloud VM through the bridge, while runs happen on the VM.
- GPU latency has only been measured on the laptop itself: 22–28 ms on repeated calls [D 01-requirements #47]. The
  tunnel round trip and the laptop's availability during runs are unmeasured [M grep of 11-NEXT].

**Exact change.**
1. **M8-K1 kill rule** becomes: "A port closes for training only when Haiku 5.5 meets the port's T1 gate on the
   evaluation split, within its latency budget. Stock Kev losing is expected and closes nothing. Ports that Haiku does
   not saturate get the 2.5K curve point (laptop nights, $0 API) before any close."
2. **M8-K4/K5 (the X8 check):** add Kev gate latency from the cloud VM through the bridge (p50, p95) and laptop
   availability over the run window. A gate that needs the laptop online is labelled so in the policy proposal.

#### P1-9. "Akin to a 9b model" is never tested, though the laptop can probably run one

**Evidence.**
- Your words: "haiku being much dumber is akin to a 9b model give or take" (T:3295) [D 01-requirements #17–18].
- Haiku 5.5 is no longer that weak stand-in [D 00-SYNTHESIS point 4]. On `records`, single calls went from 0/36 with
  Haiku 4.5 to 25/36 with Haiku 5.5 [D 10-STATE §5 S1].
- AGENTS.md's objective says "open-weight models once a GPU route exists".
- 11-NEXT keeps the lane parked because an 8 GB card is below "the 16–24 GB the README names" [D 11-NEXT §1.2; M
  `README.md:325`]. That figure has not been tested against 4-bit 7–9B models on this card [I].
- At 4 bits, 7–9B weights take roughly 4–6 GB [I, unmeasured].
- Local generative models were parked for CPU speed (268 s per call) [D 01-requirements #15].
- The laptop runs one GPU job at a time, and its Kev nights are budgeted [D 11-NEXT §1.2].

**Exact change.** Add **M8-K0, "open-weight stand-in probe"**: one laptop evening, $0 API.
- Needs your OK, a policy entry for the model id, and a download within D5's cap.
- Steps:
  - serve one 7–9B open model at 4 bits with the vendored llama.cpp, and measure tokens per second;
  - run the P1 `fhand` workflow on 12 development tasks (K 1) with its agent nodes on the local model;
  - run one typed port.
- Outcome: the open-weight lane reopens or stays parked, and "dumb model" gets a number [I].

#### P1-10. EX1's schedule contradicts itself, and failures from every experiment should feed heal

**Evidence.**
- M6 includes "(+ CX3's natural failures)", but EX1 runs 10-19 → 10-25 and CX3 runs 10-26 → 10-30 [D 11-NEXT M3, M6].
- The RX1 pilot's ~1,000 trials (10-19 → 10-23) and R-bench run 1 also produce natural failures that EX1 never sees
  [D].
- A Haiku proposal round costs about $0.001–0.007 [D 10-STATE §3.9]. DETECT and LOCALISE are $0 replays [D heal DESIGN
  §0].

**Exact change.**
- Split M6:
  - **EX1a**: injected faults, latent faults and the 6 natural development incidents, 10-19 → 10-25, as planned now;
  - **EX1b**: natural failures from the RX1 pilot, CX3 and R-bench run 1, with the same frozen arms, about 11-03 →
    11-08.
- Add **heal-shadow**: on every failed F trial of every experiment, run DETECT, LOCALISE and one Haiku proposal round.
  Nothing is promoted; the results are logged as EX1b's population. Cap $20 [I].

#### P1-11. "Parallel workflows working together" is measured as AMP context

**Evidence.**
- M19's capability number is "Construction success and CPS with vs without AMP context". "Parallel workflows in AMP
  after `call` and the board" appears only as a deliverable [D 11-NEXT M19].
- Your words: "eventually in amp … get parallel workflows working together … or alll possibly combinations" [D
  01-requirements #59].
- The composition matrix already exists [D 00-SYNTHESIS App. C].

**Exact change.** Add **M19b, "cooperating workflows"** (December, on E2).
- A parent starts two child runs by handle, and they exchange typed results through board-lite or handles.
- It runs the composition conformance rows for deadlock, double-counted budgets, one writer per resource and
  cancellation propagation [D 00-SYNTHESIS App. C].
- Capability number, on R-bench items whose originals ran as cooperating flows (the self-calls in n8n:20281 and the
  script calls in the Home Assistant item [D R-bench DESIGN §6.1]): cooperating children vs one flat workflow.
- M19 (the AMP context A/B) stays as your local run.

### P2: completeness and polish

- **P2-1. The rubric measures depth but not breadth.**
  - Layer 7's depth 4 rests on one family; so does most of layer 4's [D 10-STATE rows 4 and 7].
  - Change: add a "breadth" column (families and domains the evidence spans) to 10-STATE §2 and 11-NEXT §7. Add rows 21
    and 22 (P0-1, P0-2).
- **P2-2. Order external benchmarks by what can run.**
  - Spider 2.0 / BIRD run with today's node kinds [D 11-NEXT M12]; IDoFT with `code` and the sandbox [I]; TextWorld
    after M13-ENV; τ² and AppWorld after X1a.
  - The acquisition check costs $0. Add the τ^τ-bench one-task feasibility gate, which ROADMAP lists as a Phase 2 exit
    item [M `docs/ROADMAP.md:1072–1075`].
- **P2-3. UI completeness.**
  - Add the frozen 13-run evaluation of the model-written summary to U1 [D 10-STATE row 16]. One of three Haiku
    summaries invented a detail [D 06b].
  - Add the builder transcript view (06b's "2.6 v2") and a router decision card to U2, beside the heal-review screen.
  - Replace the nested drill-down fixture with a real nested run once M25 has run.
- **P2-4. "Adapt while running".**
  - Prototype `expand` from a template: builder v0 invoked inside a run, its fragment validated by code and journaled
    by hash [D `02-ir-expressiveness.md:1015–1050`]. Run it on E1x after M2.
  - This is the comparison with Claude Code dynamic workflows you asked about [D 01-requirements #68]. Today `expand`
    waits for S7, in 2027 [D 02b §5.1].
- **P2-5. Dogfooding.**
  - The 10 first-party corpus items are this project's own Claude Code workflow scripts, and none is native [D 10-STATE
    §3.3 and §5 S8].
  - After X1a and S5, lower them into Foundry and use them as B1-cc items. They are the most realistic agentic
    workflows on hand.
- **P2-6. Efficiency and construction cost.**
  - Schedule the load tests (300 nodes, 10 concurrent runs; free) in W2 [D 10-STATE row 18].
  - Make "replay unchanged nodes during smoke runs" a builder-v0 requirement. Testing is 45–76% of a Haiku
    construction's cost [D 00-SYNTHESIS §3.5 item 6], and construction never amortising is risk S2 [D 10-STATE §5].
- **P2-7. Ask for owner inputs actively.**
  - Offer a one-page intake (the task, what "done" looks like, 2–3 examples) that takes about 10 minutes.
  - If no tasks arrive, fall back on R-1 (you tag the R-bench items you would want done) for rung 3, instead of
    "missing".
  - Without your recurring-task list (decision 11), use R-bench's N_item for recurrence [D R-bench DESIGN §0 item 12,
    §6.2].
- **P2-8. Update 10-STATE §3.9 with the heal data that arrived after its 21:52 read** [M, P1-1]: run 4 added 4 refused
  proposals; the H-p1 retry control passed 8/8 on both base and healed; the shared ledger reached $5.09 by 22:15.

---

## 4. Re-sequenced schedule (changes only)

These are changes to 11-NEXT §5.1. Rows not listed stay as they are. Weeks marked * need the full-speed schedule
(P1-6); otherwise their added runs slip by one week [I].

| Week | Added or moved by this critique |
|---|---|
| **W0** 10-08 → 10-11 | M2a: OD1 on existing artifacts ($0). M2b: Opus starts the skeleton library. R-bench kit consolidation. The X0 spike drafts the §3 amendment text. Wider acquisition check (Tier A, τ^τ). The allowance calibration produces both schedules |
| **W1** 10-12 → 10-18 | E1 named, unchanged. E1x experiment branch opens; X1a (capped tool loop) on it. R-bench items 6–30 built (about two days of agents). M8-K0 open-weight probe (one laptop evening). K1 under the corrected kill rule |
| **W2** 10-19 → 10-25 | M24 E2E-0 vertical slice. M13-ENV on the E2 branch. RX1 pilot (the need axis only). EX1a. Heal-shadow switched on. M25 templates |
| **W3** 10-26 → 11-01 | CX3 plus S-haiku-noskel. R-bench run 1 (5 items). Pool acquisition for the sealed 40. X1a's first number on E1x |
| **W4** 11-02 → 11-08 | C0 sealed round, unchanged. RX1b (size axis). EX1b. EX2 (directed edits). Sealed-40 harness building starts |
| **W5*** 11-09 → 11-15 | E2 (adds M13-ENV, and X1a if it passed). R-bench run 2 on 30 items. M16 + M25 (swarm, nesting, board-lite) |
| **W6** 11-16 → 11-22 | E2E-1 with acceptance elicitation and OD1. C5 pilot on `gridquest`. Whole-workflow reuse pilot starts |
| **W7** 11-23 → 11-29 | `sealed-3` read under its own pre-registration. E2E-2 design. M18b pre-registration |
| **W8** 11-30 → 12-06 | Sealed-40 read on E2, carrying RX4 and the injection slice if gated. E2E-2 dry run on a development family |
| **December** | M18b learning curve. M19b cooperating workflows. Board v1 only if board-lite passed |
| **January** | E2E-2 on R-bench sealed items that need composition, instead of "February at the earliest" [I] |

---

## 5. What it costs and what it moves

**Added experiment calls, list price** [I; unit costs from 11-NEXT §1.1]:

| Item | Low | High |
|---|---|---|
| M24 E2E-0 | $5 | $15 |
| M25 arms added to M16 | $30 | $70 |
| RX1b size axis | $50 | $100 |
| M13-ENV C5 pilot | $20 | $40 |
| EX2 directed edits | $20 | $50 |
| EX1b plus heal-shadow | $10 | $30 |
| X1a first number (replaces M15-X2's $60–100) | $0 | $0 |
| M8-K0 open-weight probe | $0 | $0 |
| **Through 11-22** | **$135** | **$305** |
| `sealed-3` read (interactive episodes cost more than one-shot trials) | $60 | $120 |
| M18b learning curve | $100 | $250 |
| M19b cooperating workflows | $20 | $50 |
| **Through January** | **$315** | **$725** |

- With 11-NEXT's own figures, experiment calls come to about $0.76–2.0K through 11-22 and $2.0–4.7K through January.
  The $1.3–1.8K of R-bench harness agent time moves earlier but does not grow [I].
- This passes the $1,500 soft cap sooner, so D1-cap is needed by 10-19, not 11-01 (P0-5).

**Projected evidence depth at the end of January** [I]. This uses 10-STATE's rubric. Depth is not success: each point
can come back negative.

| Layer | 11-NEXT | With these changes | What moves it |
|---|---|---|---|
| 3 Router (now both axes) | 4 | 4 | RX1b gives the size axis a number at the same depth |
| 10 Reuse and learning | 3 | 4 | whole-workflow pilot; M18b |
| 11 Composition | 3 | 4 | M25 nesting test against a flat baseline |
| 13 Subagents in nodes | 3 | 4 | X1a against B0-agent |
| 14 Parallel workflows (AMP) | 2 | 3 | M19b on the cloud |
| 15 Board and notes | 2 | 4 | board-lite pre-registered against `wide` alone and B5 |
| 20 Real-world evaluation | 5 | 5 | same depth, reached about 6 weeks earlier and on 30 + 40 items |
| 21 Interactive and visual (new) | (1) | 4–5 | C5 pilot; the `sealed-3` read |
| 22 Integration (new) | (0) | 3 | E2E-0, the composed dry run, E2E-1 |
| **Original 20 layers** | **78/120** | **≈ 84/120** | |

---

## 6. Decisions this needs from you

| By | Decision | Default proposed here | Unblocks |
|---|---|---|---|
| 10-12 | R-5: allowance for building R-bench items 6–30 now (no new money; earlier agent time) | yes | P0-5 |
| 10-16 | Executor route: (a) amend ROADMAP §3 for a capped, Foundry-owned tool loop with no new credential | **(a)**, instead of 11-NEXT's (c) | P1-4, τ²/AppWorld, 48% of agentic items, "Haiku with tools" on outside tasks |
| 10-19 | D1-cap, brought forward | set it | P0-5, §5 |
| any time | The M8-K0 open-weight probe: one laptop evening, one model id in the policy file | yes | P1-9 |
| any time | Confirm that "Full speed" applies to experiment slots too (D14 stays unadopted) | full speed | P1-6 |

The heal structural ops (P1-1) go to owner review by default and need no decision now.

---

## 7. Exact edit list

| File | Where | Edit | Finding |
|---|---|---|---|
| 10-STATE | §2 table | add row 21 (interactive, visual, game; depth 1) and row 22 (integration; depth 0); report "of 140" beside "of 120" | P0-1, P0-2 |
| 10-STATE | §2 row 3 | gap: "the size axis has no planned measurement" | P0-3 |
| 10-STATE | §2 row 9 | add OD1 as the reported metric | P0-4 |
| 10-STATE | §2 row 10 | add "learning" as its own gap | P1-3 |
| 10-STATE | §3.9 | add run 4 (4 refused), the H-p1 retry control (8/8 and 8/8), and the ledger at $5.09 by 22:15 | P2-8 |
| 11-NEXT | §1.3, §4.1 | add the E1x named experiment freezes; "Engine branch 1" → "2" | P0-2, P1-5 |
| 11-NEXT | §3.1 M2 | split into M2a (oracle discovery plus acceptance elicitation, OD1 by 10-14), M2b (≥ 20 skeletons plus coverage), M2c (repair = heal engine) | P0-4, P1-1, P1-7 |
| 11-NEXT | §3.1 M3 | add the S-haiku-noskel arm and "structure source" | P1-7 |
| 11-NEXT | §3.1 M4 | add the `sealed-3` read in W7 under its own pre-registration | P0-1 |
| 11-NEXT | §3.2 M6 | split into EX1a and EX1b; remove "(+ CX3's natural failures)" from EX1a; add the structural-ops arm and the variance precondition; add heal-shadow | P1-1, P1-10 |
| 11-NEXT | §3.2 new M6b | EX2 directed edits | P1-2 |
| 11-NEXT | §3.2 M8-K1 | replace the kill rule (P1-8 text); add M8-K0; add bridge latency and availability to X8 | P1-8, P1-9 |
| 11-NEXT | §3.3 M10 | new window and building dependency (P0-5 text) | P0-5 |
| 11-NEXT | §3.3 M12 | add Tier A, IDoFT and the τ^τ gate; τ² and AppWorld "after X1a" | P0-1, P1-4, P2-2 |
| 11-NEXT | §3.4 new M13-ENV | env port, image inputs, C5 pilot | P0-1 |
| 11-NEXT | §3.5 M14-RX1p | kill rule limited to the need axis; add RX1b | P0-3 |
| 11-NEXT | §3.5 M15 | add X1a | P1-4 |
| 11-NEXT | §3.5 M16, M17 | merge M25 into M16; M17's board on `synth`, gated by board-lite | P0-2 |
| 11-NEXT | §3.5 M18 | `call` needed only for sub-workflow reuse; add M18b | P1-3 |
| 11-NEXT | §3.5 M19 | add M19b | P1-11 |
| 11-NEXT | §3.5 M20 | add the summary evaluation, builder transcript and router card | P2-3 |
| 11-NEXT | §3.5 new M24 | E2E-0 vertical slice | P0-2 |
| 11-NEXT | §3.5 M22 | design in W7, dry run in W8 | P0-2 |
| 11-NEXT | §3 effort cells | add agent-hours and review-hours | P1-5 |
| 11-NEXT | §4.1 | a full-speed schedule beside the low one | P1-6 |
| 11-NEXT | §5.1, §5.3, §6, §7, §8 | as §4–§6 of this file | all |

---

## What this critique does not argue

- **It does not relax a freeze, a sealed read, R3, R5 or any kill margin.** Emulations are development evidence. They
  decide whether a native construct is worth building, not whether the IR represents it; C6 still counts only native,
  compiled constructs.
- **It does not claim the proposals will succeed.** Each one adds a way to fail early, which is the point.
- **Effort, cost and odds here are estimates [I].** The one throughput figure is 10-08's commit log and the heal build.
  It does not count review time, and much of that day's work is unreviewed.
- **It shares its authors' blind spots (W16).** The way to check it is the one 10-STATE gives: you spot-check three
  claims against their cited files.

## Sources

- Reviewed: [10-STATE.md](10-STATE.md), [11-NEXT.md](11-NEXT.md).
- Vision and history: [01-requirements.md](01-requirements.md) #1, #15, #17–18, #30, #36, #38, #47, #59–60, #67–68 and
  §(c); [00-SYNTHESIS.md](00-SYNTHESIS.md) §1, §3.2, §3.5–§3.6, §3.15, §5 (L1218), App. C, review log;
  [00-CRITIQUE-alignment.md](00-CRITIQUE-alignment.md) L335–347; the session transcript at T:3295 (via 01-requirements),
  T:6047, T:6088, T:6107, T:6161, T:6236, T:6583, T:6616 and T:6928.
- Plans and designs: [05-router-constructor.md](05-router-constructor.md) L369, §3.3, L611–616, L646–648, L745;
  [02b-agentic-constructs.md](02b-agentic-constructs.md) §4.1, §5.1; [03-swarms-frontier.md](03-swarms-frontier.md)
  L94, L589; [02-ir-expressiveness.md](02-ir-expressiveness.md) L1015–1050; `research/heal-20261008/DESIGN.md` §0,
  §7.1, §10, §11.1, §14, App. B; `research/replicate-20261008/DESIGN.md` §0, §4, §6.1–§6.2, §8.1–§8.4;
  [ROADMAP-AMENDMENTS.md](ROADMAP-AMENDMENTS.md) R-3, R-4.
- Repository [M]: `docs/ROADMAP.md` L770–771, L803, L809–815, L833, L843–845, L892–893, L921, L1072–1075; `docs/THESIS.md`
  D9–D14; `README.md` L325; `src/ports.mjs`; `beds/gridquest/README.md` L1; `beds/synth/AUDIT.md`;
  `experiments/heal/runs/live-20261008-r4/rec.json`; `experiments/heal/runs/live-20261008-r4/p1-retry.json`;
  `experiments/heal/runs/live-20261008/spend-global.jsonl`; `git log --date=iso-strict` for 2026-10-08.
