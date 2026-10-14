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
| B5 | R5 agentic node ("legacy dump"): an agent node with a verify predicate is necessary and buildable | beds/wbed/r5 (c3c4025: 22 tests, W-bed suite 127/127), 11 formats in three tiers (novel only at d5, split-specific), 34 controls, W-BED-R5-NOTES | H/H never produces an accepted solver with an agent node, or verify misses > 1/20 wrong decodes. Bed facts: the necessity control (dev-format parsers only) fails 14/20 at d2–d4 and 20/20 at d5; the verify (trailer with hash totals) has 0 misses in 1,100 + 400 wrong decodes (16/1,100 without the hash totals) | B. **Engine needs** for the agent node (NOTES items 10–17: verify reads the dump files, retry carries the failure reason, profile sees `files`, a shipped `decoder.mjs` never runs, budget reservation, trace step `decode-dump`) go to flow-v3 slice 2 / the E2 record |
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
| D1 | A closed vocabulary of 30 constructs + 54 patterns explains the corpus: on 60 hand labels, 88.4% of 1,559 workflows from 49 platforms (Wilson 75.0–95.1%) with Node-RED dashboard apps read as refusals, 96.1% (85.2–99.1%) with them read as explained. (Drafted as "97.8%", which was the census's count of items it does not refuse.) | design/library/L0, L1 §0, tools/pattern-census.mjs (revision 1, a candidate generator); **AUDIT-L1.md** (L1-a, 60 stratified hand labels, fixed seeds) | L1-a: rule precision ≥ 0.85, falsifier < 0.75 | **N: L1-a fails again on the re-audit of the revised census (design/library/AUDIT-L1-REAUDIT.md, 2026-10-14)**. Fresh 60-item draw (seed 20261014, L1-a's items excluded), blind labeller Sonnet 5.5 on all 60 and a blind second labeller Opus 5.5 on a 10-item sub-draw; the owner's 10-item blind check was delegated to the orchestrator and replaced by that second model labeller (same-family models: correlated errors are not excluded, and no human has checked). Rule precision **0.713** (Wilson 64.7–77.1, 202 node-rule and token pairs), below the 0.75 falsifier; the second labeller gives 0.54 (25 pairs), and on the 25 pairs both judged the adjudicated figure is 0.54 against the primary labeller's 0.70. Revision 1 did not touch the failing node rules (AUDIT-L1 §8 item 4: tool nodes tagged `model`, P15, P20, P32, P33, the P29 regex), so the census stays a candidate generator and its support, budget split and the L2 gold built on it are not measurements. Coverage (hand labels, the only coverage figure): **93.6%** of the 1,549 non-first-party items (Wilson 82.3–97.9, Kish n 43.8) reading a Node-RED dashboard app as a refusal (headline, PAUSE §5.8), 95.9% (85.5–99.0) reading it as explained; 93.9% (86.5–97.4) pooling both audits' 120 labels. The labellers agree on "explained" on 9 of 10 items (kappa 0.74 strict). The 88.4% in the claim column is superseded: it extrapolated two sampled dashboard apps to about 120 items when the corpus has 16, and L1-a's own labels on the revision-1 strata give 94.3%. J1 compares with **93.6%**: it passes at ≥ 83.6% out-of-sample (strict); between 82.7% and 84.9% the result depends on the comparator. Next: J1; revision 2 (AUDIT-L1 §8 item 4) before any further precision audit; both before any library-first paid run |
| D2 | Haiku is never overburdened: ≤ 8K input tokens per constructor call, enforced by code | LIBRARY §5.2; experiments/library/context.mjs (`assemblePrompt` refuses with CONTEXT_OVER_CLASS_BUDGET, never truncates); tokens.mjs bound fitted on 1,243 real Haiku calls | T2 | **B (T2: the L0 card fits)**: cut from 3,643 to **2,962 tokens by the bound** (point 2,576) under its unchanged 3,000 S6 allocation (owner decision PAUSE §5.10, taken: cut, not raise); all 30 constructs and every rule the constructor contract and checker rely on are kept and asserted by phrase in T2; S6 assembles the card with every other part at full allocation within 8,000. T2 is still partial: the end-to-end constructor loop is BUILD-ORDER step 6 |
| D3 | 12 first-slice patterns are executable cards with fixtures | experiments/library/cards (P01…P54 card dirs, assemble.mjs, run.mjs), 36 fixtures through the real flow-v3 SDK and call host in stub mode | T4 (≥ 36 fixtures) | B (T4: 36/36 at $0; every drift fixture deopts with its expected kind; `flow.flagged` and `interpret-child` missing from slice 1, worked around) |
| D4 | A composition checker catches wrong compositions statically | experiments/library/check.mjs (`checkTree` / `checkSolver`) | T3 one mutant per code | B (T3: 24 mutants cover all 18 codes, each fires exactly its own; the clean reference tree fires none; P07 handler argument types unchecked statically) |
| D5 | Code-first retrieval finds the needed patterns; Jev adds recall at small k | LIBRARY §4 | L2 precision@k vs embedding baseline | — |
| D6 | Library-first Haiku matches JIT H/H on R1–R3 at a fraction of construction cost | arm (g) | L3: parity on verified success, ≥ 30× cheaper construction | — |
| D7 | Wrong reuse stays ≤ 0.05 without refusing most correct reuse | applicability gate | L4 kill: Wilson upper bound > 0.05 after ≥ 60 decisions | — |
| D8 | The overburden curve has a small optimum k | — | L5 | — |
| D9 | Corpus edge-case checklists reduce latent-defect failures | AUDIT-L1.md §6 (L6-a: 21 recorded failure causes from DEV-NOTES, FRONTIER-GAPS, BLOCKER-SYNTHESIS, construction reports, R8 fault classes) | L6-a: ≥ 50% of recorded failure causes named by a checklist line or §9 code | **N on the strict reading**: 6/21 named (28.6%, Wilson 13.8–50.0); 57.1% counting "partly". The 15 proposed lines are now in L1 (revision 1, 2026-10-14: §4 P03, P09, P16, P20; §5 P49; §9 eight codes incl. PROBE_COVERAGE, DOMAIN_WIDENED, NO_INPUT_GUARD), each tagged with its failure id and repo source, and the four executable cards carry theirs; the §9 codes need run-time evidence and are not enforced by check.mjs yet. L6-a not yet re-run on the revised checklists |
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
- L1-a hand audit (AUDIT-L1, 2026-10-09 night): coverage 88.4%, not 97.8%; detector precision 0.73 < 0.75 → the census is a candidate generator, not a measurement; six detectors removed, P37 split, re-census and re-audit on a fresh draw before J1 (D1).
- L6-a: the checklists name 6/21 recorded failures → edge-case checklists are corpus trivia until the repo's own failure classes are added (D9).

## I. Proof pipeline from here (order, each unblocking the next paid proof)

1. R0 finishes → export commit, ledger flip (records) → R0-K → PREREG freeze → held-out stream (A11).
2. flow-v3 slice 2 (C2–C4, E2 freeze record) → R5/R6 beds complete → Opus reference workflows (B10) → first paid W-bed
   run R1–R4, K=2 lineages, ≈ $115–250 list (B1–B4 falsifiers).
3. L1 revision after the failed audit (remove six detectors, split P37, add the 15 checklist lines, re-census, re-audit on a fresh draw with the owner's 10-item blind check) → J1 held-out coverage → library code steps 3–8 → L2 retrieval → arm (g) pilot (D6) → L4 wrong-reuse (D7).
4. Heal: T4a drift and T4b planted latent defect with the sweep (F1–F2).
5. MCP host integration + inverted arm (G1–G2): the deployment claim, last.

## J. Proofs added on 2026-10-09 night (owner: "be creative where needed")

| # | claim it tests | design | status |
|---|---|---|---|
| J1 | **Held-out platform coverage (L1-b).** The 97.8% (D1) is in-sample: the vocabulary and patterns were mined from the same 49 platforms. Draw ≥ 3 platforms NOT in the corpus (candidates: Windmill, Kestra, Pipedream, Make, Power Automate, Step Functions, Logic Apps, Camunda/BPMN, Huginn, Airbyte), fetch ~10 public workflows each, hand-label with L0 + L1, report out-of-sample coverage with a Wilson interval and every construct the vocabulary lacked | $0 (Sonnet, WebFetch); decision: out-of-sample coverage within 10 pts of in-sample, else L0/L1 are corpus-fitted | — (launch after the L1-a audit) |
| J2 | **Defect miner (red team for latent defects).** For each kept W-bed solver, an Opus agent tries to construct an in-profile input that breaks it; found defects become the planted set for T4b and the retroactive sweep (F2), so the heal claim is tested on real defects, not synthetic ones | $0 at construction time; the sweep then replays past outputs | — (after the first accepted solvers exist) |
| J3 | **Structural fidelity as a descriptive trace.** W-BED §6.3: the edit distance between the JIT-built graph and the hand-curated reference, never a success criterion, but reported per rung so "Haiku built the same thing" is visible | census distance exists (replication/lib) | D |
| J4 | **Arm (c′): frontier dynamic workflow per task** as the strongest construction baseline (Anthropic's Managed Agents / Claude Code dynamic workflows, public beta 2026-10-09; design/PRIOR-ART-MANAGED-AGENTS-DW.md §3.A, §4): same W-bed tasks, (a) Haiku from scratch vs (g) Haiku + library vs (c′) Opus writes a program per task; falsifier for us: (g) not within 10 pts of (c′) at ≤ 1/5 its construction cost in both lineages | needs owner go-ahead (spends Opus; a host Workflow-tool arm is a fan-out) | — |
| J5 | **R3′ planted-defect sweep bed**: their benchmark's shape (planted defects in a real repository, fan-out per file, verify before report) with an exact hidden manifest, so precision, recall and cost per verified finding are scored, not reported | $0 to build; the showcase for J4 | — |

## K. Proofs added on 2026-10-14 (ATTACK-20261014)

*From [ATTACK-20261014.md](ATTACK-20261014.md) (ideological attack, adversarial critique, re-check at `6b72f10`). Each row is a claim the programme makes or needs and has no proof yet; §3 of that file gives the mechanism, the isomorph and the kill mode.*

| # | claim it tests | design | status |
|---|---|---|---|
| K1 | **A reuse acceptance rule that a perfect gate can pass** (D7). Today 0 wrong of 60 fails (Wilson upper 0.0602; 73, 110 and 142 decisions are needed to pass with 0, 1 and 2 wrong) | ATTACK M3: one-sided bound (0/60 → 0.043) or n ≥ 73, or SPRT p0 0.01, p1 0.05, α = β = 0.05 (+1.609 / −0.0412, bounds ±2.944, 72 clean to accept), or fixed plan n = 181, c = 4; `experiments/lib/stats.mjs` + simulation test at true rates 0/0.01/0.03/0.05, clustered by parent; $0; adopt the rule with false kill ≤ 5% at p ≤ 0.01 and miss ≤ 5% at p ≥ 0.05 at L4 scale; before any L4 run | — |
| K2 | **Verification-tier economics: the JIT's steady state beats the Haiku agent at a shadow tier and rate that still bounds system-view misses** (A2, A4; the slider). Dev [M]: shadows run the arm's interpreter; S→H $0.129/task against $0.1025; break-even shadow rate 12–19% (S→H), 12–16% (O→H); never at the 25% floor | ATTACK M2: `verify-economics.mjs` over committed `results`/`events` and R0-K; prices every (tier, rate), with and without adjudication, plus a Wilson bound on detectable-wrong among randomly shadowed tasks; the slider picks the cheapest setting meeting the owner's bound; $0; if no setting at or above the random floor beats the Haiku agent, the PREREG cost claim against the Haiku agent is withdrawn for these families | — |
| K3 | **Witness coverage**: which bed tasks carry a code-checkable witness (hash total, exclusion set, conservation, count), and every oracle-free detector's recall reported per class (P4 boundary) | ATTACK M1(b): a `witness` tag in bed task metadata; recall tables split by tag; $0 | — |
| K4 | **Run-time output-invariance contracts catch silent wrong compiled outputs** (A3, F2 trigger) | ATTACK M1(a): family-declared metamorphic variants (shuffle, duplicate one record, drop one singleton entity; kinetics sample-order shuffle) beside the original on a sampled share of tasks, disagreement = deopt `invariance`; (i) archived versions on dev 201–224, (ii) a fresh dev range via SEED-LEDGER; adopt if ≥ 50% of wrong compiled outputs flagged at ≤ 10% false alarms in both, kill below 25%; ≤ $10 | — |
| K5 | **The retroactive sweep with early cutoff marks only callers whose output changes** (F2; LIBRARY §7.5 step 4) | ATTACK M5: `sweep.mjs` (consumption vs cutoff) on R3′ dev worlds (`beds/wbed/r3p/impact.mjs`: affected/unaffected callers, call log with exact `wrong` flags, `scoreImpact`/`scoreReplay`); adopt cutoff if it removes ≥ 50% of false suspects at 100% recall; also report the share of §7.5 relabels that would be false `wrong`; $0 | — |
| K6 | **Typed enumeration covers the correct composition** (D6, composer question) | ATTACK M4: reachability over card in/out schemas to depth 4 with per-contract temporal constraints, Haiku ranks the top 20, S9 probes filter; coverage on fixtures $0, g vs g-enum on R1–R3 dev $5–15; kill at > 100 candidates on more than half the tasks or coverage < 80% | — |
| K7 | **Arm (e), Haiku builds once from the spec, as the cheapest honest construction baseline on the ladder** (W-BED O1); (e′) Sonnet builder reported descriptively | ATTACK M10: R1 and R3 this week, R2/R4 later (≈ $30–45 for R1–R4, W-BED §9); decided on construction cost ratio at K = 2 only, success directional; no pillar restated from K = 1 | — |
| K8 | **The slice 2a tolerant profile holds out of sample** (B4 follow-up): false refusals ≤ 1/20 per difficulty with 24/24 plants refused on held-out R4 parents, and R4 parents 301–324 share no inputs with the R1 301–324 stream the profile learned from | `TOLERANT_CHECK` (FLOW-V3-SLICE2 §2.2) frozen, then held-out R4 parents in the W-bed round; overlap check $0 | — |
| K9 | **No sandboxed session read the parent session's credential** (security; ENGINE-FREEZE §6 ingress-token exposure before `756d6de`; D25 hidden-path attempts in 10 of 12 cloud arms, unreviewed) | $0 review of hidden-path events in the committed exports and any read of `.session_ingress_token`; report to the owner; rotation is the owner's decision | — |
| K10 | **Recurrence: enough shapes recur often enough to amortise** (P6). Corrected horizons at 10% interpreter-tier shadowing: about 70–460 tasks per shape | ATTACK M11: owner-run census on the owner's laptop transcripts with a value-profile signature (not `shapeKey`, FRONTIER-GAPS G2); shapes recurring ≥ 70 / ≥ 190 / ≥ 460 per month; fewer than 3 at the lowest horizon → weight reuse and $0 verification over compile amortisation; $0 | — |
| K11 | **W, the cost of a wrong delivery, is declared and used** (FRONTIER-GAPS G4) | Owner sets W per family; every arm table reports $ + W × silent misses (oracle view) and the system-view bound beside $/success; $0 | — |
| K12 | **Detector independence**: which oracle-free detectors fail independently of the producer (E1) | ATTACK M7: detector × output matrix from journaled detectors (shadow, size profile, AST diff, M1 variants; Jev only after the key and Q5b, synthetic beds only); a detector may gate only if coincident failure ≤ k × P(a)P(b); capture–recapture as a lower bound; diagnostic, no rule | — |
| K13 | **Distinguishing inputs reach one semantic class with few adjudications** (A4) | ATTACK M6: on R0-K version pairs only, after R0-K; adjudications per decision and survivor oracle pass; diagnostic at K = 1; $5–20 | — |
| K14 | **Dry-adapt admission lowers wrong reuse at matched missed reuse, and a 3-way covering near-miss suite finds wrong reuse a 1-way suite misses** (D5, D7) | ATTACK M8: arm b4 in L4 (stub mode), oracle-assisted and labelled so; 20–40 covering-array variants over 5–6 knobs; b4 serves only if wrong reuse < b1's with missed reuse within 5 pts; $0 | — |
| K15 | **A risk-adjusted CUSUM detects drift sooner than `recompileOnDeopts: 2` with a known false-alarm rate** (A3, F1) | ATTACK M9: risk inputs deployment has (profile novelty, near-band P16 decisions, deopt history; not the bed difficulty label); fit on the 260 pooled archived rows; h for ARL0 500; adopt if detection ≤ 4 tasks after the drift index and ≤ 1 false alarm per stream; $0 | — |
| K16 | **An open-weight model can construct or execute one rung** (the vision's "open-weight later") | One open-weight cell on R1 (`qwen3.5-4b-q4km` or `granite-4.2-3b-q4km` via `llama-server`, policy ids) once a GPU route exists; otherwise the headline drops "open-weight later"; cost TBD | — |
| K17 | **Latency per task is within a declared budget** (A10: "latency, not dollars, binds") | p50/p95 wall-clock per task per arm under the 2-executor cap, reported in every stream table; budget set by the owner; $0 on existing runs | — |
