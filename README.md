# Workflow Foundry

Start here. This README is the single entry point for humans and agents.
Everything else is linked from it.

## What this is

Foundry lets agents **construct small, bounded, typed workflows for a specific task**
(micro harnesses), run them durably, adapt them while they run, judge them against
contracts they cannot game, and keep only the few that earn reuse. Code owns procedure
and models make narrow judgments, so these workflows let **cheap models (Haiku 5.5 today;
open-weight models once a GPU route exists) do work that today needs a frontier agent**.
For many tasks the best workflow is none, one call or one agent. **ARC and AMP are the
harness; Foundry is the workflow layer inside it.** The full argument, including what is
and isn't novel, is in [docs/THESIS.md](docs/THESIS.md).

What exists today is a local-first research system:
- a typed workflow IR (9 node kinds, including narrow `agent` judgments, sandboxed `code`
  and `verify`) and a persistent SQLite runtime with parallel `map`, timers and a
  record/replay journal;
- an MCP server, a CLI and a visual web UI, plus a read-only run-viewer prototype
  (`tools/run-view/`);
- portable skills;
- a large adversarial test suite, and task beds with independent oracles.

It has no call-by-hash, no need router, no honest acceptance gate and no reuse layer yet.
A valid schema, a successful model response and a verified task outcome are three
different results.

## Status

*Amended 2026-10-08 (design review): X-1 of
[ROADMAP-AMENDMENTS.md](research/review-20261007/ROADMAP-AMENDMENTS.md) (status table, review
links, model-role wording, cost ledger, operational decisions), with P1 and C0 dev at their
final numbers. Following ROADMAP §6.1, this section takes over the status table of the
review synthesis. Everything below is development and diagnostic evidence: nothing is a
sealed or claim-bearing result.*

*Amended 2026-10-28: the SOP-Bench phase-2 primary (2026-10-22, under Results) is the first sealed result. Everything
else below is still development and diagnostic evidence.*

**Where we are.**
- **Phase 0** finished 2026-10-06 (start HEAD `6e1c06c`).
- **Phase 1's exit experiment (P1)** finished 2026-10-08 for model classes M and L; class S
  (local generative models) is parked.
- **The C0 dev round of Phase 2** finished 2026-10-08 and is closed at `records` and
  `codefix`.
- **Phases now interleave** in a dated six-week plan, 2026-10-08 → 2026-11-24
  ([synthesis §5](research/review-20261007/00-SYNTHESIS.md); THESIS D16). Its first
  engineering step is the stage-1 engine bump: the store rewrite first, acceptance that must
  gate, taint, hash-chain binding, and `foundry cancel` plus stop-all. That work started on
  2026-10-08; `foundry cancel` and `foundry stop-all` landed on 2026-10-09 (see "Cancel and
  stop-all" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)). It ends in a named engine
  freeze, E1, before any new comparative run.
- **2026-10-22 to 10-28.** Rows with links are in [RESEARCH.md](docs/RESEARCH.md); owner rulings D21–D30 are in
  [decisions-20261021.md](research/decisions-20261021.md):
  - **Sealed: SOP-Bench phase 2** (k = 3, 10,158 runs). Build-once Haiku workflows reach strict pass^3 87.6% [85.6, 89.5]
    against the per-row Haiku agent's 67.1%, at $0.10 against $8.62. By the frozen rule they beat the agent and are
    cheaper, but **the 90% reliability claim is not met**. The ablation cells are not finished and RESULT-p2.md is not
    written (see Results).
  - **Against Opus 5.5 xhigh alone** (the owner's frontier bar) on AutomationBench: on dev60 Opus scores 28/60 at $0.41 per
    task and the Mercury-planned A1-C arm 29/60 at about $0.035, but in-sample. On the 60 unseen look-2 tasks Opus scores
    26/60 at $0.385, and no cheap-model arm has run there, so there is no unseen-task comparison yet. A1-C v2's look-2 run is
    built and preregistered and waits on the owner's go.
  - **OT-0** (dev worlds): Haiku + validator 14/14 for $2.28; Sonnet 5/14 ($13.11) and Opus 6/14 ($17.97) working freely.
  - **Verification:** the requirement ledger RL2 reaches held-out AUROC 0.837, the judges share blind spots, and dev60's
    ceiling is about 53/60. The cross-blocker synthesis ([ATTACK](research/blockers-20261021/ATTACK.md), D28) traces four
    blockers to one missing object, an expected diff derived in code.
  - **Unmerged, development** (on branches rescued 10-28): asking Haiku beats the preregistered code need router (F1 0.944
    vs 0.739); FH-1 heal removes 75.2% of recurring failing cases with 0 regressions for $1.14; for reuse, the profile gate
    is worse than rebuilding and a history-check gate had 0 wrong in 98 accepted. Durability over time (DUR-1) is designed
    and drafted but not run; adaptive in-node sub-workflow creation is not built.
  - Three container restarts on 10-22 killed in-flight runs; chains now resume from their last commit (register C9).
- **2026-10-21, evening.** Development evidence only; rows with links are in [RESEARCH.md](docs/RESEARCH.md):
  - **Pass rate.** Haiku acting with Mercury 3 as planner and checker inside the code-owned harness passes 29/60
    on AutomationBench dev60, tying Sonnet + A1 (28/60) at about 30% of its cost. devCheck looks 1–2: A1-C and A1
    both 20/60. The owner's frontier bar is **Opus 5.5 xhigh** (D19); that comparator runs after the SOP sealed run.
    The bottleneck is verification: in the Mercury arm a clean "all checks pass" was right 17 of 28 times, and 19
    of 60 tasks were never passed by any arm (orchestrator's dev analysis of the stored runs; the verifier-lab
    write-up will carry the per-task table). The verifier lab and A1-C v2 are working on it.
  - **Construction.** BUILDER-1: the template builder verifies 18/21 with Haiku and 18/21 with Mercury, against
    5/21 one-shot. COMP-1: composition keeps interfaces clean but is inconclusive on correctness (0.918 vs the 0.95 bar).
  - **In flight.** SOP-Bench phase 2 sealed (k = 3); the OT-0 agent arms, re-running after the session limit voided
    them; engine v2 (chaos 20 → 35 of 43), held until the sealed and OT-0 runs finish; the need router, heal,
    reuse (C2), adaptive sub-workflows, game/visual QA, node capabilities, onboarding site and breadth programs.
  - **Owner asks against the evidence:** [REQUIREMENTS-COVERAGE-20261021.md](research/REQUIREMENTS-COVERAGE-20261021.md);
    standing operating rules: [OPERATING-PRINCIPLES.md](research/OPERATING-PRINCIPLES.md).
- **2026-10-21 (cloud session, resumed after the weekly limit).** Development evidence only:
  - **AutomationBench dev60** is complete for 4 arms; Sonnet + the A1 harness is best at 28/60
    ([DEV60-A0-A1](research/automationbench-20261014/runs/DEV60-A0-A1.md)). The code-owned harness A1-C passed review (GO
    with conditions).
  - **SOP-Bench** is acquired, with exact upstream parity and a 73.8% strict Haiku agent baseline. Phase 2 (build-once,
    sealed k = 3) is running.
  - **New programs:**
    - composition: an E8 composed arm with capability contracts, faults and drift
      ([PLAN](research/composition-20261021/PLAN.md));
    - intent recovery from messy requests: SPEC-0 is built, and a second rater gives κ 0.57
      ([DESIGN](research/intent-20261021/DESIGN.md));
    - Mercury 3 as a second cheap model ([PROVISIONING](research/mercury-20261021/PROVISIONING.md));
    - the org layer and the open-core line ([v0](research/business-20261021/OPEN-CORE-AND-INVARIANTS.md)).
  - **Benchmark landscape:** `research/benchmarks-20261015/`.
- **2026-10-09: the cloud session ended** (usage limit); work continues on the owner's laptop. Stream run data, journals and
  the Kev held-out material were lost with the container (`research/jit-20261008/HANDOFF.md`). The two in-flight workflows
  were finished by hand:
  - blocker dossiers → [synthesis](research/jit-20261008/BLOCKER-SYNTHESIS.md), revised after its
    [critique](research/jit-20261008/BLOCKER-SYNTHESIS-CRITIQUE.md): one ranking of the experiments, a revised
    HANDOFF §5 order and owner questions Q1–Q6;
  - Kev J1 → **J1 on Jev** ([dev report](research/judge-20261009/J1-JEV-DEV.md)): the owner moved the judge
    program from Kev training to hosted Jev.

Every phase still ends with a capability number against a simple baseline and a
`research/<topic>-<date>/REPORT.md`.

**Design review (2026-10-07/08).**
- [Synthesis, revision 2](research/review-20261007/00-SYNTHESIS.md): where we stand, answers
  to the owner's questions, the plan (§5), the decisions (§6) and the security gating table
  (§7). Its P1 figures are interim (08:44, 242 of 288 trials); the final ones are below.
- [Amendments](research/review-20261007/ROADMAP-AMENDMENTS.md), applied on 2026-10-08 to
  [THESIS](docs/THESIS.md), [ROADMAP](docs/ROADMAP.md), this README and
  [AGENTS.md](AGENTS.md), with the synthesis' default decisions (THESIS §10, D8–D16), with
  two exceptions:
  - **Usage rule (D14):** a proposal awaiting the owner, not adopted. The owner chose
    "Full speed".
  - **Kev (D13):** superseded by the owner's full approval on 2026-10-08 ("eveything is
    okayed"): dataset building continues, laptop training is approved once the wave-1
    datasets pass review, the Kev-vs-Haiku-5.5 comparison runs alongside as the promotion
    gate, and the hosted Kev budget (up to $450 after a 50-call pilot) is approved.
- Lane reports:
  - [01 requirements](research/review-20261007/01-requirements.md);
  - [02 IR expressiveness](research/review-20261007/02-ir-expressiveness.md);
  - [03 swarms and frontier](research/review-20261007/03-swarms-frontier.md);
  - [04 efficiency and Rust](research/review-20261007/04-efficiency-rust.md);
  - [05 router and constructor](research/review-20261007/05-router-constructor.md);
  - [06 UI](research/review-20261007/06-ui.md);
  - [07 context, subagents and audit](research/review-20261007/07-context-subagents-audit.md).
- Critiques: [alignment](research/review-20261007/00-CRITIQUE-alignment.md) and
  [rigor](research/review-20261007/00-CRITIQUE-rigor.md).

| Phase | State | Evidence |
|---|---|---|
| 0 Unblock | **done** | [env probe](research/env-20261006/ENV.md), suite 605 tests: 590 pass, 0 fail, 15 skip (all with recorded reasons: `node research/list-skips.mjs`) |
| 1 Core nodes | **built and reviewed; exit experiment P1 done** (classes M and L; S parked) | [design](research/core-20261006/DESIGN.md), [pre-registration](research/core-20261006/PREREG.md), [**P1 report**](research/core-20261006/REPORT.md); 10 adversarial-review findings fixed and verified; suite at the Phase 1 review: 765 tests, 747 pass, 0 fail, 18 recorded skips |
| 2 Construction (C0) | **dev round done and closed** at `records` and `codefix`, 2 of the 5 pre-registered families (review decision 8, default). Next: the strict construction lint and oracle discovery, structured builder v0, the R-bench pilots, then the sealed round on E1 (`PREREG-sealed.md` not yet written) | [design](research/construction-20261006/DESIGN.md), [dev prereg](research/construction-20261006/PREREG-dev.md), [**C0 dev report**](research/construction-20261006/REPORT-dev.md) |
| Corpus and R-bench | [Workflow corpus](research/corpus-20261006/COVERAGE.md): 1,342 items from 27 platforms. Agent-framework slice: 220 items from 22 framework sources (08:45), being integrated now. R-bench: a 30-item shortlist ([selection](research/replicate-20261008/SELECTION.md)); the pilot (`experiments/replicate/`) is in progress, with no oracle frozen yet | `research/corpus-20261006/`, `research/replicate-20261008/` |
| Beds | 9 Tier-A families and 4 sealed families. The sealed families have never been used. Audited: records 3.0.0, incident 4.2.0, synth 3.0.0, kinetics 4.0.0, gridquest 2.0.0, ownerci 1.1.0 and codefix 1.1.0 (partial). Not audited: gameqa, runbook | `beds/*/AUDIT.md` |
| 3 Cheap execution (C1) | Assignment search is built. Its design still names Haiku 4.5 and needs the Haiku 5.5 update ([C0 dev report §6.4](research/construction-20261006/REPORT-dev.md)) | [design draft](research/distill-20261007/DESIGN.md) |
| 4 Typed judgments | **2026-10-09: Jev replaces Kev** (owner direction; Kev J2 training is parked). Hosted Jev is in the policy as a judgment model, pinned to `jev-1.13.0` since policy `2026-10-15.1` (before that, the `jev-latest` alias, served `jev-1.13.0`), scored through `score-served.mjs --jev`. **J1 on Jev done** on the three surviving dev-select files: 1,106 records, 0 faults, 0/60 re-read flips (dev, K=1, diagnostic). Jev is strong on most interactive and runbook ports, weak on interactive X6, runbook X4 and kinetics X3; the in-family probe beats it on kinetics X3/X4. The wave-A builds and held-out material were lost with the cloud container; only kinetics rebuilt hash-exact. J2 is a [draft prereg](research/judge-20261009/PREREG-J2-draft.md) with ten prerequisites | `src/judgment.mjs`, [J1 on Jev](research/judge-20261009/J1-JEV-DEV.md), [Kev research](research/kev-20261007/) |
| 5–6 | Not started. `call` (IR stage S1) and the `wide` operator are planned for week 6 of the plan | see [ROADMAP §5](docs/ROADMAP.md) |

**Layers of the vision** (moved from synthesis §2 and updated; [M] measured, [D] documented):

| Layer | Status | Evidence and caveat |
|---|---|---|
| IR: represent any workflow | **Partial.** 9 node kinds; no `call`, triggers, error branches, signals, sessions or board | 476/1,342 corpus items (35%) declared native; **0 compiled, 0 executed** [M lane 2]. Declared coverage counts converter tokens and compiles nothing |
| Agent-framework slice | Being curated and integrated | 220 items (08:45): 20% native; 36% with the 19 planned constructs; 61% need an agent tool loop [M]. Sonnet-extracted; no independent re-check recorded yet |
| Runtime | Built. Fast enough today; breaks at fan-out | 1–3% of real-run wall time (2 runs); a 1,000-item map adds 73–135 s of pure overhead [M lane 4]. The store rewrite is the first engine fix |
| Cheap execution (P1) | **First directional number, final** | See Results. A hand-written ceiling on one synthetic family |
| Construction by Haiku (C0 dev) | **Partial; too small to call** | See Results. 2 families, one construction per cell |
| Honest run verdicts | **Broken** | The run verdict said "pass" on all 5 failed F trials in C0 dev and on fhand-haiku's only P1 failure. Acceptance is "an answer exists" in all 7 constructed artifacts [M]. The fix is the strict construction lint and acceptance that must gate (ROADMAP §2.5 step 5, §2.6) |
| Need router and slider | Design only | Built only if the RX1 headroom sweep finds something to route for (ROADMAP §2.8) |
| Kev (typed judgments) | Engine, laptop bridge and contracts library built; nothing trained | Stock Kev-0.8B is at or below the rule baseline on 4 of 5 ports; CPU latency 2.5–13.7 s [M]. A Haiku 5.5 typed call takes about 1–1.5 s for under $0.001 |
| Composition | Static nesting only (depth ≤ 6) | `src/validate.mjs` [D] |
| Subagents (`executor`) | An adapter used by experiments; not an IR node | The network is not isolated, and the CLI login is readable in the sandbox. Under THESIS D10, no executor reads third-party text |
| Board and private notes | Not built | — |
| Audit | Hash chain, model journal, receipts and opt-in anchors exist; **gaps** | Journal rows (request and response hashes), decision records and executor transcripts are bound into the chain, and each verdict seals a Merkle root of the journal (`src/audit.mjs`, checked by `foundry verify-run`); chain-head anchors can be appended to a file outside the database (`--append-anchor`). Still open: anchoring is opt-in, not on by default, and an anchor file whose last line was dropped still verifies. *Corrected 2026-10-21 (compromise register D3): this row used to say that responses, decisions and transcripts are not bound into the chain and that there is no external anchor [D lane 7]; that was stale* |
| UI | **Prototype** read-only run viewer (`tools/run-view/`) | 19 unit tests and 74 browser checks pass. The owner has not reviewed it yet; the game-QA screenshots are a scripted fixture |
| Security | Labels, quarantine and sandbox exist; control-flow taint landed 2026-10-08; **gaps** | Landed: an ungated effect whose firing depends on untrusted data (`when`, loop `until`, map items, a skip chain, `onError` continuation) is rejected `LABEL_POLICY` / `UNTRUSTED_CONTROL` by the validator and again at dispatch (`tests/control-taint.test.mjs`; lane-7 probe B now fails; 0 of 393 test-suite workflows newly rejected [M]). Still open: the sink-field policy (untrusted data cannot fill even a data field of an ungated effect), the declassification budget, builder provenance taint, executor isolation. Each fix gates the first run that needs it ([synthesis §7](research/review-20261007/00-SYNTHESIS.md)) |
| Evaluation validity | **Weakest link** | Every bed is synthetic and Claude-written; the sealed families are unused; nothing external has run. Next is the wild ladder (ROADMAP §4.2). *Corrected 2026-10-28: external benchmarks have run since 10-14 (AutomationBench, development) and SOP-Bench's sealed rows on 10-22; our own sealed families are still unused* |
| Reuse library | Not started | Phase 5 |

Counts over these 14 layers:
- built and tested, with known gaps: 6;
- partly built: 3;
- not built: 5;
- measured on held-out tasks of development families: 2 (P1 and C0 dev);
- measured on sealed or wild tasks: 1 (Haiku construction, on SOP-Bench's sealed rows, 2026-10-22).

### Results

**SOP-Bench phase 2, sealed primary (`p2-sealed`), 2026-10-22.** The first sealed run.
- **What ran:** k = 3 on the 1,693 sealed rows of 12 SOPs, 10,158 runs. The split, both arms, the code and the decision
  rule were frozen in [FREEZE-p2.json](research/sopbench-20261021/FREEZE-p2.json) before any sealed row was touched.
  Summary: [runs/p2-sealed/summary.json](research/sopbench-20261021/runs/p2-sealed/summary.json); design:
  [DESIGN.md](research/sopbench-20261021/DESIGN.md).

| arm | strict pass^3 (macro) | 95% CI | strict pass@1 | sealed-run $ |
|---|---|---|---|---|
| W: one workflow per SOP, built once by Haiku 5.5 on dev rows, then frozen | **87.6%** | [85.6, 89.5] | 87.7% | 0.10 |
| A: the Haiku 5.5 agent acting per row | 67.1% | [64.8, 69.4] | 72.5% | 8.62 |

- **Frozen rule.** W − A = +20.5 points [18.1, 23.0], so W **beats the agent** and **is cheaper** (with builds and repairs
  amortised, $0.00055 per W run). **The 90% reliability claim is not met:** it needs pass^3 ≥ 90% with a lower bound
  ≥ 85%, with and without the orchestration-only SOP, and W is 87.6% (88.0% [85.8, 90.0] without that SOP).
- **Caveats.** 11 of the 12 workflows make no model call at run time, so this measures how well code that a cheap model
  fitted on about 20 dev rows per SOP generalises, against a per-row agent. W trails A on 2 of the 12 SOPs. These are rows
  of a public benchmark, scored strictly; content_flagging is excluded. The ablation cells are not finished (V1-minimal has
  run; V2-bloated stopped on a rate-limit fault and is partial), and RESULT-p2.md is not written yet.

**P1, Phase 1 exit (`p1-records-v3`), final.**
- **What ran:** 288 of 288 trials, ending 2026-10-08 09:18 UTC: 12 held-out `records` v3.0.0
  test tasks (d3 and d4) × K = 3 × 8 arms.
- **Reproduce:** `node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl`.
- **Report:** [research/core-20261006/REPORT.md](research/core-20261006/REPORT.md). The d3
  and d4 splits come from its post-hoc script.

| arm | success | 95% CI | d3 | d4 | pass^3 | $/trial | CPS |
|---|---|---|---|---|---|---|---|
| `fhand-haiku`: hand-written workflow, Haiku 5.5 nodes | **35/36** | [0.86, 1.00] | 17/18 | 18/18 | 0.917 | 0.0158 | **0.0162** |
| `fhand-sonnet`: the same workflow, Sonnet 5.5 nodes | 36/36 | [0.90, 1.00] | 18/18 | 18/18 | 1.000 | 0.2132 | 0.2132 |
| `b0call-sonnet-med`: one Sonnet 5.5 call | 28/36 | [0.62, 0.88] | 13/18 | 15/18 | 0.417 | 0.2469 | 0.3175 |
| `b0agent-haiku`: Claude Code with tools, Haiku 5.5 | 29/36 | [0.65, 0.90] | 12/18 | 17/18 | 0.667 | 0.1108 | 0.1376 |
| `b0call-haiku-none`: one Haiku 5.5 call, thinking off | 25/36 | [0.53, 0.82] | 14/18 | 11/18 (4 TO) | 0.417 | 0.0303 | 0.0437 |
| `b0call-haiku-med`: one Haiku 5.5 call, effort medium | 23/36 | [0.48, 0.78] | 16/18 | 7/18 (11 TO) | 0.417 | 0.0257 | 0.0402 |
| `b0ncall-haiku-med`: the same, plus notes (B0+N) | 17/36 | [0.32, 0.63] | 13/18 (1 TO) | 4/18 (14 TO) | 0.167 | 0.0252 | 0.0534 |
| `b0call-haiku45-none`: one Haiku 4.5 call | 0/36 | [0.00, 0.10] | 0/18 | 0/18 | 0.000 | 0.0551 | ∞ |

TO is a single call cut off by the 300 s per-call timeout. CPS is the recorded dollars per
verified success.

**Pre-registered rule: supported, directionally.**
- **Success.** fhand-haiku's interval [0.86, 1.00] overlaps Sonnet's single call
  [0.62, 0.88]. The difference is +0.194 [0.056, 0.361], but McNemar gives p = 1.000.
- **Cost.** The CPS ratio is 0.051 [0.044, 0.063], so the workflow costs about 1/19 as much
  per success.
- **Reading.** The workflow on Haiku is *at least as good as* one Sonnet call at a much
  lower cost per success; "beats" is not shown.
- **Other paired comparisons:**
  - fhand-haiku against the Haiku agent: +0.167 [0.000, 0.389], CPS ratio 0.118
    [0.093, 0.229];
  - a Haiku 5.5 single call against a Haiku 4.5 single call: +0.694 [0.472, 0.889],
    p = 0.004. This is the only success difference P1 resolves cleanly.

**Caveats.**
- **A hand-written ceiling workflow.** An Opus agent wrote `fhand` after studying the
  family on dev seeds. P1 tests neither construction (that is C0) nor C1's assignment search.
- **One synthetic family.** 12 tasks, K = 3. The study is powered only for success gaps above
  about 35 points, and it supports no transfer claim.
- **d4 single-call timeouts.**
  - The Haiku 5.5 single calls ran under a 300 s per-call limit that the pre-registration
    never stated. It is the default in `src/models`.
  - 30 of 108 such trials timed out, 29 of them at d4. They count as failures.
  - Against the same model in a single call, the workflow's success advantage is therefore
    largely an artefact of the harness. At d3, with one timeout in 54, the workflow scored
    17/18 against 13–16/18 (post-hoc, directional).
  - The cost advantage holds: at d3 the workflow's CPS is 0.29–0.40× that of the same-model
    single calls.
  - The timed-out calls were recorded at $0. Charged at their $1 bound, as PREREG §3
    requires, P1's total is $56.09.
- **Haiku 5.5 vs Haiku 4.5.** This gap is confounded with how much each model reasons under
  "thinking off". 22 of Haiku 4.5's 36 failures break one structural rule: a row assigned to
  several records.
- **False pass.** The workflow's own verdict said "pass" on its only failure.
- **Burned seeds.** The post-run diagnoses inspected test seeds 5001–5006. They are burned
  and must never be held out again.

**C0 dev round (`records`, `codefix`), closed.**
- **Report:** [research/construction-20261006/REPORT-dev.md](research/construction-20261006/REPORT-dev.md).
- **Reproduce:** `node experiments/c0/analyze.mjs experiments/runs/c0-dev`.
- **What ran:** 8 constructions (K_c = 1 per cell), 24 probes and 96 evaluation trials, on
  test seeds 6001–6004 at d3 with K = 2.

| arm | builder → artifact | records | codefix | all | exec $/trial | construction $ | CPS amortised |
|---|---|---|---|---|---|---|---|
| F-opus | Opus 5.5 → workflow.json | 8/8 | 8/8 | **16/16** | 0.0750 | 4.51 | 0.357 |
| B1-opus | Opus 5.5 → solve.mjs | 8/8 | 4/8 | 12/16 | 0.2683 | 6.24 | 0.878 |
| F-haiku | Haiku 5.5 → workflow.json | 6/8 | 5/8 | 11/16 | 0.1062 | 1.91 | 0.328 |
| B1-haiku | Haiku 5.5 → solve.mjs | 8/8 | 8/8 | **16/16** | 0.0780 | 2.21 | 0.216 |
| B0-opus | none (Opus 5.5 agent) | 8/8 | 8/8 | **16/16** | 0.5056 | 0 | 0.506 |
| B0-haiku | none (Haiku 5.5 agent) | 4/8 | 8/8 | 12/16 | 0.1188 | 0 | 0.158 |

- **Directional only.** PREREG-dev §4 says "directional only; no claim is made from this
  round".
  - The round covers 2 of the 5 families, with one construction per cell and 8 trials per
    family cell.
  - The family-clustered bootstrap has only 2 clusters, so its intervals describe spread,
    not inference.
- **Haiku as builder.**
  - F-haiku − F-opus = −0.31 [−0.63, 0.00].
  - The F substrate did not help the Haiku builder relative to scripts: F-haiku scored 11/16
    and B1-haiku 16/16.
  - Most defects were gaps in the kit, the templates and the validator, not in Haiku. The
    over-strict check also appeared in Opus builds (B1-opus 4/8 on codefix, latent in
    F-opus).
  - Report §6.1 lists the validator warnings that would have prevented each defect. They
    feed the strict construction lint (ROADMAP §2.5 step 5).
- **Directionally supported.**
  - F-opus executes much cheaper than B0-opus at equal success: 16/16 each, execution CPS
    ratio 0.148 [0.064, 0.370].
  - Payback against the same model solving directly with Claude Code comes after:
    - Opus-built: 3.8 successes on records and 9.6 on codefix;
    - Haiku-built: 2.9 on records, and never on codefix.
- **Probes and verdicts.**
  - Probes passed 24/24 and still did not predict the evaluation.
  - The F run verdict was "pass" on 32/32 trials, including the 5 oracle failures.
- **codefix at d3 does not discriminate.** B0-haiku solved it 8/8 at $0.035 per trial, the
  cheapest arm.
- **Burned seeds.** Test seeds 6001–6004 at d3 were inspected by the diagnoses and are
  burned.
- **Spend.** $35.32 recorded, plus at most $4 unrecorded.

### Earlier history

**Phase 1 (core nodes), what exists now:** `agent` nodes (one narrow, typed model judgment, with
escalation E1/E2/E7), sandboxed `code` nodes (JS/Python in user+mount+pid+net namespaces),
`verify` nodes with independence labels, parallel `map`, timers with `foundry tick`, run verdicts,
a deterministic context compiler with receipts, and a record/replay journal for every model call
(`src/models/`, `src/journal.mjs`, `src/context.mjs`, `src/sandbox.mjs`). Model access: hosted
Claude models through `claude -p` and local CPU models through llama.cpp, all ids from
`policy/models.json`. A live smoke run (three parallel Haiku agent nodes, a sandboxed code node and a
verifier) passed in 6.4 s for $0.009.

**First measurements (2026-10-06/07, before P1; development evidence, `records` bed, K = 1,
small n; superseded by the P1 results above):**
- A single Sonnet 5.5 call already solves `records` at d1–d3 (6/6, ≈ $0.08–0.18 per task); a
  single Haiku 4.5 call does not (0/6).
- A hand-written Foundry workflow (code owns parsing and rules, Haiku makes one narrow judgment per
  6-row chunk) went from failing at $0.30/task to passing 3/3 d2 tasks at $0.086/task after two
  changes: thinking off for the narrow extraction node (thinking made Haiku *worse* and 3–4× more
  expensive), and parsing dates and amounts in code from the model's raw spans. At d3 it still
  fails (0.90, 0.95). The pre-registered experiment ([PREREG](research/core-20261006/PREREG.md))
  will measure this properly.
- Construction plumbing works end to end: a builder agent in the sandbox used the Foundry kit, the
  model gateway and the probe scorer and delivered a valid workflow (Haiku builder smoke, $0.83).

**Usage-limit incident (2026-10-06 ≈ 20:00 UTC → 2026-10-07 11:00 UTC):** parallel subagent
workflows (bed building, corpus acquisition, reviews) exhausted the plan's weekly limit; 14 agents
failed and their work was redone after the reset. Subagents and `claude -p` experiment calls draw on
the same plan allowance ([docs](https://code.claude.com/docs/en/costs)); usage credits are off, so
the effect is a pause, not a charge. Agent fan-out is now kept small. A formal usage rule
is proposed (THESIS D14) but not adopted: the owner chose "Full speed".

What Phase 0 changed:
- **Node 24.21.0** from the pinned official tarball (`scripts/setup-node24.sh`, sha256-checked).
- **Model access** without any API key: the headless `claude -p` CLI uses this cloud
  session's own login. With the stripped-down flags in `policy/models.json` a narrow
  structured call costs about $0.001–0.003 on Haiku 4.5; the default CLI context would cost
  about $0.31 per call. Haiku 4.5, Sonnet 5.5 and Opus 5.5 all return schema-valid output.
- **Open-weight models on CPU**: llama.cpp `llama-server` built from the vendored source in
  the sha256-pinned `llama_cpp_python-0.3.36` sdist (GitHub release downloads are blocked by
  the egress proxy), plus Qwen3.5-2B, Qwen3.5-4B and Granite-4.2-3B GGUF (Q4_K_M, Apache-2.0,
  pinned HF revisions and sha256 in `research/manifests/models.json`). Measured: about
  100 tok/s prompt and 12 tok/s generation for the 2B model on the 4 vCPUs.
- **`policy/models.json`** is the only source of model ids (classes S = local ≤4B, M = Haiku,
  L = Sonnet, F = Opus), with prices and the spend rule.
- **OpenCode pin → allowlist** of verified (version, sha256) pairs with evidence
  (`OPENCODE_V2_ALLOWLIST` in `src/opencode-v2-free.mjs`). Only v2.0.5 is listed; the owner
  adds v2.0.23 after verifying it locally. No open-ended detection.
- **Recorded skips**: tests needing bubblewrap, OpenCode, Chromium 1243 or `corpus/` skip with
  a precise reason (`tests/support/gates.mjs`). Fixed one test that spawned a shell without
  `node` on PATH.
- **D6 decided: deleted** the LangGraph/n8n export adapters and their runtime skills. They
  were serial subsets with no role in the thesis (THESIS §10); git history keeps them.
- [Pre-registration template](research/PREREGISTRATION-TEMPLATE.md) for every comparative
  experiment.

Earlier history (the 2026-09-17 checkpoint: one model-in-the-loop outcome repair on one
synthetic objective, 98/98 vs 80/98 on independent partitions) is in
[research/checkpoint-20260917/REPORT.md](research/checkpoint-20260917/REPORT.md) and
[docs/RESEARCH.md](docs/RESEARCH.md).

## Cost ledger

List-price USD as reported by the provider (`claude` CLI `total_cost_usd`, costBasis=list;
billing goes through the session's subscription). Local CPU models: $0 API, imputed compute
reported separately. Orchestration by this session and its subagents is not itemized.

| Date | Item | Models | Calls | USD |
|---|---|---|---|---|
| 2026-10-06 | Phase 0 access probes (one default-context call, then minimal-context structured calls) | Haiku, Sonnet, Opus | 8 | 0.37 |
| 2026-10-06 | Executor smoke tests (Claude Code headless in the sandbox) | Haiku | 2 | 0.03 |
| 2026-10-06 | Records calibration pilot (single call, d1–d3) | Haiku, Sonnet | 12 | 1.36 |
| 2026-10-07 | Records hand-workflow pilots (thinking on/off, code-side parsing, d2–d3, local Qwen) | Haiku, Sonnet, Qwen | 142 | 2.25 |
| 2026-10-07 | Live smoke runs (CLI agent workflow, gateway, Haiku-builder construction) | Haiku, Sonnet | ~60 | 0.85 |
| | *Subtotal at the previous ledger update (2026-10-07 15:08 UTC)* | | | *4.86* |
| 2026-10-07 | C1 assignment-search local pilot (`experiments/runs/distill-pilot/journal.sqlite`; the Qwen/Granite calls cost $0) | Haiku 4.5, local Qwen/Granite | 15 | 0.02 |
| 2026-10-07 | records-v3 hand-workflow development for P1, dev seeds only (`/var/tmp/foundry-work/records-v3/journal.sqlite`, outside the repo) | Haiku 4.5, Haiku 5.5, Sonnet | 6,752 | 24.91 |
| 2026-10-07 | Kev probe (`experiments/runs/kev-probe/journal.sqlite`) | Sonnet | 398 | 2.56 |
| 2026-10-07/08 | C0 dev round: 8 constructions $14.86, 24 probes $2.02, 96 trials $18.43 ([REPORT-dev §5](research/construction-20261006/REPORT-dev.md)) | Opus, Sonnet, Haiku 5.5 | 768 journaled + 40 CLI sessions | 35.32 |
| 2026-10-07/08 | P1, 288 trials ([REPORT §7](research/core-20261006/REPORT.md)), including the $0.064 orphan run | Haiku 5.5, Haiku 4.5, Sonnet | 1,863 journaled + 36 CLI sessions | 26.09 |
| | **Total recorded (experiment calls)** | | | **93.76** |
| | Not recorded: 3 C0 B0 sessions killed at a restart (bound $4, estimate $0.3–1.0); 30 P1 single calls cut off by the timeout (bound $30, estimate ~$1.35); P1 work killed at the owner stop (bound ≥ $5) | | | about 2 (estimate); at least 39 more at the bounds |
| | *Rows added 2026-10-28. They are not part of the total above, which stops at 2026-10-08; spend from 10-09 to 10-21 is recorded in each result file and is not itemised here* | | | |
| 2026-10-21/22 | OT-0 paid arms: W-C builds 2.56, void runs 0.46, A-HV 2.28, A-F Sonnet 13.11, A-F Opus 17.97 recorded ([RESULT-OT0 §2.4](research/org-20261021/RESULT-OT0.md)) | Haiku 5.5, Sonnet, Opus | – | 36.39 |
| 2026-10-21/22 | SOP-Bench phase 2: builds and repairs 3.53 (`FREEZE-p2.json` `spendBeforeSealedUsd`), sealed primary 8.73 (cap $40; [summary](research/sopbench-20261021/runs/p2-sealed/summary.json)) | Haiku 5.5 | 10,158 sealed runs | 12.26 |
| 2026-10-22 | AutomationBench, Opus 5.5 xhigh alone on the look-2 tasks (`a0o-look2-1`, cap $60) | Opus | 60 sessions | 23.12 |
| 2026-10-22 | AutomationBench, Opus 5.5 xhigh alone on dev60 (`a0o-dev60-dn`, cap $45) | Opus | 60 sessions | 24.43 |
| | *Subtotal of the four rows above (main tree)* | | | *96.20* |
| 2026-10-21/22 | Unmerged branches, rescued 10-28: ROUTER-1 0.15 (plus about 385K Mercury tokens), FH-1 4.62, C2-1 1.82, C2-2 0 | Haiku 5.5, Mercury 3 | – | 6.58 |
| | Not recorded: OT-0 A-F Opus sessions killed by the 03:11Z container restart (bound $4) | | | at most 4 |

Totals are recomputed from the named journals and results files (`cost_usd` per call; the B0
and builder sessions are CLI-reported). List price as computed by the CLI. On this subscription
it is a yardstick, not a charge (usage credits are off).

**Orchestration is the main driver of usage and is not itemised.** As of about 08:50 UTC on
2026-10-08, the session journal recorded 25.8 million subagent tokens across 28 completed
workflows and agents ([synthesis §2](research/review-20261007/00-SYNTHESIS.md)). That figure
excludes the main session and later workflows, and has no dollar value because the model mix
per token is not recorded. It counts against the same weekly plan allowance, which is the
binding limit, not money. The six-week plan's experiment calls are estimated at about
$560–825 at list price (synthesis §5).

## Owner decisions needed

| # | Question | Recommendation | Blocking? |
|---|---|---|---|
| A1-C v2 P1, look 2 (paid; D25, D29; added 2026-10-28) | A1-C v2's evaluation on the 60 unseen look-2 tasks is built and preregistered (PREREG-A1CV2-P1, frozen on branch `worktree-wf_3674d3bc-0a7-12`), and its launch rulings are ratified (D29). The session's permission system refused the paid launch, so it waits on you. Spend counts under D22 and, for the two Mercury arms (5.5M tokens each), D18. | Give an explicit go to launch it. | Yes: the only unseen-task comparison of the cheap arms with Opus 5.5 xhigh (26/60 there), and VL-1's second fork |
| Mercury allowance (D28 (7); added 2026-10-28) | No Mercury pilot beyond the running arms until the remaining allowance is read on the Inception dashboard; this session cannot read the account. | Read the remaining allowance on the dashboard and report it. | New Mercury pilots only |
| Publishing (D13; restated 2026-10-28) | Publishing a package, plugin, `.mcpb` or marketplace entry stays gated: AGENTS.md forbids it and the general grant does not cover it. Before any publication, history is scrubbed once with a recorded mapping of old to new SHAs (D17). | Say "publish" explicitly if and when you want it. | Publication only |
| D1-cap | The spend cap is blank. Current rule: pause before any single experiment estimated over $500; self-imposed session soft cap $1,500 (list price). | Confirm or set a cap. | No (work continues under the rule) |
| D1-aws | `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` exist in the environment with no stated purpose. They are not used as a model route. | Say whether they are meant for Bedrock; otherwise leave unused. | No |
| OpenCode | Verify OpenCode v2.0.23 locally and add its (version, sha256, evidence) to `OPENCODE_V2_ALLOWLIST`. | Do it when convenient; cloud runs skip those tests. | No |
| D7 | **Resolved 2026-10-09:** the owner's `TYPESAFE_API_KEY` is exported in their interactive bash; Jev runs read it only as `FOUNDRY_SYSTEMONE_API_KEY` from the environment, launched through `bash -ic`. Jev replaces Kev for the judge program. | None. | No |
| Heal-kit drift (2026-10-15) | The 10-09 Jev drift (`judgmentModels`, `providers.typesafe-systemone`) is decided: a proved judgment-only exemption (Q6, e8d7a53). **New:** the P0 policy batch (`2026-10-15.1`, [PREREG-NEED-V1](research/need-router-20261014/PREREG-NEED-V1.md) §13 D6) makes the gate report blocking drift on `defaultsByRole` and `inputBudgetTokensByClass.{F,L,M}`, so `loadKit` refuses with `HEAL_POLICY_DRIFT` and every heal replay is blocked. The frozen kit and journals are on this machine, so the heal suite went red (66 of 95 tests failed). Those 66 tests now skip with the reason "HEAL_POLICY_DRIFT pending owner choice (D6)", only while the blocking drift is within those four paths; any other drift still fails them, and a test checks that `loadKit` still refuses. | Choose: (a) re-freeze the kit's policy of record, which clears the budgets (they cannot take a proved exemption, because the frozen `src/runtime.mjs` reads them); or (b) a proved exemption for `defaultsByRole` (no frozen-kit file names it), which clears that path only. Until then heal stays blocked. | Heal replays and 66 heal tests (skipped) |
| Blocker synthesis Q1–Q5 (2026-10-09) | Held-out JIT seeds 8001–8024 / 8101–8124 with a per-bed ledger; R0 records rehearsal of the §3 config ($25–40); R0-K kinetics O/H re-run (~$25); a dev-calibrated kinetics tolerance (O1); Jev scope and credit cap. | Yes to each, as recommended in [BLOCKER-SYNTHESIS §7](research/jit-20261008/BLOCKER-SYNTHESIS.md). | R0/R0-K gate the held-out freeze |
| J2 prerequisites (2026-10-09) | Re-author the held-out material; a re-read validity rule for Jev's 2-decimal output (the current \|Δp\| < 0.01 rule fails at 0.03–0.07 while argmax never flips); pin the Jev version. | See [PREREG-J2-draft](research/judge-20261009/PREREG-J2-draft.md). | J2 only |
| PR #1 | Phase 0 is in [PR #1](https://github.com/Raed2180416/workflow-foundry/pull/1). The session's permission policy does not let the agent merge without review, so later phases stack on the same branch as separate commits. | Review and merge when convenient. | No |
| Haiku 5.5 (noted) | 2026-10-07: Anthropic replaced Haiku 4.5 with Haiku 5.5 (`claude-haiku-5-5`, $0.10/$0.50 per MTok, 20x below Sonnet 5.5). Added to the policy as the first class-M model; CLI route verified (typed call ~1.5 s, ~$0.0005 vs Haiku 4.5 ~6-10 s, ~$0.004). Experiments switch their weak model to Haiku 5.5 before any pre-registration is frozen. | None needed. | No |
| Local models (decided) | 2026-10-07: local *generative* models (Qwen/Granite via llama.cpp) are parked: 268 s per call and 0.38–0.80 agreement on this 4-core CPU ([negative result](docs/RESEARCH.md)). Haiku 5.5 is the cheap executor and first-rung constructor; Kev is the candidate local typed-judgment engine, kept per port only where it beats Haiku 5.5 and rules. C1's open-weight half is not measured here. | A GPU (any 16–24 GB card) would reopen the open-weight lane. | No |
| Remote compute | No Modal/Harbor credentials: Tier B/C container beds (SWE-bench Pro, Terminal-Bench) cannot run from here. | Provision if Tier B is wanted. | Only for Tier B/C |

**Design review decisions (2026-10-08).** The docs-level ones are THESIS §10 D8–D16. Their
defaults are applied, except D13 (Kev), which records the decision taken, and D14 (usage
rule), which is a proposal awaiting the owner. Any default can still be overridden. The
operational ones are listed here; the numbers are those of
[synthesis §6](research/review-20261007/00-SYNTHESIS.md).

| # | Question | Current state | Blocking? |
|---|---|---|---|
| Usage rule (D14; review decision 13) | At most 4 concurrent agents (2 for review or orchestration fan-out); only in-flight pre-registered runs while the 7-day meter warns; heavy runs after resets; weekly allowance budgets. | **Not adopted.** The owner chose "Full speed" and on 2026-10-08 gave full permissions ("eveything is okayed"). ROADMAP §6 keeps it as a proposal. | No |
| Kev (D13; review decision 7) | Pause Kev until a Kev-vs-Haiku-5.5 probe reports? | **Owner, 2026-10-08: "eveything is okayed"** (full permissions). Kev dataset building continues; laptop training is approved and starts as soon as the wave-1 datasets pass review; the Kev-vs-Haiku-5.5 comparison runs alongside as the promotion gate, not as a pause; the hosted Kev budget (up to $450 after the 50-call pilot) is approved; the laptop fast-kernel install (flash-linear-attention, causal-conv1d) is approved. | No |
| Executor egress proxy (D10; review decision 4) | Give executors model access only through a host-side proxy, which likely needs an owner-provisioned API key? | **Default no** (unchanged by the 2026-10-08 "everything okayed": a proxy key would need the owner to provision a credential, and the owner asked not to be asked to authenticate; a no-new-credential proxy design is being looked at). No executor reads third-party text. R-bench and the C0 sealed round use the structured builder. The free-builder arms, B0-agent on outside text, the injection slice and the executor experiment wait. Still to check: whether a proxy can work without a new credential. | Only for those arms |
| Ambition sentence (review decision 1) | Finish "it becomes essentially …" | Left open (default); THESIS §1 quotes your words. | No |
| Close C0 dev (review decision 8) | Stop dev rounds at `records` and `codefix`? | Default applied: closed. The lessons go into the kit before the sealed round. | No |
| Your own tasks (review decision 9) | Write 20–30 tasks you want done, each with an acceptance check or input/output examples, sealed until the run (wild rung 3). | Waiting. If none arrive by 10-28, rung 3 is reported as missing (default). | No |
| Haiku 4.5 stress arm (review decision 10) | Add a weak-constructor arm to CX3 and the C0 sealed round (about +$10–20)? | Default applied: yes. | No |
| Recurring tasks (review decision 11) | List your 10 most frequent recurring tasks, or export a few weeks of ARC/AMP logs (redacted)? | Default: no list. "Workflows pay off on tasks that recur" stays unchecked, and reuse stays deferred. | No |
| Rust (review decision 12) | Port the kernel to Rust? | Default confirmed: not now, except the reviewed 115-line sandbox launcher. | No |
| Slider default; who activates triggers | — | Can wait until a router exists, and until IR stage S3. | No |

## Quickstart and commands

Requires Node 24+ (`sh scripts/setup-node24.sh` installs the pinned 24.21.0). The
optional free-model bridge also needs Linux, bubblewrap and an installed OpenCode under `/usr`.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node bin/foundry.mjs doctor          # or: npm run check
npm test                             # default suite; integration lanes skip
node research/list-skips.mjs         # every skipped test with its recorded reason
node research/env-probe.mjs          # writes research/env-<date>/ (Node, sandbox, network, models)

# opt-in integration lanes
FOUNDRY_PACKAGING_E2E=1 node --test tests/packaging.test.mjs        # needs corpus/
FOUNDRY_UI_E2E=1 node --test tests/ui-browser.test.mjs              # needs Chromium matching playwright 1.63
FOUNDRY_UI_TRIALS_E2E=1 node --test tests/ui-trials-browser.test.mjs
FOUNDRY_MCP_REPAIR_AUDIT=1 node --test tests/mcp-repair-lifecycle-audit.test.mjs
node research/qualify-release.mjs    # all of the above + fresh-install + provenance
```

Run and inspect a workflow:

```sh
node bin/foundry.mjs run examples/hello.json --input '{"name":"Raed"}' --workspace /tmp/fdemo
node bin/foundry.mjs serve --workspace /tmp/fdemo --port 4177   # visual UI

# audit: recompute what a run's hash chain binds (journal rows, decisions, verdict inputs,
# executor transcripts); exit 1 on any edit. `run` and `inspect` print the chain-head anchor.
node bin/foundry.mjs verify-run RUN_ID --workspace /tmp/fdemo \
  --append-anchor /abs/path/outside/workspace/anchors.jsonl     # keep the head outside the DB
node bin/foundry.mjs verify-run RUN_ID --workspace /tmp/fdemo --check-anchors /abs/path/anchors.jsonl

# run state is per-node rows (src/run-rows.mjs); a workspace written by the earlier whole-run
# store still opens, and its runs are split into rows by their first write or all at once:
node bin/foundry.mjs migrate-store --workspace /tmp/fdemo
```

Install the skills and MCP into a task project. The client can be `opencode`,
`claude`, `codex`, `cursor` or `generic`. Add `--dry-run` to preview.

```sh
node bin/foundry.mjs install --project /abs/path/to/project --client opencode
```

Model-backed generation (free OpenCode models only, never a paid fallback):

```sh
node bin/foundry.mjs generate --task "$(cat examples/batch-task.md)" --domain software \
  --agent opencode-free --model opencode/ling-3.0-flash-fin-free \
  --suite examples/batch-suite.json --rounds 3 --workspace /tmp/fdemo
```

The onboarding app (cards, the local page and the coding-agent connection; development build in this
branch, see [research/onboarding-20261021/DESIGN.md](research/onboarding-20261021/DESIGN.md)) has
its own entry point, `app/cli.mjs`. Nothing in it calls a model unless `--builder` names one.

```sh
npm ci --ignore-scripts --no-audit --no-fund   # the agent connection needs @modelcontextprotocol/sdk
node app/cli.mjs open                  # starts the page (or opens the one already running) on 127.0.0.1
node app/cli.mjs connect               # prints the one line for Claude Code, Codex or Cursor
node app/cli.mjs doctor                # what works on this computer, in plain words
node app/cli.mjs check-evidence FILE   # re-checks an evidence file's chains on its own
```

Construct a workflow (a model, or you, following `skills/foundry-construct/SKILL.md`), then gate it before running:

```sh
node bin/foundry.mjs validate my-flow.json
node bin/foundry.mjs lint --fail-on error my-flow.json      # acceptance must gate on evidence
node tools/sizing/plan.mjs --probes probes.json --units 5000 --budget 20 --recall 0.95   # size a fan-out from probes
```

A large fan-out proves its coverage with a `verify` node of `method: "ledger"` (see the exemplar
`skills/foundry-construct/exemplars/partitioned-audit.json`). The laptop inspection kickoff is
[docs/laptop-agent-kickoff.md](docs/laptop-agent-kickoff.md).

Run `node bin/foundry.mjs help` for the full CLI, which also covers trials,
repair requests, `outcome-*` commands, `construct-*` experiments, evaluate,
propose/apply and export. The repair walkthrough is in
[docs/OUTCOME-REPAIR.md](docs/OUTCOME-REPAIR.md).

## Repository map

| Path | What it is |
|---|---|
| `bin/foundry.mjs` | CLI entry point (`doctor`, `run`, `cancel`, `stop-all`, `serve`, `mcp`, `install`, `generate`, `outcome-*`, …). |
| `src/` | Runtime, store, validator, capabilities, MCP and HTTP servers, generator, providers, construction and outcome modules. Overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). |
| `schemas/workflow.schema.json` | The workflow IR contract. |
| `policy/models.json` | Owner model policy: the only source of model ids, classes, prices and the spend rule. |
| `scripts/setup-node24.sh` | Idempotent, sha256-checked install of the pinned Node 24.21.0. |
| `skills/` | Portable `SKILL.md` packs: construction, runtime, steering, evaluation, components, domains (software, browser, SRE, security, science, robotics, healthcare). |
| `web/` | Visual workflow UI served by `foundry serve`. |
| `app/` | Product-surface spike (2026-10-21, development): an MCP server, a read-only dashboard over real run journals, and an n8n importer over the unchanged engine. Proposals are version-bound, a practice run is required before approval, and a person approves through a channel the model cannot act on. Design: [research/surface-20261021/DESIGN.md](research/surface-20261021/DESIGN.md). Tests: `node --test --test-concurrency=1 app/test/*.test.mjs`. |
| `tools/` | Developer tools, such as the read-only run-viewer prototype `tools/run-view/` and the tier-0 human-task form sidecar `tools/ui/` (G21: forms compiled from `answerSchema`, the OpenUI-shaped `formState` adapter, host re-validation). |
| `beds/` | Task families (Tier A) and sealed families, with independent oracles and `AUDIT.md` files. Contract: `beds/CONTRACT.md`. |
| `experiments/` | Experiment runners and analyzers: `p1/`, `c0/`, shared `lib/`, hand-written `workflows/`, `kev-data/`, `replicate/` (R-bench pilot). Run data lives in `experiments/runs/`. |
| `examples/` | Hand-authored example workflows and the batch task/suite. |
| `tests/` | `node:test` suite: regressions, adversarial audits, opt-in integration lanes. |
| `evals/` | Actual-TUI harness, evidence gate and incident oracle. See [evals/README.md](evals/README.md). |
| `research/manifests/` | Pinned corpus acquisition ledgers and protocol-adapter evidence. |
| `research/dossiers/` | Source-bound deconstruction dossiers (software/browser, SRE/security, science/robotics/healthcare, protocol adapters, existing ARC). |
| `research/*.mjs` | Acquisition, evidence builders/verifiers, release and fresh-install qualification. |
| `research/env-20261006/` | Environment probe (`research/env-probe.mjs`): Node, sandboxing, Docker, browsers, network, credential names, models. |
| `research/PREREGISTRATION-TEMPLATE.md` | Template every comparative experiment fills and commits before its first run. |
| `research/checkpoint-20260917/` | Last research checkpoint: report, one-page summary, evidence hashes. |
| `research/recheck-20261006/` | Raw test output from the 2026-10-06 re-verification. |
| `research/core-20261006/` | Phase 1: design, P1 pre-registration, [P1 report](research/core-20261006/REPORT.md) and its diagnoses. |
| `research/construction-20261006/` | Phase 2 (C0): design, dev pre-registration, [C0 dev report](research/construction-20261006/REPORT-dev.md), diagnoses and artifacts. |
| `research/review-20261007/` | Design review: [synthesis](research/review-20261007/00-SYNTHESIS.md), [amendments](research/review-20261007/ROADMAP-AMENDMENTS.md), lane reports 01–07 and two critiques. |
| `research/corpus-20261006/`, `research/replicate-20261008/`, `research/kev-20261007/`, `research/distill-20261007/` | Workflow corpus and coverage; R-bench selection; Kev dossier and judge program; C1 design. |
| [docs/THESIS.md](docs/THESIS.md) | **Why and what**: the problem in Oct 2026, design principles, what is and isn't novel, typed judgments (Jev), fit with ARC/AMP, owner decisions. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | **How**: component specs, verification program, phased plan, cloud kickoff prompt. |
| `research/landscape-20261006/` | The eleven research reports (R01–R11) behind THESIS and ROADMAP, every claim tagged verified or recalled. |
| [docs/RESEARCH.md](docs/RESEARCH.md) | **Research log**: thesis, ARC/AMP/Neural Core relation, experiment ledger, failure→fix chains, unproven claims. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Working architecture contract and module overview. |
| [docs/REPAIR-LIFECYCLE.md](docs/REPAIR-LIFECYCLE.md) | Draft trials, version-bound repairs, exact delivery, and their UI. |
| [docs/OUTCOME-REPAIR.md](docs/OUTCOME-REPAIR.md) | Outcome contracts, observation, repair and historical inspection. |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Package boundary, installer, MCP config shapes, restore. |
| [docs/SOURCE-COVERAGE.md](docs/SOURCE-COVERAGE.md) | What the corpus covers and how deeply it was inspected. |
| [AGENTS.md](AGENTS.md) | Working rules for agents in this repository. |

## Archives and history

Everything not kept in git is in two releases on this private repository:

| Release | Asset | Contents |
|---|---|---|
| `archive-20261006` | `corpus.tar.zst.part-00`, `-01` | 3.8 GB: the 50 pinned third-party source repos (`corpus/`) that the manifests and dossiers cite. |
| | `run-data.tar.zst.part-00` | 566 MB: `evals/runs/`, `.foundry/`, `research/product-demo/runs/`, `research/reference-swe/runs/`, `web/artifacts/`. |
| | `research-history.tar.zst` | 110 MB: the full Grok research stack (Sep 13–17 consequence study, recovery, vendor), the Sep 13 demo project, and the 2026-10-06 Codex recovery workspace. |
| | `conversations.tar.zst` | 117 MB: the Grok, ChatGPT and Codex conversation logs about this project. Detected credentials are replaced with `[REDACTED]`. |
| | `SHA256SUMS` | Checksums for the assets above. |
| `evidence-20261006` | `workflow-foundry-evidence-20261006.tar.gz` | 57 MB: a scrubbed, curated subset of the research evidence, with a per-file inclusion manifest in git history. |

Rescued 2026-10-28: 16 branches (117 commits) that lived only in this container's worktrees, unreviewed and unmerged, are git bundles in [research/session-20261028-rescue/](research/session-20261028-rescue/README.md), whose README lists each branch and how to restore it.

Restore from the repo root:

```sh
gh release download archive-20261006 -D ~/wf-archive && cd ~/wf-archive && sha256sum -c SHA256SUMS
cat corpus.tar.zst.part-* | zstd -d | tar -x -C ~/Projects/workflow-foundry      # -> corpus/
cat run-data.tar.zst.part-* | zstd -d | tar -x -C ~/Projects/workflow-foundry    # -> run dirs
zstd -d < research-history.tar.zst | tar -x -C /some/dir
```

Git history keeps every deleted document, including the long-form friend handoff,
the per-campaign result files and the full recovery archive. Look at the commits
before the restructure.

## Boundaries

- Foundry boundaries apply only to operations routed through Foundry. Installing
  the MCP does **not** sandbox the agent or remove its shell or other tools.
  Consequential deployments need enforcement at the real tool/OS boundary.
- Every workflow and run is bound to an exact hash. Proposals are version-bound and
  delivery rejects old-proposal/new-run mixtures. Ambiguous non-idempotent effects
  become `uncertain`. They are never blindly retried.
- Independent task qualification lives outside the generated workflow. A locally
  passing assertion is not task success.
- No paid models, no hidden retries, no alternate accounts. Provider HTTP 429
  pauses the generator.
- Real browser, repository, production, clinical, lab or robot work needs real
  domain capabilities and external controls. The built-ins are bounded JSON/text
  operations, scoped artifacts and a labeled incident simulator.
- The package is `private` and unpublished. The research corpus is never bundled.
  This repository is private.
