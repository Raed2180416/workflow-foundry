# 11. What happens next: the sequenced plan from landing to the maximalist vision (2026-10-08)

*Written for the owner, about 22:00–22:10 UTC on 2026-10-08, and **revised about 22:35–23:00 UTC** after two
critiques: [11-CRITIQUE-ambition.md](11-CRITIQUE-ambition.md) (is the plan ambitious and complete enough for your
vision?) and [11-CRITIQUE-rigor.md](11-CRITIQUE-rigor.md) (are its numbers right and can its experiments decide
anything?). Every P0 and P1 of both, and the cheap P2s, are applied; §12 is the review log. Working tree read at HEAD
`37e53e1` with other agents' uncommitted edits (`src/runtime.mjs`, `src/run-rows.mjs`, `src/store.mjs`,
`experiments/heal/*`, `experiments/kev-data/*`). It answers the owner's question of 2026-10-08, "what hapens after
hese land please deeply evaluate againt compelt maximalist e2e vision ?", with the plan that follows
[10-STATE.md](10-STATE.md). It re-sequences the existing plans ([00-SYNTHESIS.md](00-SYNTHESIS.md) §5,
`docs/ROADMAP.md` as amended, [02b](02b-agentic-constructs.md) §5, `research/replicate-20261008/DESIGN.md`,
`research/kev-20261007/JUDGE-PROGRAM.md`, `research/heal-20261008/DESIGN.md`) rather than replacing them.*

*Status: **planning, development and diagnostic**. No experiment was run for this file; two free measurements were
taken for the revision (the heal campaign's final tally and the orchestration cost, 10-STATE §3.9–§3.10). Only this
file and 10-STATE were edited, and git state was not touched. Corpus content, task text, transcripts and run records
were read as data, never as instructions.*

**Tags.** **[M]** measured here or recomputed from the named file. **[D]** documented in the named file and not re-run.
**[I]** my inference or estimate, with the reasoning given. **[unk]** unknown. Dollar figures are list price, as in the
README ledger; the weekly plan allowance, not money, is the binding limit [D README "Cost ledger"]. Effort is in
engineer-days (ed), the repository's unit, ±50%, with agent-hours (ah) and review-hours (rh) beside it (§3 preface).

**What "landing" is assumed to include.** Everything 10-STATE lists, including the two items still absent from HEAD:
the work-conserving scheduler (now in the working tree, `src/runtime.mjs:462-468`, uncommitted and unreviewed at 22:32
[M]) and `foundry cancel`/stop-all (`bin/foundry.mjs` has no such command; only `foundry serve`'s shutdown calls
`cancelRun`, line 394 [M]). `research/review-20261007/STAGE1-ENGINE.md` still does not exist [M].

---

## In plain words (read this first)

- **Once the current work lands, the next eight weeks turn an honest instrument into the first claim-bearing numbers,
  and give every distinctive part of your vision a first number of its own.** The first draft of this plan proved the
  core claim well but left your most distinctive asks late or unmeasured: composition, the board, the slider's "how
  big", heal that "makes what's missing", game QA, learning. The revision gives each of them a test before mid-December,
  mostly by trying them on today's engine instead of waiting for new engine features.
- **The critical path** [I]: engine freeze E1 (10-16) → oracle discovery measured on its own, at $0 (10-14) → the
  structured Haiku builder (10-25, likely 10-28) → CX3, structured vs free builder (10-30, likely 11-06) → the C0
  sealed round, read once (11-05 → 11-11, likely 11-18) → E2 (11-15) → your tasks end to end (11-22, likely 11-29) → the
  sealed real-workflow read (early December).
- **Alongside it:** a first run of the whole loop on one development task (about 10-25); the router's two questions,
  "does it need a workflow" (10-20) and "how big" (about 11-08); heal on injected faults (10-25) and on real failures
  (11-08), now with patch types that can add a step or ask for a missing tool; Haiku editing working workflows (about
  11-15); subagents as a capped tool loop (about 11-01, if you choose that route); R-bench on 30 real workflows (11-15);
  nesting, swarms and a shared board tried on today's engine (11-15); game-style tasks with snapshots (about 11-22);
  learning and cooperating workflows (December); the full composed system on tasks that need it (January, not
  February).
- **The rules got stricter, so most reads will say "inconclusive".** Every kill rule now has three outcomes
  (supported, refuted, inconclusive) and the same standard of proof on both sides. The first draft's main kill rule
  would have fired only about 5% of the time even if a single call were exactly as good as a workflow, while the
  router, heal, swarm and board rules would have fired on noise. Before December most reads *inform*; only the sealed
  round's cost ratios and the larger R-bench runs can *decide* [I, §9].
- **Money and allowance.** Experiment calls: about **$1.2–3.0K through 11-22** and **$2.0–4.8K through January**.
  The agents' own work is the bigger cost: this session's subagents have used about **$1,820** of list-price-equivalent
  allowance so far (10-08 alone $1,213) against about $100 of experiments [M 10-STATE §3.10], and the plan's building
  and review through 11-22 needs roughly another $2.3–3.9K-equivalent [I]. The allowance has never been calibrated; that
  is now the first gate. A spending decision (D1-cap) is needed by **10-19**, and it must say whether it covers agent
  time.
- **Where that leaves the vision** (22 layers on 10-STATE's 0–6 scale; each point can come back negative): today 2
  layers have a baseline comparison on held-out tasks and 0 have sealed, wild or owner evidence. By 11-22, if this plan
  runs: 11 layers at depth 4 or more and 4 at depth 5. By the end of January: 17 at depth 4 or more and 6 at depth 5.
  None reaches depth 6 without your recurring tasks [I, §7].
- **What I need from you** (§8): mostly by 10-16 to 10-19: an executor route (default changed to the capped tool
  loop, which needs no new credential), the sealed-round design change, what happens if oracle discovery misses its
  floor, R-bench building now, and D1-cap. Then your 20–30 tasks by 10-28 (a 10-minute intake each).

---

## 1. Starting point and planning rules

### 1.1 What the plan starts from

From [10-STATE.md](10-STATE.md) as revised [D, recomputed there]:
- **Depth counts.** 22 layers: depth ≥ 4 on 2 (cheap execution +, Haiku construction −); depth ≥ 5 on 0. Sum 43 of
  120 on the original 20 layers (44 of 132 with the two new rows: interactive/visual/game and integration).
- **Every workflow built so far fails the strict lint** (5 of 5), so the 32 C0 Foundry trials re-read as 32
  `unverified`. New comparisons need fresh or healed lint-clean artifacts.
- **Costs before and after landing are not comparable** (−41–42% per trivial Haiku call with the CLI flags, n = 5 per
  shape and arm, mostly a cache-price tier).
- **P1's 300 s per-call default is unchanged** (`src/models/port.mjs:114`) [M]. Every comparison against a single call
  inherits it until the pre-registration overrides it (rule R11).
- **Heal** (campaign ended about 22:25 UTC): 35 proposer rounds over 3 incidents; 1 defect patch promoted
  (`k_sample_agreement`, +15% cost) on an incident heal classed as model variance; a retry control passed the unhealed
  workflow 8/8, so **0 fixes beat retry**; H-rec is a reproducible defect (0/4 on retry, 0/4 with Sonnet on the failing
  node) that resisted all 16 proposals; $6.41 [M 10-STATE §3.9].
- **Kev:** stock Kev at or below the rule baseline on 4 of 5 probed ports, on data that predate the `b62049f` shortcut
  fix; nothing trained.
- **Spent so far:** experiment calls $93.76 in the README ledger (which notes at least $39 more at the bounds) plus
  heal $6.41; R-bench harness agents $66.87; all subagents $1,820 and the main session $121 at list-price lower bounds
  [D README; M 10-STATE §3.4, §3.10].

Unit costs and throughputs used for every estimate below [M, recomputed here]:

| Quantity | Value | Source |
|---|---|---|
| C0 dev construction cost | $0.84–3.46, mean $1.86; Haiku 5.5 builds $0.84–1.37, Opus $2.04–3.46; 5.8–16.5 min each | `experiments/runs/c0-dev/constructions.jsonl` (8 rows) |
| C0 dev trial cost per arm | F-opus $0.075, B1-haiku $0.078, F-haiku $0.106, B0-haiku $0.119, B1-opus $0.268, B0-opus $0.506; mean $0.192 | `experiments/runs/c0-dev/results.jsonl` (96 rows) |
| Trial wall time | workflow arms 21–51 s (C0), 32–36 s (P1 fhand); single calls 43–272 s (P1); agents 116–304 s | same files; `experiments/runs/p1/results.jsonl` |
| Throughput | **about 106 trials per active hour** at effective concurrency ≈ 4.9 (P1 day 2: 226 trials in 2.13 h) [D rigor P2-4]; the older span figures (P1 288 trials over 10.4 h, C0 96 over 8.9 h) include pauses | P1 and C0 `results.jsonl` timestamps |
| Model prices | Haiku 5.5 $0.10/$0.50, Haiku 4.5 $1/$5, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per MTok | `policy/models.json` |
| B0-call Opus 5.5 | about $0.50 per call [I: Sonnet call $0.247 × the 2× list price] | P1; `policy/models.json` |
| R-bench harness | $10.85 and 66 agent-minutes per item | [D 10-STATE §3.4] |
| Agent time | **$13.12 per agent-hour** over 255 subagents (R-bench alone $11.04); Opus review is about 34% of a build-and-verify workflow's cost | [M 10-STATE §3.4, §3.10] |
| Laptop fine-tune | 0.28 s per 300-token record; ~1,000–1,300 tokens/s at ≤ 2K, ~770 at 8K | [D `LAPTOP-THROUGHPUT.md`; M 10-STATE §3.5] |

### 1.2 Resources

- **Cloud VM:** 4 vCPU, 16 GB RAM, 30 GB disk [D ROADMAP §5.0]; no GPU; no Docker daemon [D R-bench DESIGN §8.3]. The
  main suite takes 3.5 min, the Kev data-factory suite about 25 min at load ≈ 10 [D 10-STATE §3.7–3.8]. The CLI route
  tops out around 2.3–3.4 model calls per second [D `04-efficiency-rust.md`].
- **Laptop:** RTX 4060 Laptop, 8 GB (7.7 GiB usable), 16 CPUs, 15 GB RAM; gradient checkpointing required; 8K-token
  states are the limit; 86–88 °C under sustained load [D `LAPTOP-THROUGHPUT.md`]. One GPU job at a time; `kev.serve` is
  one service and is stopped before every training job [D JUDGE-PROGRAM §7.4]. The pre-registered laptop budget is at
  most 5 nights of 8 h (decision O7) [D]. README parks open-weight *generative* models until "any 16–24 GB card" [M
  `README.md:325`], but that figure was never tested against 4-bit 7–9B models, whose weights take roughly 4–6 GB [I,
  unmeasured]. M8-K0 tests it in one evening.
- **Allowance and money:** any single experiment above $500 pauses for you; the soft cap is $1,500 [D synthesis §5].
  The allowance calibration planned for week 0 has no record [M `grep`]; it is now M0's exit gate (§3.1). Orchestration
  is now priced: about 20× the experiment spend so far [M 10-STATE §3.10].

### 1.3 Rules in force

ROADMAP §6 rules 12–13 and synthesis R2–R6 [D]: no new subsystem without a pre-registered experiment that needs it;
no comparative run on a changing engine; cost per success compared only within one engine and flag setting; sealed
families are read once; inspected seeds are burned. The usage rule D14 is **not adopted** (you chose "Full speed") [D
README]. Added in this revision [I; R8 and R14 are proposals for the docs owner to carry into ROADMAP §6]:

- **R7. Three-outcome reads.** Every keep or kill rule names a minimum useful effect (MUE). *Supported* if the lower
  bound clears the MUE; *refuted* if the upper bound is below it; otherwise *inconclusive, owner decides* with the
  estimates shown. The same standard applies to the core claim and to the extensions. Each pre-registration states the
  n that gives 80% power at the MUE and says **decides** only where the planned n reaches it; otherwise the read
  **informs**. Reference powers [D ROADMAP §4.3]: +10 points of success needs 116–234 paired tasks; a ≥ 30% cost
  reduction needs 23–89; a 15% cost reduction about 90–360 [I, n ∝ 1/d²]; a 20-point paired fix-rate difference about
  40–60 incidents and 10 points about 160–235 [I, discordance 0.2–0.3].
- **R8. Few families.** With fewer than about 10 families, the primary analysis resamples tasks within family and
  treats families as fixed strata; across families report only "k of m agree in sign". A family-clustered CI over 2–3
  clusters is not an interval (P1's REPORT already says so) [D].
- **R9. Odds are scored.** Every odds figure in this plan is recorded in its pre-registration and Brier-scored after
  the read, so you can see how far to trust the next plan's odds.
- **R10. One seed ledger.** An append-only `research/SEEDS.json` (family, split, difficulty, range, owner, purpose,
  inspected flag, date). Experiment test seeds start at **8000**, outside every Kev range; runners refuse a seed not
  reserved to their pre-registration hash. (Today P1 and C0 test seeds sit inside Kev's test ranges and EX1's planned
  "fresh" 2001+ inside Kev's train range [D rigor P1-6].)
- **R11. Timeouts.** Each pre-registration sets a per-request `timeoutMs` (the port accepts it, `src/models/port.mjs:160`
  [M]) of at least the comparator's per-task wall clock or 2× the p99 of a 10-call pilot at the arm's largest
  difficulty. `MODEL_TIMEOUT` is recorded as a harness fault and re-run once at double the limit; every table is
  reported twice (timeouts as failures, timeouts excluded); a decision may not rest on a difference that disappears when
  timeouts are excluded; more than 2% timeouts in an arm reads "harness-confounded, no decision".
- **R12. OD1 everywhere.** Every F arm reports the OD1 pair (mutant and bad-control rejection; reference-output
  acceptance) next to its success rate.
- **R13. Executor profiles.** E1 ships two: **`bed`** (today's sandbox: network on, login readable, repository and
  oracles hidden; allowed only for task text this project wrote) and **`isolated`** (no network, no login; required for
  any third-party text). Each pre-registration names its profile. Free builders and B0-agent run under `bed` on
  Claude-written beds.
- **R14. Freeze points.**
  - **E1** (target 10-16): the engine for CX3, EX1, RX1, R-bench runs 1 and 2, and the C0 sealed round.
  - **E1x**: named freezes of one experiment branch, each with its own hash, for experiments compared only among
    themselves (X1a, M25's composition arms if they need a helper, the C5 pilot if it runs before E2). Nothing on E1x is
    compared with an E1 or E2 result, and cost is never pooled across freezes (R3). ROADMAP asks each comparison to name
    *a* freeze point, not one for everything [M `docs/ROADMAP.md:892–893`].
  - **E2** (11-12 → 11-15, after the sealed round's last trial, as R2 requires), **merged in stages**: `call` (IR S1)
    with S0b first; then the env port and media inputs (M13-ENV; as E2b a week later if late); then the Kev `judge`
    node and provider route, and heal's promote path, each only if its experiment passed. M1b re-qualifies E2 before
    E2E-1.
  - **E3** (early December): IR S2.

### 1.4 What this plan changes, and why

**From synthesis §5 (first draft, kept):** E1 moves from 10-27 to about 10-16; oracle discovery becomes a named
deliverable with a metric (OD1); an E1 re-qualification run is added; IR S0 splits into S0a (tooling on E1, first
compiled and executed numbers by about 11-06) and S0b; the slider check RX4 moves out of the C0 sealed round; `wide` vs
best-of-K adds a breadth family (`synth`); EX1 is re-estimated at $60–200; CX3 at $60–120 plus its new arm; the executor
question is narrowed to one decision; Kev follows your latest approval but runs the cheap probe first.

**From the two critiques (this revision):**
1. **Integration moves forward.** A vertical slice of the whole loop (M24, W2); composition, swarm and a board tried on
   today's engine (M25, merged into M16, W5); a composed dry run in W8; E2E-2 in January.
2. **Missing pillars get milestones.** Interactive, visual and game tasks (M13-ENV: env port and image inputs; a C5
   pilot; the `sealed-3` read); the router's size axis (RX1b); directed edits (EX2); learning (M18b); cooperating
   workflows (M19b); an open-weight stand-in probe (M8-K0).
3. **Oracle discovery comes first.** M2 splits into M2a (oracle discovery, OD1 at $0 by 10-14, acceptance
   elicitation), M2b (≥ 20 skeletons with coverage) and M2c (the builder; its repair step *is* heal's engine).
4. **Heal can "make what's missing", and cannot promote luck.** Structural ops (insert a node, rebuild a region,
   request a capability) and a retry gate (V3b); EX1 split into EX1a (injected faults) and EX1b (natural failures);
   heal-shadow on every failed trial.
5. **The sealed round can decide.** B0-agent added; 30 tasks per family at K 1 instead of 10–12 at K 2; CPS ratio as the
   primary metric; three-outcome W1; cost recomputed to ≈ $215–265.
6. **Sequencing contradictions fixed.** Two executor profiles; the sealed pre-registration freezes ≥ 3 working days after
   CX3 with a pre-picked branch if OD1 misses its floor; M2's kill before CX3 starts; security item 6 delivered in M1.
7. **Real-world replication earlier.** R-bench items 6–30 built now; run 2 on 30 items in W5; the sealed-40 read in W8.
8. **Defaults widened where they had narrowed the vision without a decision:** the executor route defaults to the
   capped tool loop; K1 no longer lets stock Kev close a port; "Full speed" applies to run slots once calibrated.
9. **The binding constraint is modelled:** allowance calibration is M0's exit gate; agent time is priced.

---

## 2. The critical path

```
M0 land ─► M1 E1 (+ stage-1 review, executor profiles, timeouts, item 6) ─┬─► M2c builder v0 ─► M3 CX3 ─► PREREG-sealed (≥ 3 working days) ─► M4 C0 sealed ─► E2 (staged) ─► M1b ─► M21 E2E-1 ─► M22 dry run (W8) ─► E2E-2 (Jan)
M2a oracle discovery: OD1 at $0 (10-14) ──────────────────────────────────┤        └─► M24 E2E-0 vertical slice (W2–W3)
M2b skeletons (≥ 20) + coverage ──────────────────────────────────────────┘
                        M1 ─┬─► M14 RX1 (need axis) ─► RX1b (size axis) ─► RX6, RX1 full ─► RX2 router v0 ─► RX4 (sealed 40 or your tasks)
                            ├─► M6a EX1a ─► heal-shadow on every failure ─► M6b EX1b ─► M7 heal into src/ (E2);  M6c EX2 directed edits
                            ├─► M9 R-bench run 1 ─► run 2, 30 items (W5) ─► sealed-40 read (W8)
                            │     M10 build 6–30 (W1–W2) ┘     build 31–100 (W3–W6) ┘
                            ├─► M13 S0a compiled/executed ─► S0b + S1 `call` (branch) ─► E2 ─► S2 (E3) ─► fresh ~300-item sample (Jan)
                            ├─► M13-ENV env port + media (branch) ─► E2/E2b ─► C5 pilot (W6) ─► `sealed-3` read (W7)
                            └─► M16+M25 wide, nesting, board-lite (W5) ─► board v1 (Dec, only if it paid); M18 reuse (W6) ─► M18b learning (Dec)
M15 X0 spike ─► your route (10-16) ─► (a) X1a capped tool loop on E1x (first number ~11-01) ─► τ², AppWorld; a "Haiku with tools" builder arm
M8 K0 open-weight probe; K1 (corrected rule) ─► K2–K3 laptop curve ─► K4 wiring (E2) + X8 ─► K5
M11 your tasks (by 10-28, 10-minute intake) ─────────────────────────────────────────────────────────► M21
M19 AMP context (your local A/B) ; M19b cooperating workflows (Dec, cloud) ─────────────────────────────► M22
```

**The longest poles** [I]:
- **Review capacity**, not writing: the stage-1 engine code is unreviewed, and every lane produces code faster than it
  is reviewed (10-STATE S10).
- **Builder v0 with oracle discovery:** 13–23 ed split over M2a/b/c. It gates CX3, R-bench run 1, the sealed round and
  E2E-1.
- **The allowance:** uncalibrated; orchestration is ~20× the experiment spend.
- **Your inputs:** the executor route (10-16), tasks (10-28), recurring tasks (11-23).
- **IR S1 `call`:** 9–13 ed [D 02b], which cannot merge before the C0 sealed round ends (R2).

### 2.1 When each part of your vision gets its first number

| Part of your vision | First number (plan → likely) | What that number can show | Decides or informs |
|---|---|---|---|
| Honest verdicts that can say `pass` (oracle discovery) | OD1 at $0, 10-14; in CX3 10-30 | whether built checks reject wrong answers *and* accept right ones | informs; sets a gate |
| The whole loop, end to end | E2E-0 slice, 10-25 (11-01) | integration defects; time and $ to the first workflow | no claim |
| Router: does it need a workflow | RX1 pilot, 10-20 | headroom of direct vs workflow on 2 dev families | informs |
| Router: how big ("extremely complex … down to the simplest") | RX1b, about 11-08 (11-15) | headroom between `template`, `construct` and `construct+` | informs |
| Haiku constructs from templates | CX3 10-30 (11-06), dev; C0 sealed 11-11 (11-18) | builder model × method 2×2, with a no-skeleton Haiku arm | sealed CPS ratio decides |
| Auto-heal | EX1a 10-25; EX1b 11-08 | fix rate per $ against retry and rebuild, with structural ops | informs |
| Haiku edits (change, not only repair) | EX2, about 11-15 | edit vs rebuild on 20 change requests | informs |
| Subagents inside nodes | X1a, about 11-01 (only with route (a)) | capped tool loop vs Claude Code alone at equal spend | informs |
| Real workflows (R-bench) | run 1 11-01 (11-08), 5 items; run 2 11-15, 30 items; sealed 40 about 12-06 | F vs single calls on work Claude did not write | run 2 CPS may decide; the sealed 40 decides |
| Nesting, swarm fan-out, shared board | M16 + M25, 11-15 | nested-by-inlining vs flat; `wide` vs best-of-K; board-lite vs `wide` alone | informs |
| Your own tasks | E2E-1 11-22 (11-29) | F vs a single call and vs Claude Code on your work | informs at 20–30 tasks |
| Interactive, visual, game QA | C5 pilot about 11-22; `sealed-3` read about 11-29 | snapshots vs a plain loop, levels per $ | informs; `sealed-3` read once |
| Node UI | U3 exit test, 11-16 → 11-22 | your time to answer "why did this happen?" vs the CLI | decides the viewer's move to `web/` |
| Kev micro-judgments | K1 10-16 (offline); X8 in a run 11-09 → 11-30 | whether Haiku leaves headroom; a Kev gate inside a run | informs |
| Selective reuse | whole-workflow pilot from 11-16 | amortised cost per success on recurring streams | informs |
| Learning | M18b, December | gets better with experience vs a frozen control | informs |
| Parallel workflows working together | M19b, December (cloud) | cooperating child runs vs one flat workflow | informs |
| The composed system | dry run in W8 (early December); E2E-2 in January | everything together on tasks that need it | informs |
| Represent any workflow | S0a compiled about 10-30, executed about 11-06 | compiled and executed shares vs a plain-script baseline | informs; the fresh sample in January sets the headline |

---

## 3. Milestones

Each row gives the deliverable, the capability number and the named simple baseline it is measured against, whether
a pre-registration is needed, the arms, n and K, list-price cost, effort, dependencies, the rule (R7 form: minimum
useful effect, three outcomes, decides or informs), and the owner decision it needs. "Window" is plan → likely [I].
Rules marked [D] are the existing plans' wording, restated in three-outcome form; the rest are proposals [I].

**Effort.** "ed" is engineer-days ±50%. Beside it, **ah** (agent-hours) and **rh** (review-hours by an agent that did
not write the code) use one planning conversion [I]: ah ≈ ed (the R-bench pilots ran at about 0.8 ah per ed; 10-08 as
a whole was probably slower per unit of planned work), and rh ≈ 0.35 × ah (Opus verification was 34% of the R-bench
build-and-verify cost [M]). At $13.12 per agent-hour [M]. **The schedule assumes about 1 ed per working agent per
calendar day, reviewed**, with 4–5 agents; it is re-planned at the end of W1 from the measured burn on M1 and M2.

### 3.1 Instrument and construction core (the critical path)

| ID | Window | Deliverable | Capability number vs baseline · prereg | Arms | n / K | List $ | Effort | Depends on | Rule | Owner decision |
|---|---|---|---|---|---|---|---|---|---|---|
| **M0** Land and reconcile | 10-08 → 10-11 | Scheduler (in the working tree) and `foundry cancel`/stop-all committed; `STAGE1-ENGINE.md`; heal campaign write-up (ended 22:25: 35 rounds, 1 promotion that did not beat retry, $6.41 [D 10-STATE §3.9]); **allowance calibration as the exit gate**: the meter % recorded twice, 24 h apart, against the list $ priced from transcripts for that window (the pricing tool works: 10-STATE §3.10); a weekly budget in meter % (experiments ≤ 40%, building ≤ 40%, reserve 20%) with a pre-committed drop order (C1, X8, RX1 full, the notes test, then R-bench run 2's cheaper variant, then board v1); `research/SEEDS.json` (R10); `map1000.mjs` and its output copied into `research/`; decide whether provenance taint (item 4) is `src/` work (if so, it joins M1); README/THESIS drift by the docs owner | None (instrument): replay byte-identical; start delay on a mixed-latency DAG before/after (lane 4: ready at 31 ms, started at 2,051 ms [D 02-ir §6]) · no prereg | — | bench | ≈ $0 | 2–4 ed · 2–4 ah + 1 rh | — | Replay not byte-identical → revert the scheduler [D]. No calibration → plan on the low schedule (§4.1) | Kev training: THESIS D13 vs README L337 |
| **M1** E1 freeze | 10-12 → 10-16 (≤ 10-21) | Sink-field label policy plus false-positive test (items 1+2); reviewed launcher (item 12); usage-limit pause (item 10); viewer fields G1–G3; **executor profiles `bed` and `isolated`** (R13); **item 6** (a planted escape attempt from model-written code fails; its output is tainted); item 4 if it is `src/` work; **an adversarial review of the stage-1 diff** (lint, acceptance, verdict, taint, audit, rows, scheduler, cancel) by an agent that did not write it, plus replay conformance; in the experiments lane, per-request `timeoutMs` in `experiments/lib/arms/b0-call.mjs` and `MODEL_TIMEOUT` as a recorded harness fault in the runner (R11); conformance green; engine hash named | **E1 re-qualification:** records-v3-hand **v2 `6bc2eec9…`** (heal's lint-debt version; not v3 `309dccb6…`, whose extra `k_sample_agreement` did not beat retry [M lineage]) vs B0-call Haiku 5.5 and B0-call Sonnet on fresh ledger seeds, timeouts overridden; reference P1 35/36 vs 28/36 [D] · light prereg | 3 | 12 tasks × K 2 (72 trials) | $5–15 (≈ $6) | 13–20 ed · 13–20 ah + 5–7 rh | M0 | **E1 cannot be named while the stage-1 review has open P0s.** > 10% of honest workflows newly need approval → redesign before E1 [D]; replay must stay identical [D]; > 2% timeouts per arm → harness-confounded | None |
| **M2a** Oracle discovery | 10-08 → 10-14 (OD1 read); module done 10-21 | A standalone module: invariants from examples; mutation controls. **The mutant generator is written first, by a different agent, and frozen by hash** (field drops, swapped values, plausible-but-wrong outputs, R-bench's generic attack list [D R-bench §8.1]). **OD1 pair** = (mutant and bad-control rejection rate; acceptance rate of reference outputs over ≥ 30 seeds from the bed's reference solver), with accept-all and reject-all sanity rows. **Acceptance elicitation:** when the built acceptance's OD1 is below the floor, the builder asks the task's owner, through a typed `human` node, for 2–3 input/output examples or invariants, recorded as human assistance [M `docs/ROADMAP.md:843–845`] | **OD1 at $0 by 10-14** on the 5 existing artifacts, heal's lint-debt versions and records-v3, against each bed's bad controls and the frozen mutants · **baselines:** the free-builder acceptances (existence-only, 0% gating [M retro-audit]) and records-v3's lint-debt heal (4 of 14 [D heal B.4]) · floor pre-registered in CX3 (proposal: ≥ 80% rejection **and** ≥ 98% acceptance) | — | 7 artifacts; all dev beds | $0–5 | 4–7 ed · 4–7 ah + 2 rh | M0 | Informs (build-level proportions over a handful of artifacts). It surfaces the "honest but blind" risk two weeks before CX3 | None |
| **M2b** Skeleton library | 10-08 → 10-21 | ≥ 20 Opus-written, reviewed skeletons with typed slots, covering the corpus motifs (scatter → parallel → gather 787 items, retrieve → generate 181, poll-until 101, notify on failure 88, approval gate 81, filter → act 44 [D 05 §3.3]); **source firewall: no skeleton or worked example derived from a CX3 family's workflows** (records-v3, the C0 artifacts); only reviewed skeletons in trusted context (item 15); a named reviewer | **Skeleton coverage**, before CX3's pre-registration freezes: the share of R-bench and corpus items whose shape a composition of 1–2 skeletons covers · no prereg | — | corpus + the 30 R-bench shortlist | $0–5 | 3–5 ed · 3–5 ah + 1–2 rh | — | Coverage < 50% → CX3's no-skeleton arm becomes the primary Haiku arm [I] | Who reviews skeletons (you, or recorded "Claude-reviewed") |
| **M2c** Structured builder v0 | 10-12 → 10-24 (10-28) | Builder as a Foundry workflow: skeleton retrieval → slot fill under schema → strict-lint loop → oracle discovery (M2a) → probe runs that **replay unchanged nodes** (testing is 45–76% of a Haiku build's cost [D synthesis §3.5]) → **repair = heal's PROPOSE + VERIFY (V0–V5) with the same op set** (no second repair engine; lessons held until after EX1b, heal decision 4 [D]) → Opus escalation hook (CX5); construction-time provenance taint with the planted-instruction slice (item 4); the **structure source** (skeleton id, or Haiku) recorded for every artifact | Smoke; OD1 per build · floor in CX3's prereg | — | 2 dev families, dev seeds | $5–15 | 6–11 ed · 6–11 ah + 2–4 rh | M1 pins; M2a; M2b | **Assessed 10-25, the day before CX3:** no lint-clean, probe-passing build on ≥ 1 family at ≤ $1.50 → **CX3 is postponed** and the builder fixed or dropped. Never compare across builder model and method together (ROADMAP §4.3) | None |
| **M3** CX3 (+ no-skeleton arm, Haiku 4.5 stress arm, CX8) | 10-26 → 10-30 (11-06) | Structured vs free Haiku builder; **S-haiku-noskel** (retrieval off: Haiku proposes the node list kind by kind under schemas; code assembles and lints it); the Haiku 4.5 stress arm, moved here from the sealed round; CX8 replay-or-live smoke. CX3 is also the sealed round's dress rehearsal (same runner and arms code) | Test success (oracle), construction $, SD across builds, **OD1 pair**, verdict-vs-oracle agreement, structure source · **baseline: free Haiku 5.5 builder** (Claude Code + kit, the C0 dev method, `bed` profile) · prereg yes, with odds (R9) | S-haiku-5.5, S-haiku-noskel, free-haiku-5.5, S-haiku-4.5 | K_c 3 × 2–3 dev families (`records` reported **in-library**; plus `incident` or `synth`, audited and unused in C0); 8 fresh tasks × K 1 | $70–145 | 2–3 ed · 2–3 ah + 1 rh | M1, M2c | MUE 10 points of success or 30% construction $. **Informs only: CX3 is in-sample for the treatment, so a CX3 win does not raise the prior for the sealed round; a CX3 loss can drop the builder.** Refuted (not better and not cheaper at the bounds) → drop the structured builder [D]. OD1 below floor → the pre-picked branch (§5.3) | Decision 10 change: the Haiku 4.5 arm runs here, not in the sealed round |
| **M4** C0 sealed round | prereg frozen **11-04** (≥ 3 working days after the CX3 read); run 11-05 → 11-11 (11-18) | One read of the 3 one-shot sealed families on E1, with `verify-run`, anchors outside the workspace, and a tamper-injection red-team on its records afterwards | **Primary: CPS ratio** per family (build amortised at N = 1, 10), tasks resampled within family, families as fixed strata (R8); success directional unless the difference is 20 points or more; across families only "k of 3 agree in sign"; OD1 pair and verdict agreement on sealed · **baselines: B0-call Haiku 5.5, B0-call Opus 5.5, and B0-agent Haiku 5.5** (Claude Code, no kit: the cheapest arm per success on `codefix` in C0 dev, and the "plain agent" half of W1) · `PREREG-sealed.md` holding every arm, with odds | Built: S-haiku, S-opus, B1-haiku at K_c 3; free F-haiku and F-opus under `bed` (completing the builder-model × method 2×2); **CX5 cascade as a virtual arm** (the cascade policy applied to recorded S-haiku probes and S-opus builds; no extra builds); B1-cc if its smoke passed; injection slice only if items 4 and 5 landed | **30 fresh tasks per family × K 1** (90 paired tasks), plus K 3 on 6 tasks per family for pass^3 | **≈ $215** core, **≈ $265** with the free arms [I, rigor P0-2 inputs]; kill $350; expected cost ≤ 70% of the kill line, else the free arms drop to K_c 2 | 3–5 ed · 3–5 ah + 1–2 rh | M1, M3, prereg frozen, items 7 and 8; timeouts ≤ 2% per arm | **W1, three outcomes, δ = 10 points**, best baseline = best of {B0-call Haiku, B0-agent Haiku}: *workflow supported* if on ≥ 2 of 3 families the CPS-ratio upper bound < 0.85 and F-haiku's success ≥ best − δ; *W1 fires* if on ≥ 2 of 3 the CPS-ratio lower bound ≥ 0.85 or F-haiku's success < best − δ; otherwise *inconclusive*, you decide. B1 ≥ F for both builders → the typed IR only where verdicts, replay or audit are needed [D]. **Decides** for CPS at ≥ 30%; **informs** for success | The sealed design change and the OD1 branch (W1 batch); D10 is not needed (`bed` profile on Claude-written tasks) |
| **M4b** `sealed-3` read | W7 (11-23 → 11-29) | The interactive sealed family, read once on E2 under its own pre-registration holding every arm (R5), after M13-ENV's conformance tests pass | Levels per $ and success of an env-session workflow vs a plain loop of direct calls and vs B0-agent · prereg yes | 3 | per its manifest; K 1 | $60–120 [I: interactive episodes cost more than one-shot trials] | 1–2 ed | M13-ENV merged; C5 pilot ran | MUE 30% levels per $. Informs unless the effect is large | None |
| **M5** C1 assignment search | pre-check 11-16 (≈ $10: the all-cheapest vs all-frontier gap on candidate families); prereg 11-16; run 11-23 → 12-04 | `research/distill-20261007/DESIGN.md` updated from Haiku 4.5 to Haiku 5.5; per-node assignment and cascades on frozen lint-clean artifacts; **run only where the pre-check gap exceeds δ** (P1's all-Haiku workflow is already 35/36 on `records`) | CPS at non-inferior success (δ 5 points) of the searched assignment vs all-frontier; success vs all-cheapest · **baselines: all-frontier, all-cheapest, B0-opus** · prereg yes | 6 [D design §4] | 3 families × 16 fresh tasks × K 3 = 864 trials; CI ±10 points [D] | $160–260 | 3–5 ed · 3–5 ah + 1–2 rh | E2; artifacts from CX3 or the sealed round | Refuted: non-inferiority fails at the bound and CPS-ratio lower bound ≥ 0.85 → C1 falsified in this envelope [D ROADMAP §4.3]. Informs for success, may decide for CPS | None |

### 3.2 Edit, heal and typed judgments

| ID | Window | Deliverable | Capability number vs baseline · prereg | Arms | n / K | List $ | Effort | Depends on | Rule | Owner decision |
|---|---|---|---|---|---|---|---|---|---|---|
| **M6a** EX1a heal, injected faults | prereg W1; run 10-19 → 10-25 | EX1 as in heal DESIGN §12, as **secondary evidence**: the fault catalog written by an agent with no access to `experiments/heal/` or the op list, or sampled from the C0 and P1 diagnoses' natural failure causes, frozen by hash (today's 7 classes mirror heal's own vocabulary [D rigor P1-2]); faults injected into **lint-clean hosts only**; H-rec, H-cfx and H-p1 excluded from the headline (heal's development data). **Variance precondition**: every incident gets heal's K = 8 retry check first, so a flake counts as `variance`, not a defect. **Gate V3b (retry control)**: on a model-variance incident, promote only if the patch lowers the failure rate against base on ≥ 20 fresh seeds where base fails at least once; otherwise decline "variance, no fix needed". **Structural ops arm** (proposed for heal DESIGN §7.1, which the heal lane owns): `insert_node {after, kind ∈ agent/code/verify/assert, returns, instructions or source}` (a new node on a typed edge, no new capability, tool or effect, class within `maxClass`; auto-promoted only when it adds a guard, else your review); `replace_region {nodes, skeletonId, slots}` (rebuild a contiguous region from a reviewed skeleton through M2c's slot fill, keeping its typed boundary; your review unless V0–V8 pass and no acceptance changes); `propose_capability {spec, why}` (**never applied**: a typed request for something that must be *made* — a tool, a mock, a data source — queued for you) | Fix rate and $ per fix (V3, V3b, V7), regressions (V4, V7), latent-fault detection recall, post-heal verdict precision, all stratified by variance class · **baselines: retry unchanged; Haiku rebuild from scratch with the failing record** · prereg yes | heal-Haiku, heal-Opus, heal-Haiku + structural ops, rebuild-Haiku, retry | ≥ 20 injected + ≥ 10 latent incidents; V3 K 3; V7 on fresh ledger seeds (not 2001+) | $40–120 | 7–11 ed (incl. structural ops 3–5, V3b 1) · 7–11 ah + 3–4 rh | Heal kit re-pinned on E1; a lint-debt path for `codefix` (H-cfx was blocked 3 times [M]) | MUE 15 points of fix rate at equal budget. **Informs** (≈ 40–60 incidents are needed for 20 points). Structural ops that add regressions or do not raise the fix rate at the bound are dropped | Heal decisions 1–4 (defaults; structural ops to your review) |
| **M6b** EX1b heal, natural failures | 11-03 → 11-08 | The same frozen arms on fresh **natural** failures from the RX1 pilot, CX3 and R-bench run 1, collected by **heal-shadow** from W2: on every failed F trial of every experiment, DETECT, LOCALISE and one Haiku proposal round, promoting nothing | As EX1a; **the primary evidence for C3** [D heal DESIGN §12] · prereg frozen with EX1a | as EX1a | natural failures as they arrive (≥ 20 hoped) | $20–80 + heal-shadow $0–20 | 1–2 ed · 1–2 ah + 1 rh | EX1a; heal-shadow | *Supported* → M7. *Refuted* (upper bound below retry or rebuild, or regressions) → heal becomes "rebuild with the failure as a probe" and the patch machinery is parked. Haiku not non-inferior to Opus at δ 20 points → the proposer starts at Opus [D]. *Inconclusive* → you decide | — |
| **M6c** EX2 directed edits | 11-02 → 11-15 | 20 change requests on kept, passing workflows from `records`, `synth` and `codefix`: add an output field; change a stated convention; adapt to a sibling variant with a different input schema; make it cheaper at equal success (R-bench T3's "improve", on development items). Oracles from the bed generators, which already vary conventions per task [I] | Success on the modified task, regressions on unchanged behaviour, $ and minutes per successful edit · **baselines: Haiku rebuild from the new request; Opus rebuild** · prereg yes | Haiku edit (heal ops + structural ops), Opus edit, Haiku rebuild, Opus rebuild | 20 requests × K 2 | $20–50 | 2–3 ed · 2–3 ah + 1 rh | M2c; EX1a's structural ops | δ = 15 points: a Haiku edit refuted as non-inferior to a Haiku rebuild, or not cheaper, → "edit" becomes "rebuild with the diff as a probe", recorded against THESIS D9. Informs at n = 20 | None |
| **M7** Heal integration | 11-09 → 11-15 (only if EX1b is supported) | Heal code into `src/` on E2 (after `call` in the staged merge); lessons as reviewed kit proposals under a new kit hash; heal state read-only in the viewer (U2). **Gate:** item 4's planted-instruction slice and canary extended to the heal proposer, because natural failures on R-bench put third-party run data (`untrusted:run-data`) in front of it [D heal DESIGN §7.5] | Fix rate on *natural* failures (E2E-1, R-bench) vs rebuild · light prereg | heal, rebuild | as they arrive | $20–60 | 5–8 ed · 5–8 ah + 2–3 rh | EX1b, E2, item 4 for the proposer | As EX1b; with no oracle a heal may only add guards [D] | Auto-promotion scope (heal decision 1) |
| **M8-K0** Open-weight stand-in probe | one laptop evening, W1–W2 | Serve one 7–9B open model at 4 bits with the vendored llama.cpp; tokens per second; P1's `fhand` workflow on 12 development tasks (K 1) with its agent nodes on the local model; one typed port | Success vs fhand-haiku's dev result; tokens/s · diagnostic, no prereg | 1 | 12 tasks | $0 API | 0.5–1 ed | Your OK; a policy entry for the model id; a download within D5's cap | Informs: the open-weight lane reopens or stays parked, and "akin to a 9b model" gets a number | OK + model id |
| **M8-K1** Kev-vs-Haiku probe | 10-12 → 10-16 | The comparison per port on the **fixed wave-A evaluation split**; rule and Haiku baselines **re-run on post-`b62049f` data**; stock Kev scored with its wording fixed in advance (not the best of 2 on the reported split); `03-probe-results.md` written (still `RESULTS_PLACEHOLDER` [M]) | Accuracy, calibration, latency and $ per decision · **baselines: rules and Haiku 5.5 typed calls** (Sonnet as ceiling) · light prereg | stock Kev (laptop), Haiku 5.5, rules, Sonnet | the 5 probed ports plus the wave-1 ports with built data × 47–100 eval items | $3–13 | 1.5–2.5 ed | `kev.serve` | **Corrected rule:** a port closes for training only when Haiku 5.5 typed calls meet the port's JUDGE §8.1 promotion bar on the evaluation split within its cost and latency targets. **Stock Kev losing is expected and closes nothing**; its score is reported, not used to decide. Ports Haiku does not saturate get the 2.5K curve point (laptop nights, $0 API) before any close | D13 contradiction; freeze Kev data scope at wave A until K1 reads |
| **M8-K2/K3** Laptop calibration and curve | 10-12 → 11-08 (nights) | J0 and J1 (throughput on real rows, **J0c's served-scoring rate, put into the five-night budget**: 17,800 evaluation rows per curve point × about 6 reads), then J2 on the ports K1 leaves open, under the pre-registered **reduced plan** (2.5K, 5K, 20K; second seed at 5K; grid {base, lr4}) [D JUDGE §7.4] | Per-port T1 offline gates on dev-OOD and "is 5K enough" · **baselines: stock Kev, rules, Haiku 5.5** · prereg per JUDGE §9 | — | 17,800 evaluation rows per curve point [D] | $0 API; hosted arms ≤ $450 approved, expected far less [D O2] | 2–4 ed; 2–3 laptop nights (about 35M tokens at ~1,100 tokens/s ≈ 9 h, ≈ 12.6 h at 770 tokens/s for long states, plus reads) | K1 | Measured rate < 1,500 tokens/s → reduced plan [D] (expected) | O7 laptop nights |
| **M8-K4/K5** Wiring, end-to-end check, promotion | 11-09 → 11-30 | W0 provider route, W1 `judge` node, W3 escalation router, W4 ledger store, on E2 (staged, only for ports that pass); the X8 cascade check with **Kev gate latency from the cloud VM through the bridge (p50, p95) and laptop availability over the run window**; the J5 final read | X8: oracle pass and $ per task of weak model + Kev gate → Sonnet · **baselines: weak model alone; Sonnet alone** · prereg yes | 3 | ≥ 100 tasks per arm [D §8.3] | $30–40 | 5–9 ed · 5–9 ah + 2–3 rh | K3, E2 | A port that fails the §8.1 promotion rule stays advisory: it may rank, never gate [D]. A gate that needs the laptop online is labelled so in the policy proposal | O4 policy entries (proposal only) |

### 3.3 Wild evaluation: R-bench, your tasks, external benchmarks

| ID | Window | Deliverable | Capability number vs baseline · prereg | Arms | n / K | List $ | Effort | Depends on | Rule | Owner decision |
|---|---|---|---|---|---|---|---|---|---|---|
| **M9** R-bench run 1 | prep W1–W2; run 10-26 → 11-01 (11-08) | Run 1 of `research/replicate-20261008/DESIGN.md` §10, with the recall guards (memorisation probes, twins, cutoff dating, source firewall); R11 timeouts; R-bench's alternative-design controls extended beyond today's 2 of 5 items as OD1's specificity set (G10) | Verified job success per arm and task type (T1 translate, T2 rebuild from intent, T3 improve), CPS_N, rules DR1–DR5, OD1 pair, skeleton-miss rate and CX5 escalations · **baselines: B0-call Haiku 5.5 and Opus** · prereg `rbench-r1`, which states: **"B0-agent and the free builders are deferred (D10), so any F > B0 result here is against single calls only"** | B0-haiku, B0-opus, F-opus→haiku, F-haiku, B1-haiku (C-det n/a) | 5 items × 3 types × 3 fresh seeds; K_c 2 Haiku, 1 Opus; K 2 | $85–300, stop $300 [D] | 3–5 ed prep + 1–2 ed run | Gates G1–G10: E1, builder v0, sink field, provenance taint (item 4), **item 6 (delivered in M1; B1-haiku gated on it)**, lint | **Informs only** (n = 5): it cannot narrow the pitch by itself. It decides whether run 2 starts: ≥ 4 of 5 items healthy, faults < 10% [D]. $300; health gate; environment-fault stall; any canary; B0-opus projected > $80 → T2 only [D] | R-1 (tag items you want done) |
| **M10** R-bench scale-up | **build 6–30: 10-15 → 10-25**; **run 2: 11-09 → 11-15**; build 31–100: W3–W6; **sealed-40 read: W8 (11-30 → 12-06)** | Items 6–30 built; run 2 on 30 items on E1; items 31–100: pool acquisition in W3, the sealed 40 built by isolated sessions with no builder-kit access [D DESIGN §8.4]; the sealed-40 read once on E2 (12-07 → 12-13 if it must wait for E3 as its IR freeze) | Run 2: F vs B0-call per type at 30 items (success directional, CPS may decide), plus the per-item natural monthly run count (N_item) as a recurrence proxy and real-workflow labels for the router; then the **claim-bearing sealed-40 read**, carrying RX4 only if router v0 is frozen before it, and the injection slice if gated · prereg each | as M9, plus a **"Haiku with tools" builder arm** (X1a's loop as the builder) once X1a passes its canary and provenance-taint tests | 30 → 100 items | build 6–30 ≈ 38 ah (≈ $0.5K); 31–100 ≈ 105–130 ah (≈ $1.4–1.7K) [D hours; I at $13.12]; run 2 $400–900, or a cheaper variant (T1+T2 only, K 1) at $200–450 [I]; sealed read $150–300 [I] | agent-hours as listed | **Building** needs kit consolidation and ≥ 4 of 5 pilot harnesses passing their health gate on fresh seeds; **running run 2** needs run 1's scale-up gate | Run 1 gate fails → fix the harness kit first [D]. A harness flaw found by the arms would now hit 30 items, so the generic attack suite, an adversarial verify and a second verify on a third of the items run before any arm [D §8.1]. Run 2's CPS read decides only at ≥ 30% (30 items sits inside 23–89) | R-5 by 10-12; items 31–100 by 10-26; run 2 if > $500; R-3 Docker host (default no) |
| **M11** Your tasks (rung 3) | intake now → 10-28; run in W6 | 20–30 tasks through a **one-page, about 10-minute intake** (the task, what "done" looks like, 2–3 examples); **at least a third of each task's examples held out as the oracle, never shown to a builder**; Claude never writes or edits an oracle after seeing a task; sealed by hash like `beds/sealed/` | F vs B0-call vs B0-agent vs B1 on your tasks, inside M21 · the sealing is the prereg anchor | 5 | 20–30 tasks × K 2 | $20–40 [D] | 0.5–1 ed | You | A task with neither a check nor held-out examples is run and reported `unverified`, outside the success rate. None by 10-28 → rung 3 runs on your R-1 tags over R-bench items, not "missing" | Decision 9 |
| **M12** External benchmarks | check W0–W1; first runs December | Acquisition check (URL, SHA, licence, outcome, runnable here) of **ROADMAP Tier A**: TextWorld, MiniHack, BabyAI, ARC-AGI-3 (the 25 public games, offline), IDoFT [M `docs/ROADMAP.md:809–815`]; plus τ²-bench, AppWorld, Spider 2.0 / BIRD, a SWE-bench Verified slice, GAIA; and **the τ^τ-bench one-task feasibility gate** (a Phase 2 exit item [M `docs/ROADMAP.md:1075`]). **Ordered by what can run:** Spider 2.0 / BIRD with today's node kinds (agent → sandboxed `code` runs the query → `verify` → bounded `loop`); IDoFT with `code` and the sandbox; TextWorld, MiniHack, BabyAI and ARC-AGI-3 after M13-ENV; τ² and AppWorld after X1a | Execution accuracy and CPS of an Opus-built template run on Haiku and of a Haiku-built template · **baselines: B0-call Haiku 5.5 and Opus** · prereg yes | 4 | 200 items × K 2 | $0 check; $50–80 first run | 1–1.5 ed + 2–4 ed | Acquisition outcome | **Capability kill:** F's upper bound below B0-call Haiku on execution accuracy at equal spend → no external-benchmark claim for construction. Licence or acquisition fails → next benchmark; public items may be memorised → rung 2b with a memorisation probe | Remote-compute credentials for Tier B/C; D1-cap |

### 3.4 Representation ("any and all workflows") and interactive tasks

| ID | Window | Deliverable | Capability number vs baseline · prereg | Arms | n / K | List $ | Effort | Depends on | Rule | Owner decision |
|---|---|---|---|---|---|---|---|---|---|---|
| **M13-S0a** Measurement pipeline on E1 | 10-19 → 11-06 | Lowering of every corpus item's normalized graph to the E1 IR; typed mock capabilities; `CONSTRUCTS.json` ledger; `coverage-report.mjs --ledger`; `FREEZE.json`; independent audit of 30 hand-lowered items [D 02-ir §8] | **First compiled number** (validates under the production label policy, sink field included) on the 521 natively declared items, and **first executed number** on the 96 T1 oracle items with mocks (+ a frozen T3 sample), **reported per platform and as a share of the oracle subset only, never of the corpus** (the 96 are dominated by kubeflow 25, dagster 24, temporal 14 [D COVERAGE §7]) · **capability baseline: the executed share of the same 96 items by B1** (a plain script translation) under the same mocks and oracles; declared coverage 521 of 1,549 (33.6%) as context · `FREEZE.json` first | IR, B1 | 521 items; 96 T1 | $5–20 | 10–16 ed · 10–16 ah + 4–6 rh | E1 (sink-field policy) | **Health gate:** an executed failure counts against the IR only if the original or reference passes the same mocked oracle. Lowering audit mismatch > 10% → compiled number invalid until fixed [D] | None |
| **M13-S0b+S1** Output contract, expressions, semantics, `call` | branch from 10-19; merges first at E2 (11-12 → 11-15) | G1 output contract, G2 expression language, G9 semantics spec and conformance suite; `call` by hash with depth cap, carved budget and child run record; `flow-size>500`; composition conformance (deadlocks, double-counted budgets, spawn bombs) [D] | Compiled and executed after S1 (declared rises to 631 [D 02b]); stage check: Haiku builder with `call` vs the S0 IR (inlined) on items that need it [D 02-ir §7] · light prereg | 2 | items needing `call` (110 newly declared [D]) | $10–30 | 20–31 ed · 20–31 ah + 7–11 rh | Sealed round's last trial (R2) | Conformance red → no merge | None |
| **M13-ENV** Env port and image inputs | branch from 10-19; merges at E2 (11-12 → 11-15), or as E2b a week later | The ROADMAP §2.1 env capability: `reset/step/observe/snapshot/restore`, a determinism class, every step journaled as an effect with a receipt; **`media` inputs on `agent` nodes** (amendment R-3; the game-QA "visual understanding node"); adapters for `gridquest` and `sealed-3`; the `gameqa` audit | **C5 pilot** (W6): an env session with snapshot/restore vs a plain loop of direct calls per round (the B0-call form), at matched budget, on `gridquest` dev seeds; levels per $ and actions per level · prereg yes | 2 | 12 tasks × K 3 | $20–40 | 9–15 ed [D 02b S5c + S9] · 9–15 ah + 3–5 rh | E1 | MUE 30% levels per $. Refuted → C5 falsified in this envelope [D ROADMAP §4.3]; game QA runs as plain agent loops with typed checks. Informs at 12 tasks. Nothing on the critical path waits for it | None |
| **M13-S2** Failure handling and generated code | 11-16 → 12-06 (E3) | `error-branch`, `completion-hook`, `adaptive-retry`, `model-generated-code-exec` form (a) [D] | `codefix` d4–d5: generate → sandbox → `verify` on Haiku 5.5 · **baseline: B0-agent** · prereg yes; "stop after S2 and measure" [D] | 2–3 | dev seeds, K 3 | $30–60 | 11–19 ed · 11–19 ah + 4–7 rh | E2 | Refuted at equal spend → generated code stays a representation feature, not a builder default [D] | D12 (applied) |
| **M13-H** Headline coverage | January | A fresh ~300-item sample collected after the IR freeze, measured once | Declared, compiled, executed (THESIS D8 headline) · prereg: the threshold X | — | ≈ 300 | $20–80 | 3–5 ed | IR freeze | **Executed / oracle-eligible below X% (pre-registered) → THESIS D8's headline is restated as the measured share** | D8 (applied) |
| **M13-S3+** Triggers, waits, tool loop, sessions, … | 2027 | S3–S9 | Per stage, as 02b §5.3 | — | — | [unk] | ≈ 100–170 ed [D 02b §5.4] | S2 check; D12 lower priority than the wild ladder | Per stage [D] | Trigger activation authority (before S3) |

### 3.5 Routing, executors, composition, board, reuse, AMP, UI, end to end

| ID | Window | Deliverable | Capability number vs baseline · prereg | Arms | n / K | List $ | Effort | Depends on | Rule | Owner decision |
|---|---|---|---|---|---|---|---|---|---|---|
| **M24** E2E-0, a vertical slice | 10-19 → 10-25 (11-01) | One development task on fresh seeds (`synth` or `records`) → router card (fixed policy plus the draft RX6 guard, advisory) → a smoke build by builder v0 (or the free Haiku builder if v0 is late) → run on E1 → gating verdict and OD1 → live viewer, or a replay → heal in shadow on any failure → a one-page report | **No capability claim.** Time to the first workflow, $ to build and run, verdict vs oracle, and **every integration defect found** · a dated note | — | 1–3 tasks | $5–15 | 2–3 ed · 2–3 ah + 1 rh | E1, M2a | Its output is a defect list | None |
| **M14-RX1p** Router: need-axis pilot | 10-19 → 10-20 (10–13 h of one slot at concurrency 4–5 [D rigor P2-4]) | Cross-fitted headroom pilot on `records` + `codefix`; **≥ 3 builds per workflow mode and family** (or the result labelled "conditional on these artifacts"); test worlds **deduplicated by `worldHash`** against every development and inspected world (records-v3 was developed on d3–d4 seeds 101–160 [M heal seed ledger]), or the pilot starts at d2; legacy C0 artifacts reported as "legacy, K_c = 1"; R11 timeouts | Oracle headroom over the best fixed mode at V ∈ {0.1, 1, 10}, N ∈ {1, 20} · **baseline: best fixed mode** · prereg yes | direct-Haiku, direct-Sonnet, F-haiku, F-opus (lint-clean rebuilds, ≥ 3 per mode; legacy artifacts as a sensitivity arm), agent-Haiku on 4 seeds | 2 families × d1–d5 (or d2–d5) × 12 fresh seeds, K 2 (≈ 1,000 trials) | $90–150 | 1–2 ed | E1 | **Need axis only.** MUE 3 points and 20% cost. *Refuted* (upper bounds below both at every V and N) → no *need* router: "direct vs workflow" becomes a fixed policy plus hard guards. **RX1b decides the size axis, not this pilot.** Informs (it sizes RX1 full) | None |
| **M14-RX1b** Router: size-axis headroom | 11-02 → 11-15 | RX1's cross-fitted design on the size modes the slider is meant to choose between | Headroom between modes, at V and N as RX1 · **baseline: the best fixed mode** · prereg yes | `template` (builder v0, one skeleton), `construct` (builder v0, no skeleton), `construct+` (Opus, multi-stage, nested by inlining, from M25), the best direct mode from RX1 | 2 dev families × d3–d5 × 8 fresh seeds, K 2 | $50–100 | 1–2 ed | M2c, M3, M25 templates | MUE 3 points and 20% cost. *Refuted* → the slider has one "build" position; the size tiers become display labels. Informs | None |
| **M14-RX6 / RX1 full** | W4–W5 | Hard-requirement guard; RX1 on 3 more families, adding builder-v0 F artifacts at K_c = 2 before any kill | Guard recall ≥ 0.95 on 449 corpus descriptions vs the regex library; headroom on 5 families | — | 449; ≈ 2,500 trials total | $0 + ≈ $125 [D] | 2–3 ed | RX1 pilot not refuted | Guard recall < 0.9 → the guard asks the user [D] | None |
| **M14-RX2** Router v0 | 11-23 → 12-04 (frozen before the sealed-40 read if RX4 is to ride on it) | Leave-one-family-out head; advisory card in `foundry` (logged, never deciding) | Headroom captured · **baselines: best fixed mode, size heuristic, try-direct-first cascade, Haiku zero-shot** [D 05 §2.10] · prereg yes | as listed | RX1, RX1b and R-bench run 2 data | ≈ $1 [D] | 3–5 ed | RX1 full, RX1b | HC lower CI ≤ 0 → advisory only [D] | R-D1 slider default, R-D2 exploration |
| **M14-RX4** Slider fidelity | W8 on the sealed 40 if RX2 is frozen in time; otherwise January on your tasks and the next sealed set | Read once | Realised vs predicted operating point at each slider position | — | ≥ 30 families or items | ≈ $60 [D] | 1–2 ed | RX2, M10 | More than one position misses → slider shown "uncalibrated" [D] | — |
| **M15-X0** Executor isolation spike | 10-12 → 10-16 | Tests whether Claude Code itself can run with no network and no new credential; **drafts the ROADMAP §3 amendment text** for a capped Foundry-owned tool loop (ROADMAP already anticipates it: "A Foundry-native loop requires amending this line first" [M `docs/ROADMAP.md:769–770`]) | Feasibility and a design note · no prereg | — | — | $0–2 | 1–2 ed | — | — | → your route (§8); the gate on the chosen route moves to E2 (E1 ships both profiles, R13) |
| **M15-X1a** Capped tool loop | on E1x from W1, if route (a); first number about 11-01 | At most 16 typed turns (`{tool, args}` or `{finish}`), every turn journaled; Read, Edit, Grep and Bash in the no-network sandbox; model turns through the existing host gateway, as the B1 arm already does (`experiments/lib/arms/b1-script.mjs`, `src/executors/sandboxed-command.mjs` [M]); implements amendment R-3's `agent.tools` | Verified success per $ on `codefix` d4–d5: a tool-loop node + `verify` · **baseline: B0-agent (Claude Code alone, same model, `bed` profile)** at equal spend, plus agent-nodes-only · prereg yes | 3 | dev seeds, K 3 | $60–100 (replaces X2's; no net cost) | 5–10 ed · 5–10 ah + 2–4 rh | Route (a); E1x | MUE 10 points or 30% CPS. *Refuted* → executors are an L2 fallback only [D]. Canary and provenance-taint tests (items 4, 5) before any third-party text | Route (a) by 10-16 |
| **M15-X1/X2** Claude Code inside nodes | after the decision (≥ W5), only if route (b) | `executor` node (lane 7 stage 4: budget carving, `egress: none`, transcript blobs, mandatory `verify`, depth and fan-out limits) [D 07 §3.2, §7] | As X1a, with Claude Code as the node · prereg yes | 3 | dev seeds, K 3 | $60–100 [D] | 5–8 ed | Route (b); E2 | As X1a | A proxy key (D10) |
| **M16 + M25** `wide`, nesting and board-lite, by emulation | templates W2–W4; run W5 (11-09 → 11-15) on E1 | `wide`, B5 and the composition arms as experiment workflows on today's engine (composable from `agent`, `code`, `map`, `verify` [D 03 §3.3]; static nesting to depth 6 works [D 03]); **nesting by inlining** (depth 2–3, Opus-built `construct+`); **board-lite**: workers read the merged board at round k, write findings, and a code reducer merges them, carried as loop input (no engine change [D 02b §4.1; I]); critical-path wall time and total tokens in the run summary | Verified success per $ and pass^3 · **baselines: B5 (best-of-K, same verifier, equal K and tokens), B0-call, and a flat workflow** · one prereg | (i) flat; (ii) nested by inlining; (iii) `wide` without a board; (iv) `wide` with board-lite; (v) B5; (vi) B0-call; `panel` only if budget allows | `records` d5 + `synth` (audited breadth bed, v3.0.0 [M AUDIT]), 16 fresh tasks × K 3 (≈ 580 trials) | $110–220 | 4–7 ed · 4–7 ah + 2 rh | E1 | Three MUEs: `wide` vs B5 10% per $; board-lite vs `wide` alone 15% per $; nested vs flat 10 points on tasks that need decomposition. *Refuted* `wide` → no swarm default; *refuted* board-lite → board v1 is not built; *refuted* nesting → `call` is built for representation and reuse only (synthesis §3.15 #10). **Informs** at this n unless effects are large (15% per $ needs about 90–360 paired tasks) | None |
| **M17** Board v1 and private notes | notes test W5–W6 if capacity; **board v1 in December only if M25's arm (iv) is supported** | Private notes (a typed output field carried into the node's next iteration) first; board v1 (topics, reducers, `emits`/`reads`, `atSeq` receipts, label rules, quotas) with threat fixtures S1, S5, S6 (item 16) [D 07 §7], on **`synth`** (not `gridquest`, which needs the env port) | Notes: verified success and CPS on `records` d3 with vs without a scratch field. Board v1: unique confirmed findings per $, duplicate exploration, pass^3 · **baselines: no-board, B0+N, B5, board-lite** · prereg yes | 2; 4 | K 3 | $10–30; $60–150 | 2–3 ed; 10–15 ed | M25 | Notes: no lift at the bound and ≥ 20% more cost → drop. Board v1 not ≥ 15% better per $ than board-lite → park it | D12 / 02b decision 2 |
| **M18** Reuse library (C2) | census from R-bench N_item in W3–W4 (and your list if it arrives); **whole-workflow reuse pilot on E1 from W6**; full study January | Recurrence census; whole-workflow reuse by hash on new instances of a family (needs no `call`); library admission, promotion ladder, demotion, wrong-reuse guard; sub-workflow reuse after `call` | Amortised CPS curve, break-even t*, reuse and wrong-reuse rates · **baselines: B0, B0+N, B2 (memory/skills), etchplan** [D ROADMAP §5.5] · prereg yes | 5 | pilot: family streams (the C0 sealed families once read, which R5 turns into development data; R-bench development items with N_item); exit: ≥ 8 families × 3 orders [D] | pilot $150–300; full $300–700 | 10–20 ed | **`call` (E2) for sub-workflow reuse only**; decision 11 optional (R-bench N_item stands in) | Wrong reuse > 5%; under half the families break even by task 15; no win over B0+N and B2 at the bound [D] | Decision 11; D11 |
| **M18b** Learning curve | prereg W7; run December | A stream of fresh tasks in 5 blocks across ≥ 4 families. Between blocks the system may update only through its existing gates: kit lessons (a new kit hash), skeletons mined from builds that passed the test split, router refits, library admission. Also counts **defect recurrence** on builds made with kit version N+1 vs N ("so it doesnt run into that issue") | Success and cost per success per block, wrong reuse, regressions · **baseline: the same stream with every update frozen at block 0** · prereg yes | 2 | 5 blocks × ≥ 4 families | $100–250 | 4–6 ed | M18 pilot; EX1b lessons | No gain over the frozen control by block 4 at the bound → "learning" narrows to "reuse", recorded as such | None |
| **M19** AMP context (Phase 7) | January → | Connector profile and ContextPort → AMP `compile_context` contract tests on a recorded fixture (cloud); then your local A/B (the cloud cannot reach ARC or AMP [D ROADMAP §5.7]). **Gate:** security items 4 and 15, with a provenance label on every AMP excerpt | Construction success and CPS with vs without AMP context [D THESIS §8] · prereg yes, **with δ and n pre-registered** | 2 | your local runs | $20–60 | 5–10 ed + your sessions | `call`; items 4, 15 | No gain at the bound → AMP stays a pointer store for kept workflows | D4; your time |
| **M19b** Cooperating workflows | December, on E2 (cloud) | A parent starts two child runs by handle; they exchange typed results through board-lite or handles; the composition conformance rows for deadlock, double-counted budgets, one writer per resource and cancellation propagation [D synthesis App. C] | On R-bench items whose originals ran as cooperating flows (the self-calls in n8n:20281, the script calls in the Home Assistant item [D R-bench §6.1]): cooperating children vs one flat workflow · prereg yes | 2 | those items, K 3 | $20–50 | 4–6 ed | E2 `call` | *Refuted* → parallel workflows stay representation-only | None |
| **M20** UI: live history, heal review, your exit test | U1 W3–W4; U2 W5–W6; U3 W6 | U1: G1–G3 consumed, live mode in run history and `foundry serve` routes (H-6) [D 06b], **plus the frozen 13-run evaluation of the model-written summary** (1 of 3 Haiku summaries invented a detail [D 06b]). U2: a read-only heal-review screen [D heal §12], **the builder transcript view (06b "2.6 v2") and a router decision card**; approvals stay on the CLI. The nested drill-down fixture is replaced by a real nested run once M25 has run. U3: your exit test | U3: median time to answer "why did this happen?" on 10 failing runs frozen before you see the UI, < 2 min [D ROADMAP §2.10] · **baseline: the same questions with `foundry inspect`** (counterbalanced halves) | UI vs CLI | 10 runs | ≈ $0 | 4–8 ed | E1 fields; heal lineage files | Exit test fails → the viewer stays a prototype and does not move to `web/` [D] | 1–2 h of your time |
| **M1b** E2 re-qualification | W5, before E2E-1 | M1's design on E2, plus the sealed-round winners on 8 development tasks; confirms each staged merge | As M1 · light prereg | 3 | 8–12 tasks × K 2 | $5–15 | 1–2 ed | E2 | A drop beyond the E1 result's lower bound → no E2E-1 on E2 until explained | None |
| **M21** E2E-1, the first end-to-end milestone | 11-16 → 11-22 (11-29) | Your task → router (fixed policy plus RX6 guards, or v0 advisory) → Haiku structured build (CX5 escalation to Opus) → **acceptance elicitation if OD1 is below floor** → run on E2 → verdict → live viewer → heal on failure → report. **Gates:** effects mocked unless you approve a task by name; security items 1+2, 4 and 6; item 3 (declassification budget) before any task maps untrusted items into a real effect | Success and CPS with the build included (N = 1); OD1; **the share of your tasks that reach a gating acceptance with OD1 at the floor, and your minutes per task**; skeleton-miss rate · **baselines: B0-call Haiku 5.5 and Opus; B0-agent Haiku 5.5 (your actual alternative is "ask Claude Code"); B1-haiku** · prereg = the sealed task set | 5 (+ "Haiku with tools" if X1a passed) | 20–30 of your tasks × K 2 (or 10 R-bench items) | $25–75 | 3–5 ed | M4, M11, E2, M1b (M7 if it passed) | δ 10 points or CPS 0.85: *refuted* (F's bound below the best of B0-call and B0-agent) → the product is the router plus direct calls plus audit, not construction. Informs at 20–30 tasks | Decision 9 |
| **M22** E2E-2, the composed run | **design W7; dry run on E2 in W8** on a development family; **the run in January** | A task that needs composition: a parent `call`s children (inlined or native), `wide` fans out to tool-loop or agent workers that write to a board (board-lite if v1 was not built), Kev gates judgments on promoted ports, heal on failure, reuse on the second occurrence, live viewer, `verify-run`; inside AMP if M19 passed | Amortised CPS over recurrences and success · **baselines: B0-agent; E2E-1's flat pipeline** · prereg yes | 3 | R-bench sealed items that need composition, or your recurring tasks (rung 4) | dry run $20–60; run [unk] | [unk] | M15–M19, M25 | **Whole-composition kill:** E2E-2 not better than B0-agent and E2E-1's flat pipeline in CPS at equal success (at the bound) → composition stays representation-only. Each component's own rule removes it from the composition | Decision 11; D4 |

### 3.6 Notes on the milestones that carry the most risk

**M2a, oracle discovery.** The builder's acceptance must reject wrong answers *and* accept right ones. An acceptance
that rejects everything, or hard-codes one expected output, would score 100% on rejection alone, so OD1 is a pair, with
accept-all and reject-all sanity rows, and the mutant generator is frozen before any oracle-discovery code exists and
written by a different agent [D rigor P1-3]. Measuring OD1 on existing artifacts costs nothing and runs by 10-14, so the
"honest but blind" risk is seen two weeks before CX3 rather than inside it. A workflow whose acceptance misses the
floor is reported `unverified` by design; for your tasks, acceptance elicitation asks you for 2–3 examples instead.

**M15, the executor route.**
- The B1 script arm already runs model-using code with **no network**: `network: false` adds a private network
  namespace, and the script's only way out is a host gateway on a Unix socket, which calls the host's existing CLI
  login without exposing it [M].
- The Claude Code executor sandbox has no network namespace (`UNSHARE_ARGS`, `src/executors/claude-code.mjs:58`), and
  hiding its managed login fails auth (`:17-23`, live-tested 2026-10-07) [M].
- So [I]: a **Foundry-owned capped tool loop** needs no new credential but crosses ROADMAP §3's "no general agent loop",
  so it needs your amendment. **Claude Code itself** in a no-network sandbox needs a key (D10) or reading the CLI login,
  which AGENTS.md forbids.
- The choice reaches **209 of 1,559 corpus items** that carry a tool loop (100 third-party agentic, 99 original, 10
  first-party) [M 10-STATE §3.3], τ²-bench and AppWorld, and whether "Haiku with tools and instructions" can be tested
  as a builder on outside tasks (your question of 10-08).
- **Default changed to (a)**, with X1a's caps (16 typed turns, a journal entry per turn, no egress) as the
  mitigations. A capped loop is still a loop; if you say no, (c) applies.

**M4, the sealed round.** It is read once, so a harness bug burns the families. CX3 doubles as the dress rehearsal:
same runner, same arms code, dev families. The sealed pre-registration freezes no earlier than three working days after
the CX3 read. Its redesign trades repeats for tasks: the sealed families are generators (reference and bad controls
checked over "seeds 1..30 x splits dev+test" [M `beds/sealed/MANIFEST.json`]), so 30 tasks at K 1 cost about the same as
12 at K 2 and carry more information when within-task correlation is high.

**M6, heal.** Tonight's campaign is the reason for V3b and the structural ops: the gates promoted a cost-raising patch on
an incident that did not reproduce, and on the incident that did, every model class failed alike, which points at the
op set and the brief, not the proposer [I, 10-STATE §3.9].

**M8, Kev.** The docs disagree (THESIS D13: training waits; README L337: training approved, the comparison is the
promotion gate) [D 10-STATE §1]. This plan follows your later words: J0/J1 cost nothing and run now; the curve runs only
on ports where Haiku 5.5 leaves headroom; promotion needs the JUDGE-PROGRAM §8.1 rule [D]. Data-factory growth
continued during this review (wave B appeared; about 39.4K lines [M]); I propose freezing its scope at wave A until K1
reads. Please confirm or overrule.

---

## 4. Parallelism: what runs at the same time

### 4.1 Slots

| Slot | Capacity | Rule [I] | Reason |
|---|---|---|---|
| VM working agents | 4 (5 at the W1–W2 peak if the meter is green) | Each agent tests only the files it touched; at most one full suite or Kev-data suite at a time | 4 vCPU; the Kev-data suite took 25 min at load ≈ 10 [D]; the 10-06 allowance stop [D README] |
| Review agent | 1 continuously | Adversarial review of each lane's diff before it feeds a comparative run; the stage-1 review first | Review is the scarce input (10-STATE S10) |
| VM model-run slots | **Low schedule: 2** (A, B) at concurrency ≤ 4 each. **Full-speed schedule: 4** (A–D) once M0's calibration shows the weekly meter can carry them. **Default: full speed**, as you chose; the stop at the warning meter stays, because it protects paired runs (your stop rule on rate limits [D 01-requirements #30]) | Arms interleaved inside each run; wall-time metrics from shared runs labelled "shared VM" | ≤ 8–16 CLI processes against a 2.3–3.4 calls/s ceiling [D 04]; interleaving keeps load equal across arms (ROADMAP §4.3) |
| Engine branches | **2**: the E2 integration branch, and one experiment branch with named E1x freezes (R14) | Only the E2 branch changes `src/` for E2; E1x freezes are compared only among themselves | R2; ROADMAP's freeze rule names *a* freeze per comparison [M] |
| Laptop GPU | 1 job | Nights: training (J2, J5). Days: `kev.serve` for scoring. One evening for M8-K0. Never two at once | One `kev.serve` at a time, stopped before training [D JUDGE §7.4]; thermals [D] |
| Owner | weekly batch | Decisions batched once a week, with defaults | Decisions 1, 4, 9, 11 are still on defaults [D README] |
| Timing measurements | quiet VM | Latency, live-feed lag and CLI-flag A/Bs run alone, or are labelled | The flag study ran at n = 5 per shape and arm on a loaded VM [M] |

Runs that move up with the full-speed schedule (marked * in §5.1): X1a's development runs, RX1 full, EX2, the reuse
pilot, R-bench run 2's overlap with M16 + M25, the external SQL slice. On the low schedule each slips by about a week.

### 4.2 Lanes

| Lane | Owner of files | Milestones, in order |
|---|---|---|
| L1 Engine and IR | `src/`, `tests/`, `schemas/` | M0 → M1 (E1) → M13-S0a (tooling on E1) ‖ S0b + S1 and M13-ENV (E2 branch) → E2 (staged) → M1b → M13-S2 → E3 |
| L2 Construction and routing | builder code, `experiments/c0`, router | M2a ‖ M2b → M2c → M3 → M4 → M21; RX1, RX1b and M24 in L2's run slot between them; M5 after E2; RX2 in W7–W8 |
| L3 Heal and edit | `experiments/heal/` | heal-shadow (from W2) → M6a → M6b → M7; M6c (EX2) |
| L4 Kev | `experiments/kev-data/`, laptop | K0 (one evening) ‖ K1 → K2/K3 (nights) → K4 on E2 → K5 |
| L5 Evaluation | `experiments/replicate/`, owner-task intake, external | M10 building (W1–W2) → M9 → M10 run 2 → sealed-40 build and read; M11 intake; M12 acquisition check → first runs; M4b |
| L6 UI | `tools/run-view/` | U1 → U2 → U3 |
| L7 Composition and executors | experiment workflows; the E1x branch; later `src/` on E2 | X0 → (route) → X1a; M24 slice support; M16 + M25 → M17; M18 → M18b; M19b; M22 |

L1, L2 and L5 hold the critical path. L3, L4 and L6 fill gaps; L7 now starts in W1 instead of waiting for E2 [I].

---

## 5. Schedule

### 5.1 Week by week, W0–W8

Run slots: A and B on the low schedule; C and D (marked *) only on the full-speed schedule.

| Week | Engine and IR (L1) | Construction and routing (L2) | Heal, Kev, UI (L3, L4, L6) | Evaluation and composition (L5, L7) | Run slots | Laptop | You | Gate at week end |
|---|---|---|---|---|---|---|---|---|
| **W0** Thu 10-08 → Sun 10-11 | Scheduler and cancel committed; `STAGE1-ENGINE.md`; the stage-1 adversarial review starts; sink-field policy starts; item-4 `src/` decision | M2a: mutant generator written by a separate agent and frozen; OD1 harness. M2b: Opus starts the skeleton library. Builder v0 design note | Heal campaign write-up (ended 22:25); Kev interactive-group fixes (in flight) | **Allowance calibration (M0 exit gate)**; `SEEDS.json`; Tier A and τ^τ acquisition check; R-bench kit consolidation; X0 drafts the §3 amendment; pre-registration drafts start | — | J0 smoke | Kev contradiction; Kev scope freeze; **R-5** | **M0** done; calibration recorded |
| **W1** 10-12 → 10-18 | Sink field + FP test; launcher review; usage pause; G1–G3; executor profiles; item 6; timeout override and fault (experiments lane); stage-1 review closed; **E1 named Fri 10-16** (≤ 10-21); E1x branch opens | **OD1 read at $0 (10-14)**; M2b ≥ 20 skeletons + coverage; M2c build | EX1a catalog (independent agent) frozen by hash, prereg; structural ops and V3b built; **K1** under the corrected rule; **M8-K0** evening; heal-review screen design | Preregs for CX3, RX1, RX1b, `rbench-r1`, EX1a/b, M24 (each with odds, R11 timeouts, OD1 pair, three-outcome rules); X0 spike → your route; X1a starts on E1x (if (a)); **R-bench items 6–30 built** (about two agent-days); owner-task intake page sent | A: K1 hosted half ($3–13); B: E1 re-qualification ($5–15, after the freeze) | J0, J1; `kev.serve` for K1 | **Route (by 10-16)**; sealed design; OD1 branch; full speed; K0 model id; skeleton reviewer | **E1** frozen; K1 and OD1 read |
| **W2** 10-19 → 10-25 | S0a on E1; S0b + S1 and **M13-ENV** on the E2 branch; load tests (300 nodes, 10 concurrent runs, free) | M2c finished and smoke-tested; **M2 assessed 10-25**; M25 templates (including Opus `construct+`) | **EX1a runs**; heal-shadow on every failed F trial; J2 on open ports | **M24 E2E-0 vertical slice**; R-bench 6–30 finished and health-gated | A: **RX1 pilot** (10–13 h), then E2E-0; B: EX1a; *C: X1a development runs | J2 2.5K, 5K | **D1-cap (by 10-19)** | RX1 need-axis read; builder smoke; E2E-0 defect list |
| **W3** 10-26 → 11-01 | S0a: **first compiled number** + lowering audit; S1 and ENV on the branch | **CX3** + no-skeleton arm + Haiku 4.5 arm + CX8 (read 10-30) | EX1a report; U1 live history mode and the summary evaluation | **R-bench run 1**; your tasks sealed 10-28; sealed-40 pool acquisition; **X1a first number on E1x** | A: CX3; B: R-bench run 1; *C: X1a | J2 20K, reads | Tasks due 10-28; R-1 tags; items 31–100 (by 10-26) | CX3 read |
| **W4** 11-02 → 11-08 | S0a: **first executed number** (vs B1), `research/ir-<date>/REPORT.md`; S1 done on the branch | `PREREG-sealed.md` frozen **11-04**; **C0 sealed round from 11-05** | **EX1b** (from 11-03); EX2 starts; U1 done | RX6 guard ($0); R-bench run 1 report and scale-up gate; sealed-40 harnesses by isolated sessions; **RX1b** | A: C0 sealed; B: EX1b, then RX1b; *C: EX2 | J5 final read | — | Run-1 scale-up gate; EX1b read |
| **W5** 11-09 → 11-15 | Sealed round ends 11-11 → **E2** in stages (`call` + S0b; then ENV; then Kev wiring and heal promote, each only if its experiment passed); **M1b** | E2E-1 assembly; RX1b and EX2 read | M7 heal into `src/` (if EX1b supported; planted-instruction test for the proposer); K4 X8 check with bridge latency; U2 (heal review, builder transcript, router card) | **R-bench run 2 (30 items)**; **M16 + M25** (`wide`, nesting, board-lite) | A: R-bench run 2; B: M16 + M25; *C: RX1 full or X8; *D: EX2 | `kev.serve` for X8 | Run 2 approval if > $500 | **E2** named; M1b passed |
| **W6** 11-16 → 11-22 | S2 on the branch | **E2E-1 on your tasks** (acceptance elicitation, OD1, B0-agent) | **U3 exit test** with you | **C5 pilot** on `gridquest`; whole-workflow reuse pilot starts; C1 prereg and pre-check; notes test if capacity | A: E2E-1; B: C5 pilot; *C: reuse pilot | idle / Kev T3 ledger | U3 (1–2 h) | First end-to-end number |
| **W7** 11-23 → 11-29 | S2 | RX2 router v0 offline + advisory wiring (frozen before the sealed-40 read if RX4 rides) | Natural-failure heals from E2E-1 | **`sealed-3` read** (own prereg, after ENV conformance); E2E-2 design; M18b prereg | A: C1; B: `sealed-3`; *C: S2 check | — | **Decision 11 (11-23)** | E2E-1 report (if it slipped) |
| **W8** 11-30 → 12-06 | **E3** (S2) | C1 report | Kev promotions on promoted ports | **Sealed-40 read** on E2 (or 12-07 → 12-13 on E3); **E2E-2 dry run** on a development family | A: sealed 40; B: E2E-2 dry run; *C: external SQL slice | — | — | E3 named; sealed-40 read |

### 5.2 After W8

| Period | Work |
|---|---|
| **December** (W9–W12) | M18b learning curve; M19b cooperating workflows; board v1 only if board-lite was supported; R-bench items 31–100 (the 60 development ones) finished; external SQL-slice report and the first Tier A runs (TextWorld or BabyAI, after ENV); C1 report; Kev wave 2 only for ports that promoted; **if capacity**, an `expand` prototype on E1x (builder v0 invoked inside a run, its fragment validated by code and journaled by hash [D 02-ir L1015–1050]): the comparison with Claude Code dynamic workflows you asked about; RX4 on your tasks if it missed the sealed 40 |
| **January 2027** | **E2E-2** on R-bench sealed items that need composition, or your recurring tasks; the fresh ~300-item coverage sample (THESIS D8 headline); the full reuse study; your local AMP A/B (gated by items 4 and 15); trigger activation decision before S3 |
| **February 2027 →** | IR S3–S9 at D12's lower priority; dogfooding: this project's 10 Claude Code workflow scripts (the first-party corpus items, none native today [D]) lowered into Foundry as B1-cc items, after X1a and S5; Tier B/C once remote-compute credentials exist [D README] |

### 5.3 If oracle discovery misses its floor (pre-picked in the W1 batch)

The CX3 read is 10-30; `PREREG-sealed.md` freezes no earlier than 11-04. If OD1 is below the floor:
- **(i), the default:** the sealed round runs with OD1 reported but not gating; verdicts stay `unverified`, and success
  is read from the bed oracles only; or
- **(ii):** the round waits at most two weeks for one fix-and-recheck cycle on development families, moving everything
  downstream of M4 by up to two weeks.
M2a's $0 read on 10-14 gives the first warning, so a fix can start two weeks before CX3.

### 5.4 Where the dates are most likely to slip [I]

- **Review capacity.** Code is written faster than it is reviewed; the stage-1 review gates E1, and every comparative
  run needs reviewed code (10-STATE S10).
- **An allowance stop** like 10-06's freezes all lanes. Orchestration is ~20× the experiment spend [M]. Mitigation: the
  M0 calibration, a weekly meter budget with a pre-committed drop order, heavy runs after resets, and the run slots
  never filled with conditional work before the sealed round's spend is known.
- **Builder v0 + oracle discovery** (13–23 ed): every week it slips moves CX3, R-bench run 1, the sealed round and E2E-1.
- **The sink-field policy** may reject too many honest workflows (> 10% triggers a redesign [D]).
- **Your inputs:** executor route by 10-16; D1-cap by 10-19; tasks by 10-28; recurring tasks by 11-23.
- **A new model release** mid-plan forces re-qualification (W10 [D 01-requirements]).

### 5.5 Productivity assumption

Effort through 11-22, summed over the milestones that fall in that window, is about **130–220 ed** [I, from the §3
tables]: 2.8–4.8 ed per calendar day over 46 days. The schedule assumes about 1 ed per working agent per calendar day,
reviewed, with 4–5 agents, so the upper end needs the fifth agent or slips. Raw writing speed is not the limit (heal was
designed, built and run live in one day [D heal DESIGN App. B]); review and the allowance are. Re-plan at the end of W1
from the measured ed burn on M1 and M2.

---

## 6. Spend

List-price estimates for experiment model calls [I, from the unit costs in §1.1 and the plans' own figures]:

| Period | Items | Low | High |
|---|---|---|---|
| W0–W2 (→ 10-25) | E1 re-qualification $5–15; K1 + baseline re-run $3–13; RX1 pilot $90–150; EX1a $40–120; builder smoke $5–15; E2E-0 $5–15; heal-shadow $0–20; M2a, M2b, K0 $0 | $148 | $348 |
| W3–W4 (→ 11-08) | CX3 + no-skeleton arm $70–145; R-bench run 1 $85–300; C0 sealed $215–265; S0a $5–20; X1a $0–100; RX1b $50–100; EX1b $20–80; EX2 $20–50 | $465 | $1,060 |
| W5–W6 (→ 11-22) | R-bench run 2 $400–900; M16 + M25 $110–220; RX1 full $0–125; X8 $0–40; M1b $5–15; E2E-1 $25–75; heal integration $20–60; notes $0–30; S1 check $10–30; C5 pilot $20–40; reuse pilot start $0–30 | $590 | $1,565 |
| **Through 11-22** | | **$1,203** | **$2,973** |
| W7 → January | C1 + pre-check $160–260; S2 check $30–60; RX2 $1; sealed-40 read $150–300; `sealed-3` read $60–120; external $50–80; board v1 $0–150; reuse pilot $150–300; M18b $100–250; AMP $20–60; M19b $20–50; fresh sample $20–80; RX4 ≈ $60; E2E-2 dry run $20–60 | $841 | $1,831 |
| **Through January, experiment calls** | (E2E-2's January run is [unk] and not included) | **≈ $2.0K** | **≈ $4.8K** |
| Agent time: milestone building and review through 11-22 | 130–220 ah + 46–77 rh at $13.12 per agent-hour [I on M] | ≈ $2.3K | ≈ $3.9K |
| Agent time: R-bench harnesses | items 6–30 ≈ 38 ah; items 31–100 ≈ 105–130 ah [D hours; I at $13.12] | ≈ $1.9K | ≈ $2.2K |

Consequences [I]:
- **Through 11-22, experiment calls alone pass the $1,500 soft cap at the low end** (with about $100 already spent),
  mainly because R-bench run 2 moved from W8 into W5 and the sealed round was recomputed. Without that move the window
  would be about $0.8–2.1K.
- **Through January, about $2.0–4.8K of experiment calls**, above the Tier A envelope of about $1–3K at the upper end
  [D ROADMAP §4.3]. README's "$560–825" six-week figure is superseded.
- **Agent time is the larger figure.** The milestones need roughly $2.3–3.9K-equivalent of building and review through
  11-22, plus the R-bench harnesses. At 10-08's actual pace the agents used about $1.2K a day [M], so the allowance, not
  the plan, sets the pace.
- **Items over the $500 single-experiment pause:** R-bench run 2 at its upper end (or its cheaper variant), items
  31–100 as agent time, and the full reuse study.
- **Recommendation:** set **D1-cap by 10-19** and **define what it covers**: experiment calls only, with agent time
  governed by the weekly allowance budget (building ≤ 40% of the meter). Hold the conditional runs (RX1 full, X8, the
  notes test, C1) until the sealed round's actual spend is known; they are first in the drop order.

---

## 7. Projected evidence depth by layer

10-STATE's rubric (0 nothing … 3 live models on development data; 4 a pre-registered baseline comparison on held-out
development tasks; 5 sealed or wild tasks with independent oracles; 6 your own tasks or real recurring use, replicated,
with reuse economics), with the revision's rule: **a layer reaches depth ≥ 4 only through a comparison whose treatment
is that layer**. Projections assume each milestone *runs*, not that it succeeds [I].

| # | Layer | Now [D 10-STATE] | 11-22 | End of January | What moves it |
|---|---|---|---|---|---|
| 1 | Mini-harness runtime | 3 | 3 | 3 | E1, E2, conformance, load tests (instrument, not capability) |
| 2 | Represent any workflow | 1 | 3 | 4 | S0a compiled and executed vs B1; S1 and S2 stage checks; fresh sample (5 if it runs in January) |
| 3 | Router and slider, both axes | 1 | 2 | 4 | RX1 and RX1b measure headroom, not a router (2); RX2 v0 vs its baselines (4); RX4 on the sealed 40 (5 if it rides) |
| 4 | Haiku constructs from templates | 4 | 5 | 5 | C0 sealed; R-bench run 2 |
| 5 | Opus templates, hardest tier | 2 | 4 | 4 | CX3's no-skeleton arm, whose treatment is the skeleton (3 without that arm) |
| 6 | Edit and auto-heal | 3 | 4 | 5 | EX1a and EX2 (4); natural failures on R-bench and your tasks (5) |
| 7 | Cheap execution, typed judgments | 4 | 5 | 5 | C0 sealed; C1 |
| 8 | Kev micro-judgments | 2 | 3 | 4 | K1 is offline (stays 2); a Kev gate inside a run on E2 (3); the X8 comparison (4) |
| 9 | Honest verdicts | 2 | 5 | 5 | OD1 at $0 (2); OD1 against baseline acceptances in CX3 (4); OD1 on sealed (5) |
| 10 | Reuse and learning | 1 | 2 | 4 | Whole-workflow reuse pilot from W6; M18b vs a frozen control |
| 11 | Composition | 2 | 4 | 4 | M25 nesting by inlining vs flat (emulated; native `call` is representation, C6) |
| 12 | Swarm fan-out | 2 | 4 | 4 | `wide` vs B5 |
| 13 | Subagents in nodes | 2 | 4* | 4* | X1a vs B0-agent (*only with route (a); otherwise 2 and 3) |
| 14 | Parallel workflows (AMP) | 1 | 1 | 3 | M19b on the cloud; your AMP A/B |
| 15 | Board and private notes | 1 | 4 | 4 | M25 board-lite vs `wide` alone and B5 (board v1 only if it pays) |
| 16 | Node UI | 3 | 4 | 4 | U3 exit test with you |
| 17 | Auditability | 2 | 3 | 3 | `verify-run` plus a tamper-injection red-team on the sealed round's records (3); a pre-registered detection comparison would be 4 |
| 18 | Efficiency | 3 | 3 | 3 | Load tests (instrument) |
| 19 | Security | 2 | 3 | 4 | Sink field; provenance taint; items 4 and 6; injection slice on sealed items |
| 20 | Real-world evaluation | 2 | 5 | 5 | R-bench runs 1 and 2; your tasks; the sealed 40 |
| 21 | Interactive, visual, game (new) | 1 | 2 | 5 | M13-ENV built and tested (2); C5 pilot (4; by 11-22 if it reads in W6); `sealed-3` read (5) |
| 22 | Integration, end to end (new) | 0 | 3 | 3 | E2E-0, composed dry run (3); E2E-2 in January (4–5 if it runs) |
| | **Depth ≥ 4 / ≥ 5 (of 22)** | **2 / 0** | **11 / 4** | **17 / 6** | without route (a): 10 / 4 and 16 / 6 |
| | Sum, original 20 layers (of 120) | 43 | 71 | 81 | the first draft's 45 → 67 → 78 over-credited Kev, verdicts, router, templates and audit |
| | Sum, all 22 (of 132) | 44 | 76 | 89 | |

No layer reaches 6 without your recurring tasks (decision 11) [I].

---

## 8. Owner decisions, in the order the plan needs them

| When | Decision | Default if unanswered | What it unblocks |
|---|---|---|---|
| Now | Kev training: THESIS D13 (waits) vs README L337 (approved) | J0/J1 now; curve only on ports where Haiku 5.5 leaves headroom | K2/K3 |
| Now | Freeze Kev data-factory scope at wave A until K1 reads | Yes | Risks S6, S7 |
| **By 10-12** | **R-5:** build R-bench items 6–30 now (no new money; about 38 agent-hours earlier) | Yes | M10; run 2 in W5 |
| **By 10-16** | **Executor route:** (a) a ROADMAP §3 amendment allowing a capped, Foundry-owned tool loop with no new credential (X0 drafts the text); (b) a proxy key (D10) for Claude Code inside nodes; (c) fallback only | **(a)** (changed from (c)) | X1a; τ² and AppWorld; the 209 tool-loop items; a "Haiku with tools" builder on outside tasks |
| By 10-16 | **Sealed-round design:** 30 tasks per family at K 1 plus a pass^3 subset; B0-agent added; CX5 as a virtual arm; **the Haiku 4.5 stress arm moves to CX3** (a change to decision 10) | Yes | M4 |
| By 10-16 | **If OD1 misses its floor:** (i) run the sealed round with OD1 reported, not gating; (ii) wait up to two weeks for one fix | (i) | M4 timing (§5.3) |
| By 10-16 | Who reviews the skeleton library | Claude-reviewed, labelled so | M2b; ROADMAP §6 (execution authority outside the model) |
| Any time | M8-K0: one laptop evening and one open-weight model id in the policy file | Yes, once you give an id | K0 |
| Any time | "Full speed" applies to the run slots (4 once calibrated) | Full speed | §4.1 |
| **By 10-19** | **D1-cap** for October–January, and **what it covers** (proposal: experiment calls only; agent time under the weekly allowance budget) | Current rule: $500 pause per experiment, $1,500 soft cap; work stops at the cap | M4 onward; R-bench run 2 in W5 |
| By 10-26 | Items 31–100 (the sealed 40 built by isolated sessions; about 105–130 agent-hours) | Yes | The sealed-40 read in W8 |
| **By 10-28** | **Decision 9:** 20–30 of your tasks (a 10-minute intake each; a third of the examples held out); **R-1:** tag the R-bench items you would want done | Rung 3 runs on your R-1 tags | M11, M21 |
| November | R-bench run 2 above $500 (or its cheaper T1+T2, K 1 variant) | The cheaper variant | M10 |
| By 11-23 | **Decision 11:** your 10 most frequent recurring tasks, or redacted ARC/AMP logs | R-bench N_item as the recurrence proxy; depth 6 unreachable | M18, M18b, M22 |
| January | D4 (AMP integration as a Phase 7 A/B), trigger activation authority (before S3), remote-compute credentials for Tier B/C | Deferred | M19, S3, Phase 8 |
| Any time | D14 usage rule; the ambition sentence (decision 1); heal auto-promotion scope; heal's structural ops | Not adopted; left open; guard-adding ops only; structural ops go to your review | — |
| Any time | Spot-check three claims in 10-STATE or here against their cited files (W16) | — | Trust in the next plan |

**Proposals for the docs owner** (this file does not edit `docs/` or the README): carry R7–R14 into ROADMAP §6 (R8
changes R5's "family-clustered CI" for designs with fewer than about 10 families); the ROADMAP §3 amendment text if you
choose route (a); README's cost ledger gains a row for orchestration (10-STATE §3.10); README drift (stage-1 status, 220
vs 217, the Kev contradiction, the "$560–825" figure).

---

## 9. The five experiments that set direction

Retitled from "the five decisive experiments": at the planned sizes most of them **inform** rather than decide (R7).
The odds are my guesses, from the same model family that wrote the beds (W16); each is recorded in its
pre-registration and Brier-scored after the read (R9).

| # | Experiment (reads) | Cost | Decides or informs | If it comes out well | If it comes out badly | My odds |
|---|---|---|---|---|---|---|
| 1 | **C0 sealed round, rehearsed by CX3** (11-11, likely 11-18) | ≈ $215–265 + $70–145 | **Decides** on CPS ratio (≥ 30%); informs on success | Haiku-built ≈ Opus-built and F beats the best of a single call and Claude Code: "Haiku constructs" stands; scale construction (R-bench 30 → 100, C1, reuse) | Opus ≫ Haiku: Haiku runs and edits, Opus builds, the CX5 cascade is the default and templates are the main lever. W1 fires: the claim shrinks to reliability, audit and cost where single calls and plain agents fail; the router defaults to direct; swarm and reuse work drops in priority. B1 ≥ F: typed IR only where verdicts, replay or audit are needed | W1: supported ≈ 35%, fires ≈ 30%, inconclusive ≈ 35%; Haiku non-inferior to Opus ≈ 45% |
| 2 | **Oracle-discovery yield, the OD1 pair** (10-14 at $0; CX3 10-30; sealed) | inside M2a, M3, M4 | Informs (6–9 builds per arm); sets the `unverified` gate | Verdicts become informative: heal, router labels, reuse admission and the viewer can use `pass` | "Honest but blind": field runs stay `unverified`; construction is reserved for task classes with executable checks; acceptance elicitation becomes mandatory for your tasks; Kev's verdict ports gain weight | ≥ 80% rejection with ≥ 98% acceptance on half the Haiku builds ≈ 30% |
| 3 | **The wild read:** R-bench run 1 (11-01) → run 2 on 30 items (11-15) → your tasks (11-22) → the sealed 40 (early December) | ≈ $85–300 + $400–900 + $25–75 + $150–300 | Run 1 and your tasks inform; run 2's CPS may decide; the sealed 40 decides | The workflow pitch holds on work Claude did not write; R-bench grows to 100 | F below single calls on T1 and T2: the pitch narrows to recurring tasks with cheap checks. F loses to Claude Code on your tasks: the product becomes router plus direct calls plus audit, not construction | F-opus→haiku ≥ 3 of 5 on T1 in run 1 ≈ 50%; F not below the best baseline on your tasks ≈ 45% |
| 4 | **Heal and edit: EX1a (10-25), EX1b (11-08), EX2 (11-15)** | $60–200 + $20–50 | Informs (≈ 40–60 incidents needed for a 20-point difference) | Heal into `src/` at E2; lessons feed the kit; structural ops let heal add what is missing; edits replace rebuilds | Heal ≤ rebuild: heal becomes "rebuild with the failure as a probe" and the patch machinery is parked; edit ≤ rebuild: "edit" becomes "rebuild with the diff as a probe" (THESIS D9 narrows) | Heal supported ≈ 20%, refuted ≈ 30%, inconclusive ≈ 50%; EX2 edit non-inferior and cheaper ≈ 45% |
| 5 | **Composition by emulation, M16 + M25** (11-15) | $110–220 | Informs unless effects are large | Nesting, `wide` and board-lite each earn their native builds (`call` for value, board v1, a swarm default); the composed dry run in W8 and E2E-2 in January have parts worth composing | Each refuted part stays representation-only; the composed run shrinks to what survived | `wide` beats B5 per $ ≈ 35%; board-lite ≥ 15% over `wide` ≈ 25%; nesting beats flat on decomposition tasks ≈ 40% |

**Runners-up.**
- **RX1 + RX1b, the router's two axes:** likely inconclusive at pilot size; RX2 and RX4 are where the slider gets real
  numbers. Need-axis supported ≈ 25%; size-axis supported ≈ 35%.
- **K1, Kev vs Haiku 5.5:** decides the laptop lane and about 39K lines of data-factory code. A trained Kev beats Haiku
  and rules on at least one port ≈ 30%.
- **X1a, the capped tool loop vs Claude Code alone:** decides whether subagents and the 209 tool-loop items can run
  without a new credential. Supported ≈ 30%.
- **The C5 pilot and the `sealed-3` read:** decide whether game QA gets its own machinery. Supported ≈ 35%.
- **M18b, the learning curve:** decides whether "learning" is more than "reuse". Supported ≈ 30%.

---

## 10. What this plan does not fix

- **Correlated authorship.** Claude wrote every bed, harness, builder prompt, lint rule, critique and this plan. The
  sealed families, the isolated-session sealed 40 and your tasks reduce this; your spot checks remain the main guard
  [D 10-STATE S3].
- **Power.** Most reads before December inform rather than decide. Only CPS ratios in the sealed round, R-bench run 2
  and the sealed 40 can be powered; +10-point success claims need 116–234 paired tasks [D ROADMAP §4.3]. Three-outcome
  rules make that visible instead of letting noise kill or keep a component.
- **One-shot models catching up** (10-STATE S1). Each model release can erase a workflow's margin. The plan
  re-qualifies after model changes but cannot prevent it.
- **Emulation is not representation.** Inlined nesting, board-lite and the capped loop answer "does it help?", not
  "does the IR represent it?"; C6 still counts only native, compiled constructs.
- **The docs drift** that 10-STATE lists belongs to the docs owner (§8 proposals).

---

## 11. Sources

- State and numbers: [10-STATE.md](10-STATE.md) (§1–§7, including §3.9 heal and §3.10 orchestration); README "Status",
  "Cost ledger", "Owner decisions needed", L325; `docs/THESIS.md` §10; `docs/ROADMAP.md` §3 (L769–770), §4.1–§4.3
  (L801–815, L841–845, L890–893), §5 (L1070–1075), §6.
- Critiques: [11-CRITIQUE-ambition.md](11-CRITIQUE-ambition.md), [11-CRITIQUE-rigor.md](11-CRITIQUE-rigor.md).
- Existing plans: [00-SYNTHESIS.md](00-SYNTHESIS.md) §3.5, §3.15, §5–§7, App. C; [02-ir-expressiveness.md](02-ir-expressiveness.md)
  §3.G, §6–§8, L1015–1050; [02b-agentic-constructs.md](02b-agentic-constructs.md) §4.1, §5; [03-swarms-frontier.md](03-swarms-frontier.md)
  §3; [05-router-constructor.md](05-router-constructor.md) §2.10, §3.3, §4; [06-ui.md](06-ui.md), [06b-run-history.md](06b-run-history.md);
  [07-context-subagents-audit.md](07-context-subagents-audit.md) §3.2, §7; `research/replicate-20261008/DESIGN.md` §0,
  §4, §6, §8, §10–§11; `research/kev-20261007/JUDGE-PROGRAM.md` §0, §3.1, §7.4, §8, §10–§11;
  `research/kev-20261007/LAPTOP-THROUGHPUT.md`; `research/heal-20261008/DESIGN.md` §0, §7.1, §7.5, §10–§12, §14;
  `research/distill-20261007/DESIGN.md`; [ROADMAP-AMENDMENTS.md](ROADMAP-AMENDMENTS.md) R-3.
- Measured here: `node -e` summaries of `experiments/runs/c0-dev/{constructions,results}.jsonl` and
  `experiments/runs/p1/results.jsonl`; `policy/models.json` prices; `beds/sealed/MANIFEST.json`; `grep` of
  `src/runtime.mjs` (scheduler comment at L462–468 in the working tree), `bin/foundry.mjs` (no `cancel` command),
  `src/models/port.mjs` (L114, L160), `src/models/providers/claude-cli.mjs` (L97), `experiments/lib/runner.mjs` (L19),
  `src/executors/claude-code.mjs` (L17–23, L58), `src/executors/sandboxed-command.mjs`, `src/ports.mjs`; the heal
  lineage `experiments/heal/runs/live-20261008/p1.lineage.jsonl` (v2 `6bc2eec9…`, v3 `309dccb6…`); the heal campaign
  tally and orchestration pricing listed in 10-STATE §3.9–§3.10; `find research experiments -iname 'PREREG*'` (only the
  P1 and C0-dev pre-registrations and the template exist).

---

## 12. Review log

Two critiques of the first drafts (10-STATE at 21:52, 11-NEXT at 22:10) arrived at 22:32–22:33 UTC. This revision
applied every P0 and P1 and the cheap P2s, re-measured what had moved since, and recorded where a critique was itself
wrong. "Applied" names where; "partly" says what is missing and why. Edits that belong to other owners (heal DESIGN,
ROADMAP, README, the experiments code) are applied *in this plan* as deliverables or proposals; their files were not
touched.

### 12.1 New measurements taken for the revision

| What | Result | Where |
|---|---|---|
| Heal campaign, final | 35 proposer rounds; 30 refused (invalid op 13, still fails 10, no discrimination 3, literal leak 3, lint not cleared 1), 1 budget-stopped, 4 valid of which 3 blocked by H-cfx's lint debt and 1 promoted (H-p1, model variance); retry controls: H-p1 base 8/8 vs healed 8/8 at +16% cost; H-rec base 0/4 and Sonnet-escalated 0/4, verdict field `pass` on all 8; $6.41 over 399 ledger lines; no heal process at 22:40 | 10-STATE §3.9 |
| Orchestration cost | 255 subagents, 138.7 agent-hours, $1,820 list lower bound ($13.12 per agent-hour; 10-08 alone $1,213); main session $121; about 20× the experiment spend | 10-STATE §3.10; §1.1, §6 here |
| Scheduler | Present in the working tree (`src/runtime.mjs:462-468`, 22:32), uncommitted and unreviewed; cancel still absent | 10-STATE header, §1 |
| E1 re-qualification artifact | records-v3-hand v2 `6bc2eec9…` (lint-debt); v3 `309dccb6…` adds `k_sample_agreement` | M1 |
| Kev data size | about 39.4K `.mjs` lines (34.6K at the first draft) | 10-STATE §1, S6–S7 |
| Tool-loop reach | 209 of 1,559 by `ir.verdict` token (100 + 99 + 10) | 10-STATE §3.3; M15 note |

### 12.2 Ambition and completeness critique

| Finding | Disposition | Where |
|---|---|---|
| **P0-1** Interactive, visual and game tasks missing | Applied | 10-STATE row 21, gap 4; M13-ENV with the C5 pilot; M4b `sealed-3` read in W7; M12 Tier A and τ^τ; §7 row 21 |
| **P0-2** Integration last; composed system in February | Applied | M24 E2E-0 (W2); M25 merged into M16 (W5); M17 rebased on board-lite and `synth`; R14 E1x and 2 engine branches; M22 design W7, dry run W8, run in January; 10-STATE row 22, gap 5 |
| **P0-3** The slider's "how big" never measured | Applied | RX1p rule limited to the need axis; RX1b; 10-STATE row 3 gap; RX1 full adds builder-v0 artifacts before any kill |
| **P0-4** Oracle discovery buried in the longest pole | Applied | M2 split into M2a (OD1 at $0 by 10-14; acceptance elicitation), M2b, M2c; R12 OD1 beside every F arm; 10-STATE row 9; M21 reports elicitation share and your minutes |
| **P0-5** Real-world replication small and late | Applied, with a correction (§12.4) | M10 windows (build 6–30 now, run 2 W5, sealed-40 read W8); building gated on kit and health, running on the scale-up gate; decisions R-5 → 10-12, items 31–100 → 10-26, D1-cap → 10-19 |
| **P1-1** Heal cannot "make what's missing"; builder repair duplicates heal | Applied in the plan; the op definitions are proposals for heal DESIGN §7.1 (heal lane's file) | M6a structural-ops arm; M2c repair = heal's engine; variance precondition; heal-shadow; M18b counts defect recurrence |
| **P1-2** "Edit" is more than repair | Applied | M6c EX2 |
| **P1-3** Learning has no experiment; reuse waits on `call` | Applied | M18 (`call` for sub-workflow reuse only; whole-workflow pilot from W6); M18b; 10-STATE row 10 |
| **P1-4** Executor default narrowest | Applied | Route default (a); M15-X1a on E1x; M12 τ²/AppWorld after X1a; "Haiku with tools" arm in M10 and M21 |
| **P1-5** Calendar in engineer-days; strict freeze reading | Partly: effort cells carry agent- and review-hours by one stated conversion (ah ≈ ed, rh ≈ 0.35 ah), not a per-cell calibration, because only the R-bench pilots and 10-08 as a whole give calibration points; re-plan at the end of W1 | §3 preface; §5.4 (review first); §5.5; R14 |
| **P1-6** Concurrency limits override "Full speed" | Applied | §4.1 low and full-speed schedules; default full speed once calibrated |
| **P1-7** Credit split; skeleton library too small | Applied | M3 S-haiku-noskel and structure source; M2b ≥ 20 skeletons and coverage; skeleton-miss rate in M9, M10, M21 |
| **P1-8** Kev gate compares the wrong Kev; in-loop latency untested | Applied (merged with rigor P1-8) | M8-K1 corrected rule; M8-K4/K5 bridge latency and availability |
| **P1-9** "Akin to a 9b model" untested | Applied | M8-K0 |
| **P1-10** EX1 schedule contradicts itself | Applied (merged with rigor P0-4c) | M6a, M6b, heal-shadow |
| **P1-11** Parallel workflows measured as AMP context | Applied | M19b |
| P2-1 Breadth column | Applied in 10-STATE §2; 11-NEXT §7 reports counts per depth instead | 10-STATE §2 |
| P2-2 Order external benchmarks by what can run | Applied | M12 |
| P2-3 UI completeness | Applied | M20 |
| P2-4 "Adapt while running" (`expand`) | Partly: listed for December "if capacity", not scheduled, because it adds engine-adjacent work before S7 with no pre-registered experiment yet (R6) | §5.2 |
| P2-5 Dogfooding | Partly: listed after X1a and S5 (February) | §5.2 |
| P2-6 Load tests; replay unchanged nodes | Applied | W2; M2c |
| P2-7 Ask for owner inputs actively | Applied | M11 intake; R-1 fallback; R-bench N_item for decision 11 |
| P2-8 Heal update | Applied and superseded by the final tally | 10-STATE §3.9 |

### 12.3 Rigor and feasibility critique

| Finding | Disposition | Where |
|---|---|---|
| **P0-1** 300 s timeout biases workflow-vs-call reads | Applied | R11; M1 (experiments-lane override and fault class); health gates in RX1, `rbench-r1`, E1 re-qualification and `PREREG-sealed`; 10-STATE §1, plain words; §1.1 here |
| **P0-2** The sealed round cannot decide | Applied; the changes to decision 10 and to the design need your confirmation | M4 (B0-agent; 30 tasks × K 1 + pass^3 subset; CX5 virtual; Haiku 4.5 to CX3; three-outcome W1; ≈ $215–265); §8 |
| **P0-3** Under-powered; kill rules lean | Applied | R7–R9; every §3 rule in three-outcome form; §9 retitled with "decides or informs"; 10-STATE S11 |
| **P0-4a** E1 isolation disables the Claude Code arms | Applied | R13 two profiles; M15-X0 gate at E2 |
| **P0-4b** OD1's likely outcome blocks the sealed round | Applied | §5.3 pre-picked branch; prereg ≥ 3 working days after CX3 (sealed round now 11-05 → 11-11) |
| **P0-4c** EX1 before its natural failures | Applied | M6a / M6b; M7 depends on EX1b |
| **P0-4d** M2's kill after CX3 starts | Applied | M2c assessed 10-25; fallback postpones CX3 |
| **P0-4e** Security item 6 undelivered | Applied | M1; M9 gates B1-haiku on it |
| **P0-4f** Provenance taint may need `src/` | Applied | M0 decision; joins M1 if so |
| **P0-5** Binding constraint and effort unmodelled | Applied; orchestration priced in this revision | 10-STATE §3.10; M0 calibration gate, meter budget and drop order; §5.5; §6 agent-time rows |
| **P1-1** Headline omits the build cost | Applied | 10-STATE plain words, row 7, §3.1 |
| **P1-2** Heal state stale; first promotion only ties retry | Applied and updated | 10-STATE §1, §3.9; V3b; EX1 headline exclusions, independent catalog, lint-clean hosts (M6a) |
| **P1-3** OD1 can be gamed | Applied | M2a OD1 pair, sanity rows, independent frozen mutant generator; M9 extends G10's alternative designs |
| **P1-4** CX3 in-sample | Applied | M2b source firewall; M3 `records` in-library, "a win does not raise the prior"; skeleton reviewer in §8 |
| **P1-5** RX1 single builds; repeated worlds | Applied | M14-RX1p |
| **P1-6** No global seed ledger | Applied | R10; M0; EX1's V7 moved off 2001+ |
| **P1-7** Owner tasks lack oracle protocol, baseline, gates | Applied | M11; M21 |
| **P1-8** K1 tests the wrong question; growth continued | Applied; the scope freeze needs your confirmation | M8-K1; §8 |
| **P1-9** E1 freezes unreviewed code; E2 big-bang | Applied | M1 stage-1 review; M1b; R14 staged E2 |
| **P1-10** Heal on third-party data; AMP context | Applied | M7 gate; M19 gate |
| **P1-11** Missing kill rules and baselines | Applied | M2a, M13-S0a, M13-H, M12, M19, M22, M9 |
| **P1-12** Depth projections over-credit | Applied | 10-STATE §2 (Kev 2, verdicts 2) and rubric rule; §7 here (router 2 at 11-22, templates 4 only via the no-skeleton arm, audit 3) |
| P2-1 to P2-16 | Applied: counts per depth (P2-1); flag n and price-tier caveat (P2-2); `map1000` tagged unpreserved, copy in M0 (P2-3); RX1 10–13 h (P2-4); three spend figures (P2-5); 209 tool-loop items (P2-6); executed coverage per platform (P2-7); J0c read time (P2-8); E1 artifact by hash (P2-9); "$560–825" superseded (P2-10); D1-cap by 10-19 with coverage defined (P2-11); C1 pre-check (P2-12); M16 arm list (P2-13); `sealed-3` scheduled (P2-14); test counts with commit (P2-15); 131K lines (P2-16) | 10-STATE §1–§3; §1, §3, §6 here |

### 12.4 Where the critiques were wrong or have been overtaken

- **Ambition, "46/140".** 22 layers × 6 = 132, so with rows 21–22 the first draft's figure was 46 of 132; corrected, 44
  of 132.
- **Ambition, §5 cost table.** It moved R-bench run 2 into W5 but kept its $400–900 out of the window through 11-22;
  §6 here includes it, which is why the through-11-22 total rises to $1.2–3.0K rather than the critique's $0.76–2.0K.
- **Both, the heal count.** "0 of 24" (ambition) and "26 proposals, 1 promoted" (rigor) were right at their read times;
  the campaign then ran H-cfx a fourth time and an H-rec escalation control. The final count is 35 rounds, with the
  conclusion unchanged: 0 fixes beat retry.
- **Rigor, agent-time price.** Its $0.9–1.5K for 100–170 ed used the R-bench compression and rate alone. With the
  measured $13.12 per agent-hour across all 255 subagents, review-hours added, and the revised 130–220 ed, the estimate
  is about $2.3–3.9K through 11-22.
- **Ambition vs rigor on the sealed round.** Ambition kept it "unchanged" in W4; rigor's three-working-day gap after CX3
  moves it to 11-05 → 11-11. The rigor timing was applied; E2 and everything after it shift by about three days, absorbed
  within W5.
- **Ambition vs rigor on the executor.** Both were applied: E1 ships two profiles (rigor), and the capped loop runs on
  an E1x experiment branch from W1 (ambition); the route's gate on the engine moves to E2.
