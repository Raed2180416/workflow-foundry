# PROOF-LEDGER: every claim of the maximal vision, and where its proof stands

*Started 2026-10-09 22:40 IST. One row per claim the programme makes, with the artifact that proves or refutes it, the
falsifier or decision rule it is held to, and its status. Status codes: **D** designed (document only), **B** built and
$0-tested (code + green tests), **P-dev** paid evidence on dev seeds (rehearsal, not a claim), **P** preregistered paid
evidence on held-out seeds, **N** negative result recorded, **—** not started. A claim is not "proved" below P with K ≥ 2
streams and the preregistered decision rule; "B" means the instrument exists and is honest, nothing more. Paths are
relative to this directory unless they start with `beds/`, `experiments/` or `docs/`. Update this file whenever a
status changes; it is the owner's single view of the programme.*

## A. Substrate: JIT compile → guard → deopt → heal on recurring tasks

| # | claim | proof artifact | falsifier / decision rule | status |
|---|---|---|---|---|
| A1 | Haiku can author a correct solver from scratch for a simple recurring task | C0 rerun 15/24 (DEV-NOTES D20); construction-20261006 B1 | per-task oracle, exact | P-dev |
| A2 | The compiled path reaches verified parity with the agent at lower cost over a stream | R0 records pair running (R0-RUNBOOK; `runs/jit-r0-records/`); PREREG-stream.md | stats.mjs DECISION_RULE: McNemar + lineage bootstrap, K ≥ 2, env-fault rule > 25% impaired = invalid | P-dev (running) |
| A3 | Runtime-learned guards catch drift before a wrong answer ships | AST guard diff 10/12 mutants, 0/10 refactors (D20 row 7); profile.mjs | false-alarm rate on real recompiles unmeasured | P-dev |
| A4 | Shadows + adjudication accept only not-worse versions | stream.mjs shadowFloor 0.25, acceptance reject-if-worse; D16 non-transitive comparator | comparator order dependence recorded (D16) | B |
| A5 | A tolerant comparator at relTol 0.05 separates right from wrong on kinetics | Stage B: 0/15 correct–correct pairs disagree; 13/13 wrong answers differ in the exclusion set (D23, `analysis/kinetics-gauge/out/stage-b/`) | FG §4.1 O1 for the freeze | P-dev |
| A6 | Builders run isolated: no host credentials, no mounts, honest root check | ISOLATION-PROBE-laptop.md; nested userns uid drop; env allow-list (b018f5d); live smoke | 27 → 0 credential-named vars; `/dev/nvidia0` gone | B |
| A7 | No seed is reused across dev, rehearsal and held-out | SEED-LEDGER.json, seeds.mjs assertSeedsAllowed; G3 corrected (flip after the run) | config refused on a spent range | B |
| A8 | Decisions are preregistered and powered | PREREG-stream.md (TBDs open: caps, ε, relTol, env-fault rate); stats.mjs power table (K=2 decides gaps 23–52 pts) | — | D→B |
| A9 | Quota is the currency: cost is measured, never imputed silently | quota-meter; accounting fix `neverStarted` (D15); costUnknown booked at bound | G4 smoke | B |
| A10 | A judge call is cheap enough to fan out | D22: $0.00011, 1.4 s per Haiku judge call | latency, not dollars, binds | P-dev |
| A11 | Held-out claim (the stream thesis) | PREREG freeze after R0/R0-K; seeds 8001+/8101+ | as A2 | — |

## B. The complexity ladder (W-bed): can Haiku build what humans hand-curate?

| # | claim / rung | proof artifact | falsifier (W-BED.md §3) | status |
|---|---|---|---|---|
| B0 | The router says "no workflow" when none is needed | beds/wbed/r0 | route precision scored | B |
| B1 | R1 linear typed pipeline ("ledger close"): H/H builds it | beds/wbed/r1, exact oracle, 16 controls | H/H second-half success > 10 pts below reference in both streams | B |
| B2 | R2 judged branching ("inbox router"): a keyword rule is not enough | beds/wbed/r2, 18 controls, keyword rule fails 0.42–0.65 | as R1 + review-queue precision/recall gap > 0.2 | B |
| B3 | R3 fan-out/fan-in ("statement audit"): one context cannot do it | beds/wbed/r3, N 8→48, d5 ≈ 63K tokens | as R1; sequential solve must fail on size | B |
| B4 | R4 nested sub-workflow ("group consolidation"): reuse by hash beats re-derivation | beds/wbed/r4 (102 bed tests), scoreReuse, planted CYYDDD packs refused 24/24 | construction spend with reuse not below isolated, or wrong reuse > 5% of child calls | B; **blocker found**: slice-1 profile falsely refuses 5/18 (d3), 13/24 (d4) in-profile children (W-BED-R4-NOTES §10) |
| B5 | R5 agentic node ("legacy dump"): an agent node with a verify predicate is necessary and buildable | beds/wbed/r5 (building, 2026-10-09 22:xx) | H/H never produces an accepted solver with an agent node, or verify misses > 1/20 wrong decodes | building |
| B6 | R6 swarm ("wide research table"): `wide` beats best-of-n at equal tokens | — | `wide` does not beat `best_of_n` on verified success at equal tokens | — |
| B7 | R7 effects, waits, approvals | parked (W-BED §3.7) | — | parked |
| B8 | R8 injected faults at run time: diagnosis before repair | fault hooks in lib/faults.mjs (no-ops) | heal classifies the fault first | hooks only |
| B9 | RH held-out rung ("lab consolidation", kinetics domain) | W-BED §3.9 | as the rung it composes | D |
| B10 | Reference workflows (arm c): the hand-curated thing to beat | structure.outline per rung | Opus-written, frozen by hash | — |
| B11 | Triviality / necessity attacks: the rung is not solvable trivially | attacks/triviality.mjs (dry-run driver) | one-call Haiku solve must fail; necessity controls must fail | B (dry-run), paid — |
| B12 | Curriculum reuse (CUR vs ISO lineages): later rungs reuse earlier modules | W-BED §5 | reuse quantities (THESIS-JIT §6.7) | D |
| B13 | Corpus rungs W-C: real hand-curated workflows as replication families | replication census: conformance works at τ=1 only; too few oracle families (D21) | kill rule fired for replication families | N (kept as reference graphs) |

## C. Primitives the ladder needs (flow-v3)

| # | primitive | artifact | status |
|---|---|---|---|
| C1 | `flow.call(hash)` with budget carving, depth, memo, profile refusal | experiments/jit/flow-v3.mjs, call-host.mjs (37 tests; FLOW-V3-SLICE1.md) | B (slice 1) |
| C2 | Local deopt / interpret-child, per-call prompt, `name`, profile options, budget under map | `_local/flow-v3-slice2-brief.md` (launch after R0) | — |
| C3 | `flow.agent` with verify predicate and harvest | FLOW-V3 §2.2 | — |
| C4 | `flow.wide` swarm operator | FLOW-V3 §2.3 | — |
| C5 | `flow.plan` bounded runtime dynamism | FLOW-V3 §2.4 | D |
| C6 | Stream wiring (prompt v5, compile, run-compiled, services, per-arm registry) | FLOW-V3-SLICE1 §3 | — (E2 record) |

## D. Library-first construction (the universal library)

| # | claim | proof artifact | decision rule (LIBRARY-TESTS.md) | status |
|---|---|---|---|---|
| D1 | A closed vocabulary of 30 constructs + 54 patterns explains 97.8% of 1,559 workflows from 49 platforms | design/library/L0, L1 §2, tools/pattern-census.mjs | L1-a 60-item hand audit, detector precision (running 2026-10-09 22:35) | D; audit running |
| D2 | Haiku is never overburdened: ≤ 8K input tokens per constructor call, enforced by code | LIBRARY §5.2; experiments/library/context.mjs (building) | T2 | building |
| D3 | 12 first-slice patterns are executable cards with fixtures | experiments/library/cards (building) | T4 (≥ 36 fixtures) | building |
| D4 | A composition checker catches wrong compositions statically | experiments/library/check.mjs (building) | T3 one mutant per code | building |
| D5 | Code-first retrieval finds the needed patterns; Jev adds recall at small k | LIBRARY §4 | L2 precision@k vs embedding baseline | — |
| D6 | Library-first Haiku matches JIT H/H on R1–R3 at a fraction of construction cost | arm (g) | L3: parity on verified success, ≥ 30× cheaper construction | — |
| D7 | Wrong reuse stays ≤ 0.05 without refusing most correct reuse | applicability gate | L4 kill: Wilson upper bound > 0.05 after ≥ 60 decisions | — |
| D8 | The overburden curve has a small optimum k | — | L5 | — |
| D9 | Corpus edge-case checklists reduce latent-defect failures | — | L6 (L6-a checklist-vs-known-failures running) | audit running |
| D10 | Retrieval quality holds at 50 / 500 / 1,500 items (the utility problem) | — | L7 | — |
| D11 | Buildability: 26.9% of corpus items buildable on existing solver code, 48.4% with the engine envelope, 65.6% if the host owns triggers; cross-run `state` is the first missing node | L1-PATTERNS §7 | engine column (BUILD-ORDER §5) | D (measured on the census) |

## E. Jev as ranker and gate

| # | claim | artifact | rule | status |
|---|---|---|---|---|
| E1 | Jev is an independent judge of Claude's work | research/judge-20261009/J1-JEV-DEV.md | — | **N**: not independent |
| E2 | Each port beats its code baseline before holding any gate | JEV-PORTS.md (applicability, pattern choice, slot completeness, risk, quarantined read, failure class) | L8 calibration per port; promotion/demotion | D |
| E3 | Quarantined read keeps planted instructions out of the index | T7 (200-item planted set) | recall ≥ 0.95 at ≤ 5% false alarm | — |

## F. Self-heal: drift and latent defects

| # | claim | artifact | rule | status |
|---|---|---|---|---|
| F1 | A stored workflow survives schema drift, tool failure and adversarial content by classifying the fault first | heal kit (experiments/heal, frozen 880c6b9), R8 overlay | T4a drift test | partial (IR workflows only) |
| F2 | A latent defect found on a later run triggers a retroactive sweep: replay, mark affected outputs and callers, relabel the judgments that admitted them | LIBRARY §7.5; BUILD-ORDER step 8 | T5; T4b planted-defect test | D |
| F3 | Heal proposals are never self-approved | rule: p-a3336190-r4 | — | rule |

## G. Deployment inside a host harness

| # | claim | artifact | rule | status |
|---|---|---|---|---|
| G1 | route / run / construct over MCP; traces ingested from SubagentStop / TaskCompleted hooks | HARNESS-INTEGRATION.md | route precision, reuse rates, share of decisions by code | D |
| G2 | A host agent with the Foundry library beats the same host agent alone over a stream (inverted arm f) | W-BED §4 arm (f) | cost at verified parity + improving library | — |
| G3 | Normal chats need nothing (the router says none) | R0 rung (B0) | route precision | B |

## H. Negative results kept (they shape the design)

- Skills reuse 0/21, all false successes (THESIS §6) → wrong-reuse rate is the headline metric (D7).
- Jev not independent of Claude (E1) → ports gate nothing until they beat baselines.
- Corpus replication families too few (D21) → corpus is a source of reference graphs, not replication.
- C0 single-order reads wrong at a dated cutoff (D20) → one order per task is the wrong unit.
- Slice-1 profile false refusals 30–55% on in-profile children (B4) → profile options and `novel: warn` before any paid ladder run.

## I. Proof pipeline from here (order, each unblocking the next paid proof)

1. R0 finishes → export commit, ledger flip (records) → R0-K → PREREG freeze → held-out stream (A11).
2. flow-v3 slice 2 (C2–C4, E2 freeze record) → R5/R6 beds complete → Opus reference workflows (B10) → first paid W-bed
   run R1–R4, K=2 lineages, ≈ $115–250 list (B1–B4 falsifiers).
3. Library code steps 1–8 → audit L1-a (D1) → L2 retrieval → arm (g) pilot (D6) → L4 wrong-reuse (D7).
4. Heal: T4a drift and T4b planted latent defect with the sweep (F1–F2).
5. MCP host integration + inverted arm (G1–G2): the deployment claim, last.

## J. Proofs added on 2026-10-09 night (owner: "be creative where needed")

| # | claim it tests | design | status |
|---|---|---|---|
| J1 | **Held-out platform coverage (L1-b).** The 97.8% (D1) is in-sample: the vocabulary and patterns were mined from the same 49 platforms. Draw ≥ 3 platforms NOT in the corpus (candidates: Windmill, Kestra, Pipedream, Make, Power Automate, Step Functions, Logic Apps, Camunda/BPMN, Huginn, Airbyte), fetch ~10 public workflows each, hand-label with L0 + L1, report out-of-sample coverage with a Wilson interval and every construct the vocabulary lacked | $0 (Sonnet, WebFetch); decision: out-of-sample coverage within 10 pts of in-sample, else L0/L1 are corpus-fitted | — (launch after the L1-a audit) |
| J2 | **Defect miner (red team for latent defects).** For each kept W-bed solver, an Opus agent tries to construct an in-profile input that breaks it; found defects become the planted set for T4b and the retroactive sweep (F2), so the heal claim is tested on real defects, not synthetic ones | $0 at construction time; the sweep then replays past outputs | — (after the first accepted solvers exist) |
| J3 | **Structural fidelity as a descriptive trace.** W-BED §6.3: the edit distance between the JIT-built graph and the hand-curated reference, never a success criterion, but reported per rung so "Haiku built the same thing" is visible | census distance exists (replication/lib) | D |
