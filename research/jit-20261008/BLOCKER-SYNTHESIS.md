# BLOCKER-SYNTHESIS: one ranking across the nine blocker dossiers

*research/jit-20261008/BLOCKER-SYNTHESIS.md · 2026-10-09*

**Status: synthesis by hand after the workflow stopped; critique pending.**

**What this is.** The `blocker-dossiers` workflow (wf_da253fe6-f97) wrote nine cluster dossiers on blockers B1–B18, then the
cloud session ran out of usage before the workflow's synthesis and critique steps. This document is the synthesis, written by
hand from the exported agent results. It:
- ranks every dossier experiment in one list (§2);
- records where dossiers disagree with each other or with the repo (§3);
- maps the experiments to HANDOFF §5 and proposes a revised order (§4);
- names the mechanisms that recur across blockers (§5);
- lists dossier claims that should not be repeated as fact (§6);
- asks the owner four questions (§7).

No model calls, runs, web fetches or commits were made for it. The adversarial critique of this document is still to be written.

**Sources.**
- `handoff/workflows/wf_da253fe6-f97.md`, agent results 1–9 (map below). Section references such as "D5 §B6.1" mean
  dossier (agent result) 5, blocker B6, section 1.
- [FRONTIER-GAPS.md](FRONTIER-GAPS.md) §0.1–0.4 (including the §0.4 correction) and §4; [HANDOFF.md](HANDOFF.md) §2, §3, §5;
  [DEV-NOTES.md](DEV-NOTES.md) D1–D12; [THESIS-JIT.md](THESIS-JIT.md) §6; [CALIBRATION.md](CALIBRATION.md);
  [PREREG-stream.md](PREREG-stream.md).
- Spot checks against committed files: [nversion-records-dev.json](nversion-records-dev.json), `tierdown/live-rules-{haiku,sonnet}.{json,md}`,
  `experiments/jit/{report,stream,compare,acceptance,router,prompts}.mjs`, `beds/kinetics/README.md`,
  `experiments/kev-data/README.md`, the static C0 records solver in `research/construction-20261006/artifacts/`, and the three
  Kev J1 dev-select files in `~/foundry-bridge/work/data/`.

| agent result | blockers | dossier |
|---|---|---|
| 1 | B2, B9 | diversity and statistics: common-mode failures; lineage variance and small-K validity |
| 2 | B1, B7 | decision verification: silent near-threshold misses; answer equivalence without an oracle |
| 3 | B3, B17 | teachers and labels: weak-demonstrator trap; human adjudication of unresolved cases |
| 4 | B4, B11 | domain of validity: a heal widened the domain (D9); applicability gating for reuse |
| 5 | B6, B8 | semantics and acceptance: kinetics compile failures and the composer question; acceptance without ground truth |
| 6 | B5, B15, B16 | cascade economics: tiering a high-leverage judge (D11); Kev from traces; router and slider |
| 7 | B14, B18 | discovery and meta: replicating hand-built workflows; a compiler that improves itself |
| 8 | B12, B13 | composition and control: guarded sub-modules; interactive environments |
| 9 | B10, B10b | throughput: the usage quota; scheduling on the 4-vCPU VM |

**Blocker numbering.** B1–B18 is the workflow's own numbering, fixed by the dossier titles above. FRONTIER-GAPS has no
B1–B18 list. Its §2 table B uses B1–B4 for four different gaps (weak interpreter, traces carry outputs not reasons, induction
from 3 examples, interpreter amnesia), and dossier 4 notes the collision. In this document Bn always means the dossier numbering.

**What changed since the dossiers were written.** The dossiers assume the cloud container's run data. It is gone.
- **Lost:** the stream run data and model-call journals of `jit-dev-records-1` and `jit-dev-kinetics-1`. That means every
  compiled `solve.mjs`, trace, BUILD-NOTES, `compile.json`, `events.jsonl`, `results.jsonl` and `journal.sqlite`. Also lost:
  all Kev held-out and OOD material and pools, and the wave-A built datasets.
- **Survives:**
  - the numbers written into DEV-NOTES, HANDOFF §2, FRONTIER-GAPS §0 and CALIBRATION;
  - `nversion-records-dev.json`: 4 compiled records solvers × 24 dev tasks, with status, pass, score, cost and a
    distinct-answer count per task, but no answers;
  - `tierdown/live-rules-*.json` and `.md`: the 8-task tier-down summaries and the judge-site diff, but not the solver;
  - the static C0 records and codefix solvers (`research/construction-20261006/artifacts/B1-*`);
  - the bed generators and dev configs, so every dev task input regenerates;
  - the R-bench pilot items, the recovered corpus, and the three Kev J1 dev-select files.
- **So:** any dossier experiment that says "$0 replay", "archived shadow pairs", "archived traces" or "re-analyse dev journals"
  needs a fresh dev re-run first. That re-run costs the owner's own Claude usage, and its model outputs will differ.
- **Also new:** work runs on the owner's laptop (RTX 4060), and the owner is exploring Jev (TypeSafe's hosted judgment model)
  as a substitute for training Kev on the GPU. §2.3 covers what Jev would and would not answer.

**Evidence class.** Everything below is development evidence: dev seeds, K=1 streams, K_c=1 compiles. Nothing is claim-bearing.
"Supported" means supported by dev evidence.

**Rules in force for every experiment below.**
- No new Workflow fan-outs. Everything runs as a plain script or CLI call.
- Never read sealed beds (`beds/sealed/`).
- Held-out JIT seeds are ≥ 7001 only. 5001–5006 and 6001–6004 are burned.
- Preregister before any comparative claim. No K=1 claims. Gaps under 3 points are noise. Keep negative results.
- Heal proposal `p-a3336190-r4` is untouched by anything here. Credentials come only from env vars.

---

## 1. Spot checks behind this document

Every repo number carried into §2–§5 was checked against DEV-NOTES, HANDOFF, FRONTIER-GAPS or a committed file. Where a dossier
number disagrees, §6.1 lists it. These checks came out as the dossiers state:
- From `nversion-records-dev.json`:
  - `opusV2` and `sonnetV1` both answered 20 tasks. They were wrong on 5 and 4, and on 3 together, against 1.0 expected
    (one-sided Fisher p ≈ 0.032).
  - `opusV1` and its child `opusV2` were wrong together on 2 tasks against 0.67 expected, with identical scores (s212 0.723,
    s214 0.892).
  - On d4, `sonnetV1` refused s217, s218, s220 and s222. `haikuV1` refused the same four plus s224, and `opusV1` refused all 8.
  - `opusV1` refused 15 tasks. Its child `opusV2` answered all 15: 8 right and 7 wrong (d3 6 of 7 right, d4 2 of 8).
  - 7 tasks were unanimous and 6 of those were correct.
- The Wilson 95% interval for 22/24 is 74–98%. An exact McNemar test on a 5/1 split gives p = 0.22; the split itself can no
  longer be checked.
- Tier-down (committed JSON): Haiku 5/8 against 7/8 once s204's deopt is counted; Sonnet 3/8. Per-task run cost: $0.0061
  (Haiku), $0.0241 (Sonnet), $0.0386 (Opus).
- Code:
  - `report.mjs:10` sets `NOISE_SUCCESSES = 3` and compares task counts.
  - `stream.mjs` does not import `router.mjs`.
  - `acceptance.mjs:45` still matches case ids with the literal, case-sensitive pattern `\b<id>\b`.
  - Adoption still does not require acceptance (`stream.mjs:536–556`).
- Shareable interpreter spend (D9 §B10.1):
  - O/H: $5.16, which matches D12's interpreter + shadows + adjudicator total of $5.15.
  - S/H: $3.27, which equals D10's $1.46 + $1.81.
- `beds/kinetics/README.md`:
  - pass needs every Vmax and Km within 10% of truth, and the exclusion set must match exactly;
  - the reference fit is within 5% of truth and a replicate-mean fit within 8%;
  - any two conditions differ by at least 30%.
- Kev's registry reserves test seeds 7000–7039 and 7040–7199 (`experiments/kev-data/README.md:31, 232, 307`).

---

## 2. Cross-blocker ranking of experiments

**Ids.** Each id is the blocker plus the dossier's own experiment number:
- E2-k → B2-Ek and E9-k → B9-Ek;
- E1–E3 → B1-E1..E3, and E4–E6 → B7-E4..E6 (the dossier numbers B7's experiments 4–6);
- E-B3-k → B3-Ek and E-B17-k → B17-Ek;
- X-B4-k → B4-Ek and X-B11-k → B11-Ek;
- E6.k → B6-Ek and E8.k → B8-Ek;
- X5-k → B5-Ek, X15-k → B15-Ek and X16-k → B16-Ek;
- E14-k → B14-Ek, E18-k → B18-Ek, E12-k → B12-Ek and E13-k → B13-Ek;
- QEk → B10-Ek and CEk → B10b-Ek.

R0 and J1 are added by this synthesis. Where two dossiers propose the same experiment, the rows are merged and both are cited.

**Cost classes.**
- **$0 offline:** no model calls.
- **Haiku-cents:** under about $5.
- **Opus-dollars:** about $5 or more, or Opus-heavy.
- **GPU:** laptop time, no usage.
- **Jev:** TypeSafe credit; price unknown here.

Every Claude call spends the owner's own usage. Dollar figures are the dossiers' list-price estimates.

**Runnable now?**
- **yes:** nothing lost is needed.
- **partly:** a substitute exists now; the full version needs something below.
- **blocked:** lost data or a re-run is needed.
- **needs PREREG** or **needs owner:** as stated in the row.

**R0** is the records dev re-run defined at rank 8.

| # | id | experiment | moves | cost | runnable now? | evidence it would produce |
|---|---|---|---|---|---|---|
| 1 | B9-E1 (instrument part) + B10 §1 + FG P2 | Replace `NOISE_SUCCESSES` (a task count) with an exact McNemar test, a lineage-clustered CI and a "directional / no decision / decision vs δ" verdict. Reconcile PREREG §4 (points) and §8 (one fixed order) with ROADMAP §4.3 (≥ 3 random orders). Define the 25% env-fault rule (fault events or unresolved faults). Seed ledger, with held-out ≥ 8000 | B9, B10, B2; every comparative claim | $0 offline | yes | An analysis section that can be frozen; reports stop calling 22 vs 18 a real difference |
| 2 | B6-E1 (part a) + B8 option 1 | Structured per-case acceptance verdicts instead of a regex over BUILD-NOTES prose. `acceptance.mjs:45` needs the literal token `trace-2` in both `named` and `strict` mode. Add a test that reproduces D5 N3 ("Trace-0, 2, 4 differ by ≤1e-5") | B6, B8, B18 | $0 offline | yes | Whether the §3 `strict` gate can still reject a numerically right compile on wording; a fixed gate before R0 |
| 3 | B7-E4 + B8-E1 (gauge half) + HANDOFF §3 relTol calibration | Comparator gauge study. **Stage A:** generate kinetics dev tasks; take correct–correct pairs from two fitters written from the SOP text and correct–wrong pairs from the bed's plausible-but-wrong controls (analyst side); score exact, relTol 0.001–0.05 (0.10 and 0.20 only with `allowLooseTolerance`) and set-exact exclusions. **Stage B:** two Haiku-agent sessions per kinetics dev seed, for the spread between model answers | B7, B8, B6, B2, B1 | A: $0 offline. B: Haiku-cents (~$3–4) | A: yes. B: a small re-run. Freezing the result as a system threshold needs owner O1 (§7) | False-disagreement and false-agreement rates per tolerance; the kinetics relTol to freeze. This replaces the lost "archived shadow pairs" |
| 4 | B5-E1 + B15-E1 | Consequence gate for global reads. **Stage 1:** re-derive D6 N3's date-order data check on regenerated records dev inputs, scored on generator labels. **Stage 2:** Haiku k=3 and Sonnet k=1 reads from a re-authored `rules` prompt, a gate at data margin ≥ 2, a completeness assertion for void markers, and a Dawid–Skene label model over the same calls | B5, B15, B16, B1, B3 | Stage 1: $0 offline. Stage 2: Haiku-cents (~$1) + ~$0.034 per Opus escalation; optional Jev tier | Stage 1: yes. Stage 2: once the `rules` prompt is re-authored (the S/H v1 judge is lost; the static C0 solver's config judge is a starting point) | Undetected wrong global-read leaves, gated against ungated; escalation rate; label-model accuracy against Opus-as-label |
| 5 | B2-E3 + B17-E3 + B16-E2 (offline part) | Verification-policy simulator on `nversion-records-dev.json`: 4 solvers × 24 tasks, with the Opus agent's 24/24 as the reference. Compares dispute-only adjudication against a random floor with IPW weighting, and every-4th shadows against Z1.4 switching and an ε-random holdout | B2, B17, B16, B9 | $0 offline | yes | Bias and CI coverage of oracle-free silent-miss estimates; whether the PREREG needs a random-propensity shadow floor. Solver level, not stream level |
| 6 | B10-E2 | Meter capture. Read 5-hour and 7-day utilisation from `stream-json` events, probe with Haiku every 10 minutes, and fit a quota weight per model and token class | B10, B10b | Haiku-cents ($1–3) | yes | Whether this account's `claude -p` exposes the meter; Opus:Sonnet:Haiku quota weights; a price in owner usage for every row below |
| 7 | B4-E1 + B18-E1 | Recompile non-regression audit: refusal replay under the v2.2 rule, an AST deletion diff of guards, invariants and checks, and backward transfer on old cases | B4, B18, B11, B2 | $0 offline | partly. The opusV1 → opusV2 edge is computable now from the nversion JSON: `opusV1` refused 15 tasks that `opusV2` answered, 8 right and 7 wrong (d3 6 of 7 right, d4 2 of 8). The deletion-diff tool can be built and tested on the v1–v3 solvers in `tools/run-view/test/streams-fixture`. The other edges need R0 | Whether the rule flags the D9 heal and passes good heals (kill if it flags ≥ 50% of good ones) |
| 8 | **R0** (added; FG P1 + HANDOFF §5.1/§5.2) | Records dev re-run of JIT S/H, O/H, H/H and the Haiku agent on seeds 201–224, under the HANDOFF §3 config. It persists per-run outputs, flow events and salt-free journals, and the push is verified with `git ls-files` | unblocks about 15 rows below | Opus-dollars (about $23 at D10/D12/FG rates; budget $30) | needs owner: usage, and `CLAUDE_CODE_OAUTH_TOKEN` | New solvers, traces and journals that make later replays $0; a dev rehearsal of the config to be frozen; a second lineage per arm (paired with the lost run at summary level only) |
| 9 | B3-E2 | Ruled demonstrator: the Opus `rules` reading is prepended to the Haiku interpreter's prompt as binding rulings. Plain against ruled, dev 201–216 × K=2 | B3, B5, B17, B6 | Haiku-cents + Opus-dollars (~$7) | after row 4's prompt; the dev decision rule is written first | Whether Haiku's systematic trace errors are law-class (sign, date order, void) |
| 10 | B1-E1 (HANDOFF §5.3) | Decision ledger: log the margin of every identity decision, define the band as margin ≤ m, and send batched "which of these candidates, if any" questions to Opus | B1, B7, B17, B15 | $0 offline + ≤ $3 Opus | blocked: needs R0 solvers; the static C0 solver is the fallback | Share of misses inside the band; band size per task; accuracy of the narrow adjudication (kill if > 25 pairs per task or < 90%) |
| 11 | B5-E2 (HANDOFF §5.6, #42) | Morris one-at-a-time leverage screen, with every other judge replayed from the journal. This also reruns D11 without re-sampling the other judges | B5, B15, B16, B12 | $0 offline after R0 | blocked: needs R0 journals and a flow override hook | Leverage per decision unit; an FMEA action-priority table; the true size of the D11 effect (C3) |
| 12 | B11-E1 (HANDOFF §5.7) | Reuse confusion matrix over 5 gates (shapeKey, profile, profile without size, + concepts, + contract diff) and 3 borrowers (records d2, records d5, kinetics d4) | B11, B4 | Haiku-cents ($1–3) | partly: the static C0 records solver can be the lender now; JIT lenders after R0. A short PREREG-reuse-dev note comes first | Correct, wrong and missed reuse per gate |
| 13 | B18-E2 | Metamorphic (EMI) compile stability: 3 variants plus 2 identical-input recompiles per trace set, 15 Haiku compiles, scored on 16 dev tasks | B9, B2, B18 | Haiku-cents to Opus-dollars ($12–25) | needs R0 trace sets | Compile-noise SD against trace-content SD, the cheapest direct input to B9's ρ; whether disagreement between twins predicts failures |
| 14 | B14-E1 (HANDOFF §5.8 prep) | Conformance evaluator: effect-log alignment (fitness and precision) against the 5 pilots' hand-built oracles, on burned dev seeds 0–27 | B14, B18, B7 | $0 offline | yes: the pilot items are committed | Whether generic conformance sorts the 18 + 11 + 5 known design classes at least as well as oracle v1 |
| 15 | **J1** (added; HANDOFF §5.6) | Stock Kev-0.8B reads of the 3 surviving dev-select files (1,106 records, 1,181 choice questions), plus Haiku reads and optionally a Jev read of the same items | B15 | GPU ($0); Haiku-cents (~$1–4, estimate); Jev | yes for Kev and Haiku. Jev needs owner (a policy entry) | The baseline that J2 training would be judged against; whether an off-the-shelf judge already suffices per question type |
| 16 | B15-E2 | Novel-form residual: a 300-world R1/R3 factory stream with an Opus read cache keyed by masked sentence; Haiku against stock Kev (or Jev) on novel and cached forms | B15, B5, B16 | Opus-dollars (~$1.5) + Haiku-cents + GPU or Jev | yes: the generator-only parts rebuild | Novel-form rate by stream position (kill if < 5% after 50 tasks); Kev or Jev against Haiku on novel forms |
| 17 | B4-E2 | Profile ablation: evidence-scaled kNN coverage and concept features against the current profile. Thresholds are frozen on records and scored on kinetics | B4, B11, B16 | Haiku-cents (< $1) | partly: records inputs regenerate and per-solver outcomes are in the nversion JSON; the scored kinetics half needs a kinetics re-run | Silent-miss recall at a fixed false-alarm rate with size features removed |
| 18 | B1-E2 + B1-E3 | Records controls pack: an ITF fictitious person (3 rows, one typo class), Westgard rules, a PBRTQC merge-ratio EWMA, and a double-entry entity count | B1, B7, B12 | $0 build; Haiku-cents (~$1.2 per 24-task C0 run, which also calls Sonnet/Opus once per task) | partly: on the static C0 solver now; on JIT versions after R0 | In-situ recall per typo class; AUROC of the reconciliation gap against oracle failure |
| 19 | B12-E1 | Module-level N-version census: extract the helpers from every records solver and run each implementation on harvested module inputs | B12, B2, B1 | $0 offline | blocked: the 10 records versions are lost. A 2-version pilot on the two static C0 records solvers is possible now | Whether known misses show module-level disagreement where whole-task N-version was unanimous |
| 20 | B10-E1 | Shared draws: the 2nd and 3rd agent draws per (task, model) become the JIT arms' shadow and adjudicator pool; check request equivalence in the `interpret.mjs` config | B10, B9 | $0 offline | partly: design and equivalence check now; the empirical comparison needs R0 traces; a PREREG amendment | Replaceable interpreter spend (dossier upper bounds: 69% O/H, 36% S/H) |
| 21 | B6-E2 (HANDOFF §5.4) | Rulebook-first kinetics compile, 4 arms × K_c=3: Haiku with the current prompt; Haiku with rulebook and certified fitter; Opus with the current prompt; rulebook + deterministic `apply.mjs` + Haiku fact extractors. Dev 205–212 | B6, B8, B3, B17, B12, B15 | Opus-dollars (~$40) | needs fresh kinetics warmup traces, rows 2 and 3 first, and a dev prereg note | Whether explicit semantics let Haiku match Opus compiles; the answer to "train a small composer?" |
| 22 | B12-E2 | Behaviour-preserving refactor into `lib/{dates,phones,money,identity}.mjs`, then one D1 fix in `identity.mjs`, relinked into each solver | B12, B4, B1 | Haiku-cents ($3–8) | partly: can start on the static C0 solver, whose exact oracle is the old program; JIT solvers after R0 | Collateral change from a one-module fix, against a whole recompile |
| 23 | B3-E1 | Teacher ledger: law errors against fact errors, compiler-override accuracy, an entrustment matrix | B3, B17 | $0 offline | blocked: needs R0 traces and BUILD-NOTES | Whether stable Haiku errors are law-class (the ≥ 60% rule) |
| 24 | B9-E3 | Stream simulator over crossed version × task and interpreter × task tables, plus the expected sample size of a paired e-process | B9, B16, B10 | $0 offline | blocked: needs R0 tables, and the simulator must reproduce R0's own result within one task | Order and shadow-schedule variance; usage saved by an anytime-valid design (kill if < 25%) |
| 25 | B17-E1 | Certiorari queue with precedent propagation and a simulated human at error rates 0, 0.1 and 0.2 | B17, B3 | $0 offline | blocked: needs R0 events; a pilot on the nversion disagreements is possible now | Cases fixed per ruling, against harm from over-broad precedent |
| 26 | B16-E1 (HANDOFF §5.9) | V-aware router replay: Beta posteriors and ski rental with λ, at V ∈ {0.1, 1, 10}, against v0 and every fixed arm | B16 | $0 offline | partly: arm totals now (D10, D12, FG §0.1, CALIBRATION); per-task replay needs R0 | Regret of v1 against v0; whether routing adds anything at 24 tasks |
| 27 | B4-E3 | Live K=2 comparison of v2.2 and v2.1 on O/H records, with a deliberately over-strict check seeded in | B4, B18 | Opus-dollars ($15–30) | needs a dev freeze note; R0's v2.2 O/H run can be one arm | Whether v2.2 cuts d4 silent misses without over-refusing (kill if > 3 points lower on d3) |
| 28 | B2-E2 → B9-E2 (HANDOFF §5.5) | Forced against unforced diversity (4 + 4 compiles), then portfolio racing (M=3 lineages, R=3 orders) against one lineage | B2, B9, B18 | Opus-dollars ($20–35, then $40–70) | needs R0 traces and dev prereg notes | Joint-wrong ratio, forced against unforced; between-replicate SD, portfolio against single lineage |
| 29 | B13-E1 | Gridquest handoff headroom: protocols P0–P4 with code stand-ins, 30 dev seeds × d3–d5 | B13, B12 | $0 offline | yes | Whether hold-and-resume in the same environment beats a restart (kill if within 3 points of P2) |
| 30 | B14-E3 | Corpus variant-family census by template lineage and graph edit distance | B14, B11 | $0 offline | yes | Families with ≥ 3 variants and shipped oracles (kill if < 10) |
| 31 | B8-E3 | Rulebook-conformance acceptance with manufactured canaries and mutants | B8, B6, B18 | Opus-dollars ($15–25) | after row 21; known-good and known-bad versions come from R0 and a kinetics re-run | Mutant kill rate; false rejects of known-good versions |
| 32 | B14-E2 (HANDOFF §5.8) | Parallel-run JIT replication on the Galaxy and selenium items: the original is the interpreter and shadows compare by conformance | B14, B18, B7 | Opus-dollars ($15–30) | needs owner (D10/D15 sign-off) and a PREREG before test seeds | Time-to-durable; fidelity on fresh seeds |
| 33 | B6-E3 | Disagreement-triggered rulings: do kinetics misses sit on wells where lineages disagree? | B6, B8, B2 | $0, then live | blocked: needs a kinetics re-run | Share of delivered misses on disputed wells |
| 34 | B7-E5 | Decision-first comparison: compare exclusion sets exactly, then refit both through one fitter written from the SOP | B7, B6 | $0–0.5 | partly: the fitter can be written now; answers come from row 3 stage B or a kinetics re-run | Share of correct–correct disagreements that vanish after the shared refit |
| 35 | B11-E2 | Admission by bridging study (an SPRT over paired shadows), against a per-task gate only | B11, B16 | Opus-dollars ($8–15) | after row 12 | Wrong reuse per 100 tasks; admission cost |
| 36 | B11-E3 | Evidence-transfer compile: the borrower compiles from the lender's suites plus 2 of its own traces | B11, B12 | Haiku-cents to Opus-dollars ($5–10) | after row 35 | Pass rate and cost against as-is reuse |
| 37 | B3-E3 | H/H compile from ruled or masked traces, K_c=2 | B3 | Opus-dollars ($8–12) | conditional on row 9 | Whether the trap lives in the labels or in the compiler |
| 38 | B13-E2 | World-model compile against policy compile on gridquest | B13, B12 | Opus-dollars ($12–25) | needs the env port, flow-v3 and PREREG-env; seeds ≥ 8000 | One-step prediction accuracy; levels per $ |
| 39 | B10-E3 | Quota governor (token bucket, pacing curve, criticality classes, breaker, auto-resume), ABAB over four 5-hour windows | B10, B10b | $0 sim + Opus-dollars ($20–40) | the simulation is blocked (load data lost); the live part comes after row 6 | Tasks finished per 10 h; stall minutes; unchanged pass rates |
| 40 | B10b-E3 | Batched low-leverage judgments, B=1 against B=10 | B10b, B5 | Haiku-cents ($1–2) | needs R0 | End-to-end pass rate; CPU and usage per task |
| 41 | B12-E3 | Blame accuracy on 20 single-module mutants | B12, B13 | $0–1 | after row 22 | Detection and blame accuracy against whole-output invariants |
| 42 | B17-E2 | Owner calibration session: 16 field-local cards, 8 blind and 8 showing the system's answer | B17, B3 | $0 in models; about 30 min of owner time | needs owner, and cards built from R0 disputes | Owner accuracy; the automation-bias gap; owner–Opus α |
| 43 | B13-E3 | Gameqa: compile the replay and ddmin verifier | B13 | Haiku-cents ($5–10) | after a gameqa audit | Oracle-passing bugs per $; false reports |
| 44 | B2-E1 | Full coincidence audit over all records versions, with a β-ledger | B2, B9 | $0–4 | partly: the 4-version table is already computed (D1 §B2.1 Fact 1, verified in §1); the rest needs R0 | Observed/expected joint failures per pair; β for dangerous undetected failures |
| 45 | B10b-E1 | Contention-confound audit, plus opt-in host-load fields on future rows | B10b | $0 | partly: the audit data is lost; the fields can be added now | Odds ratio of failure at high concurrency |
| 46 | B10b-E2 | Jobserver against per-process semaphores | B10b | $0–cents | yes, but the 4-vCPU VM is gone; measure the laptop's concurrency knee first | Calls per second and p95 latency |
| 47 | B7-E6 | Order independence of adjudication | B7 | $0 | the archived triples are lost; a unit test of non-transitive majority-of-three replaces it | Whether check order changes outcomes |
| 48 | B8-E2 | Proficiency-style consensus acceptance | B8, B2 | $0–5 | blocked: the nversion JSON has pass, score and a distinct-answer count, not answers; needs R0 outputs | Recall of known wrong outputs at a given Opus budget |
| 49 | B18-E3 | Lexicase population of compiler variants on a held-out third family | B18, B9 | Opus-dollars ($60–120) | gated on rows 7, 13 and 32; needs PREREG | Held-out success against the latest-version compiler |

### 2.1 Ranking rationale

**Instruments come before mechanisms (ranks 1–3 and 6).** Two dossiers found that a blocker was partly produced by the
measuring instrument:
- D5 found that "Haiku cannot compile kinetics" is at least half artefact: exact float comparison, a $1.5 gateway cap and a
  prose regex in acceptance.
- D1 found that `report.mjs` counts tasks where PREREG-stream counts points, so a 22-vs-18 lineage draw prints as a real
  difference.
- The `acceptance.mjs` regex is still in the code that the HANDOFF §3 `strict` setting uses.
- The kinetics tolerance band that HANDOFF §3 proposes (0.005 / 0.01 / 0.02) has no data behind it now, because the archived
  shadow pairs it was to be calibrated on are lost.

Spending owner usage on comparisons before these are fixed buys known artefacts. All four rows are $0 or cents and need nothing
that was lost.

**Cheap tests of strong prior evidence come next (ranks 4, 5, 7).**
- **Row 4:** D6's own measurement found the data decided 25 of 26 d3 date-order leaves, all in agreement with Opus, and caught
  all three observed cheap-tier date errors. A code check that catches the highest-leverage silent errors at $0 moves five
  blockers. Its first stage needs only regenerated inputs.
- **Row 5:** the simulator settles whether the PREREG needs a random-propensity shadow floor. Four dossiers (D1, D2, D3, D6) say
  it does, for one shared reason: dispute-only adjudication biases every oracle-free rate.
- **Row 7:** checks whether the v2.2 refusal rule in the HANDOFF §3 config does what it is meant to. Its first edge is
  computable from the surviving nversion JSON.

**R0 is rank 8 because it is the biggest unblocker and the first real spend.**
- It unblocks about 15 rows and HANDOFF §5.1, §5.3, §5.5, §5.6 and §5.7.
- It comes after rows 1–7 for three reasons: so it does not re-measure the acceptance and comparison artefacts; so its usage is
  priced (row 6); and so it doubles as the dev rehearsal of the exact config the PREREG will freeze. The dev streams ran the
  default configuration; the §3 combination has never run end to end.
- **Scope:** records only, and only the JIT arms plus the Haiku agent.
  - The Opus agent was 24/24, so its per-task outcome is already known.
  - The Sonnet agent's per-seed pass string survives in D3 §B3.1.
- **Kinetics waits until rows 2 and 3 land.** Then run O/H first, because it was the only kinetics arm ahead of the agents
  (FG §4.3).
- **Persistence is part of R0, not an option.** The run data was lost because `snapshot.sh` discarded its errors
  (`2>/dev/null`), `*.tgz` is gitignored, and nobody checked that the copied runs reached git.

**Ranks 9–20** are cheap live experiments, or $0 replays once R0 exists. They are ordered by blockers moved and HANDOFF §5 steps
served.
- Decision-level verification (row 10) and leverage (row 11) each serve a §5 step and four blockers.
- B18-E2 (row 13) goes before the portfolio experiments (row 28) because it measures compile variance directly. If identical-input
  recompiles barely differ, the $60–105 portfolio pair has little to work with.

**Ranks 21–28** are the Opus-dollar experiments, ordered by information per dollar.
- Rulebook-first (row 21) answers the owner's composer question and moves six blockers, but only after row 2 has a chance to
  withdraw B6's premise.
- Portfolios come last in this group because the dossiers disagree on what diversity buys (C9) and cheaper rows can kill them.

**Ranks 29–49** fall into two groups:
- $0 items that serve no HANDOFF §5 step (gridquest, the corpus census). They rank low despite their price.
- Items that depend on earlier rows, owner sign-off or lost data.

**Caveat on every post-R0 row.** R0's solvers will be different programs. The specific failures that many dossier experiments
are keyed to may not recur: the s214 unanimous under-merge, the s208 BRIGHTDESK date order, and the D9 guard widening. Where an
experiment needs a known failure, there are two options:
- define its target as "whatever R0's solvers get wrong", frozen before scoring;
- or use the static C0 records solver as a fixed testbed. Its d4 silent failures (2/8, D5) are on record.

### 2.2 What the held-out run is not

The held-out stream (HANDOFF §5.2) is the claim, not an experiment, so it is not in the table. The rows above are what the dossiers
say must be true before it can be frozen. §4 lists those freeze conditions.

### 2.3 Kev- and GPU-dependent rows, and what a Jev variant would answer

Jev takes noul, choice and score questions over a JSON state and returns probabilities. **The three surviving J1 dev-select files
are already in Jev's shape:** each record is a `state` plus `choice` questions with `instructions` and `criteria`. A Jev read needs
no conversion beyond removing the `label`, `src` and (in runbook) `target` fields from each question before sending. Those fields
carry the answer.

| dossier item | question it asks | does a Jev variant answer it? | what it would lose |
|---|---|---|---|
| J1 (HANDOFF §5.6, RESUME step 2): stock Kev reads | How good is an untrained small judge on factory dev-select items, against Haiku? | Yes for "an off-the-shelf small judge". Kev J1 itself is already $0 on the GPU, so Jev adds a comparison point and does not replace it | The Kev-0.8B baseline that J2 needs |
| Kev J2 training (HANDOFF §5.6) | Does training Kev on wave-A factory data help? | No, unless TypeSafe lets the owner fine-tune Jev (unknown here) | The whole question. J2 is also further away than HANDOFF assumed: PREREG-J2 needs the held-out and OOD material, which was lost and must be re-authored |
| B15-E2 (row 16): novel-form residual | Do novel surface forms leave a workload a small judge can take, and is Kev better than Haiku there? | Partly. It measures the residual workload (which needs no Kev at all) and Jev-vs-Haiku on novel forms | Nothing about Kev specifically; nothing about training on factory data |
| B15 Kev from traces (D6 §B15) | Do trace-harvested labels have the volume and quality to train a small judge? | No. Jev is not trained on our traces | The question itself. D6 argues the answer is already "not yet": 695 judge calls gave 51 Kev questions |
| B5 tiering (row 4, and B5-E2 after R0) | Can a tier below Haiku carry a decision class? | Yes, as one more cheap tier in the consequence gate. Its probabilities can serve as the prior, if calibrated against generator labels (the API's own docs say confidence measures concentration, not correctness) | Nothing relative to Kev, because B5 never needed a trained Kev. It does add a dependency on an external service |
| B16 router (rows 5, 26) | Can the router get p(compiled ok) per task? | Partly. Jev could score a task's state for in-domain plausibility | Unbiasedness. That comes from random holdouts and reverse shadows (rows 5, 26), not from any judge |
| B2 option 4, B17 (independent voter) | Is there a source outside the Claude family? | Yes, and better than Kev: Jev comes from a different vendor lineage, which is the independence D1 and D3 say all-Claude committees lack. It can vote on decisions, not compile | Owner intent rulings (B17) still need the owner |

**Conditions on any Jev use.**
- Model ids come only from `policy/models.json` (`tests/model-policy.test.mjs` rejects others), so Jev needs an owner-approved
  policy entry.
- Its key must come from an env var.
- Dev bed text is synthetic and Claude-written. Sending owner or R-bench text is a separate decision.
- Jev calls do not draw the Claude usage meter, which helps B10. They do have their own price and rate limits.
- A hosted model can change under a fixed name. Record whatever version the API reports with every result.

---

## 3. Conflicts between dossiers

Each row gives both sides, the repo evidence, and a verdict.

| # | topic | side A | side B | repo evidence | verdict |
|---|---|---|---|---|---|
| C1 | **Kinetics comparator tolerance** | D5 §0 N2, E6.1: correct fits agree to about 1e-5 (BUILD-NOTES); use relTol 1e-3; take tolerance from the prompt's grading rule, because the README is off-limits to the system | D2 §B7.1, E4: correct answers can legitimately differ by about 13% (5% + 8% generator bounds) and by up to 20% while both pass; gauge 0.01–0.20. HANDOFF §3: calibrate 0.005 / 0.01 / 0.02 on archived shadow pairs | README confirms the bounds D2 uses, but they bound distance from truth, not between two careful fits of the same decisions. D7: independent correct fits "almost never agree to the last digit". `compare.mjs` caps relTol at 0.05 unless `allowLooseTolerance`. The archived shadow pairs are lost | **Unresolved.** Both can be true: 1e-5 for the same decisions and method, larger for independent agent fits. Row 3 decides it. Provenance: the ±10% grading rule is in the task prompt, so both sides may use it; the 5% and 8% bounds are README-only. FG §4.1 lets a dev-calibrated value enter the PREREG only if O1 = yes |
| C2 | **Held-out seeds** | HANDOFF §5.2 and PREREG-stream §1: 7001–7024 and 7101–7124. D7 E18-3: "test seeds ≥ 7001" | FG J1, P2, P10; D3 E-B3-3; D4 X-B4-3; D8 E12-2, E13-2: ≥ 8000 from a global seed ledger | Kev's registry reserves records test seeds 7000–7039 (real reserve) and 7040–7199 (e2e reserve) (`experiments/kev-data/README.md:31, 232, 307`; `JUDGE-PROGRAM.md:1121`). Both PREREG ranges collide | **Side B.** ≥ 8000 also satisfies the owner's "≥ 7001" rule. Owner question Q1 |
| C3 | **Size of the D11 tier-down effect** | D6 §0 N1: `tierdown-e2e` re-samples every other judge on the variant side; attributable losses are Sonnet 3 (s209 was `vendex` noise) and Haiku 1 | DEV-NOTES D11: Haiku 5/8 against 7/8 (2 lost), Sonnet 3/8 (4 lost) | The committed Haiku JSON records s204's variant as a deopt (excluded as "cap reached"). D6 itself says Haiku misread ATLAS on s204. So Haiku's attributable loss is 2, not 1. Sonnet's s209 attribution rests on variant traces that are now lost | **Haiku: D11.** Sonnet 3 against 4: **unresolved.** The mechanism (a global, high-leverage read) holds either way. Row 11 settles the size by replaying the other judges |
| C4 | **"Kinetics never compiled well"** | D7 §B18.1: no kinetics compile exceeded 0.547 mean partial agreement over 11 attempts | D5 §0 N2, N3: 0.533 is 16/30 leaves, which a numerically identical solver scores under exact comparison; a rejected Haiku compile matched 4/5 traces | D7 (exact comparison gives correct kinetics solvers 0 exact matches). FG §0.1: kinetics O/H delivered 10 compiled answers with 1 wrong by 04:22 | **D5.** The 0.547 ceiling is the instrument. Kinetics compiling is still a dev cost negative (FG S7) |
| C5 | **Whether tolerant comparison exists** | D5 §B6.1: tolerant comparison "has not landed (#36)". D2 §B7.1 reads `compare.mjs` from a worktree | HANDOFF §3: v2.1 is merged | `compare.mjs`, `check-traces --tolerant` and `jit.compare: 'tolerant'` are in the repo (commits 5506c63, 14612a9). They are opt-in, and defaults are still canonical | **Stale at writing.** The critique still applies to the defaults and to acceptance's literal regex (row 2) |
| C6 | **How many compile records exist** | D7 §B18.1: 21 compile records (8 roots, 13 recompiles; $44.30). D8 §B12.1: 21 archived solvers, 10 of them records | D5 §B6.3: about 26 compile attempts (about 11 kinetics, 15 records). D1 E2-1: 9 records versions | Data lost. Adopted versions against all attempts (including rejected ones) would explain the gap | **Unresolved, immaterial now.** It matters only for D5's composer threshold (≥ 300 validated compile records across ≥ 3 families), which is far off on any count |
| C7 | **Integrity of compile histories** | D7 §B18.1, option 4: `hiddenPathAttempts` is nonzero on 11 of 21 compile records (41 attempts), so these are "contaminated episodes" to exclude | FG §0.4 correction: the sandbox mounts a private tmpfs over the run root and `/root`; the hidden-path scan is a conservative over-approximation | The §0.4 probe refuted cross-arm reads. Whether builder sessions tried bed or oracle paths was never classified (FG P2 item 4) | **Unresolved.** Integrity as a tracked metric stands; "contaminated" is not established. Classify the attempts in R0's compile records before using them as memory |
| C8 | **Which $0 analysis goes first** | D1: E2-1 → E9-1 → E2-3 → E9-3. D6: X5-2 replay first. D5: E6.1 + E8.1 | D7: E14-1 + E18-1. D8: E12-1 + E13-1 | All of these orderings assumed the archived data. After the loss, the replay-first orders are blocked | **Superseded** by §2. The rows that need no lost data move up (1–7, 14, 29, 30) |
| C9 | **What to spend verification budget on** | D2 §B1 and D6: verify decisions. Audits at probability ∝ leverage/margin, consequence checks, narrow "select" questions | D1: forced-diversity portfolios and lineage racing (E2-2, E9-2). D8 option 4: N-version at module boundaries | D8 (11 of 13 disagreements contained a correct answer; s214 was unanimous and wrong) supports diversity as a *trigger*, not as a vote. D1's own falsifier cites the claim that same-model ensembles reach under 0.3 of the independent gain (an unverified external claim, §6.4) | **Leans to decision-level verification first.** D1 option 2 (use variants to find decision points) is the bridge. Portfolios come after row 13 measures compile variance |
| C10 | **The shadow policy in the PREREG** | HANDOFF §3: `shadowEvery` 4 plus `jit.shadowOnFlags: true` | D1 (uniform floor on concordant answers with IPW), D3 (70/30 decision/audit split), D6 (random holdouts plus reverse shadows; flag-triggered shadows are biased "targeted audits"), D2 (sampling ∝ leverage/margin) | FG S2: the schedule is periodic (every 4th compiled `ok` run), not random, and only 4 of 21 known-wrong outputs were shadowed | **The dossiers.** The §3 config has no random-propensity floor, so the PREREG's silent-miss and durability numbers would be biased optimistic. Add a floor with logged propensities before freezing (row 5 sizes it) |
| C11 | **When to train Kev** | D6 §B15: training waits on X15-2's kill rule; Kev should verify local facts, not decide global reads. D5: no small composer before ≥ 300 validated compile records | HANDOFF §5.6: Kev J2 on the laptop GPU once PREREG-J2 is frozen. THESIS-JIT §6.6: the objective is the share of decisions made by code or Kev | FG table F: `rules` yields 0 Kev rows; 695 judge calls reduce to 51 Kev questions | **D6 on JIT-trace training.** J1 stock reads stay cheap and independent of this. J2 is gated anyway by the lost held-out material |
| C12 | **Compile cost per build, for budgets** | D1 E2-2: $2–4 per compile | D7 E14-2, E18-2: Haiku records compiles $0.27–2.19 (`compile.json`) | D10: S/H compiles cost $4.83 in total, including the builder's gateway test runs ($2.16) and the host check ($0.42). HANDOFF §2: Opus fallbacks $3–7 on kinetics | **Different scopes** (builder only against all-in). Budget all-in |

---

## 4. Mapping to HANDOFF §5

| §5 step | experiments that serve it (§2 rank) | what the dossiers argue | what the data loss does to it |
|---|---|---|---|
| 1. Finish the dev write-up | R0 (8) supplies new inputs; row 1 fixes `report.mjs` first | D1: fix the noise rule before printing comparisons. This synthesis adds the errata in §6.1 (D9 and D12 denominators, D11 wording) | `report.mjs`, `durability.mjs` and `resume-streams.mjs` have no inputs. Write the kinetics section from FG §0.1 (04:22) and D5's measurements, marked partial. Copy the dossiers' measurements on lost data (§6.2) into DEV-NOTES as a D13, labelled "measured by a dossier agent on data since lost; not re-verifiable". They are now the only record |
| 2. Held-out stream PREREG | 1, 2, 3, 5, 7, 8, 20, 44 | Before freezing: seeds ≥ 8000 (C2); McNemar and clustered CI; ≥ 3 random orders or a declared deviation; power on lineages, not tasks (D1: K=2 may give "no decision" by rule); the env-fault definition (D9); the kinetics tolerance from row 3 (C1); a random-propensity shadow floor (C10); acceptance without the literal regex (row 2); a decision on whether a version with `accepted: false` may be adopted (D4 §B4.1 item 7; still true in `stream.mjs:536–556`); optionally shared draws (row 20) | "Calibrate relTol on archived dev shadow pairs" (HANDOFF §3) is impossible; row 3 replaces it. The §3 config never ran end to end on dev, so R0 is its rehearsal. Oracle controls (`oracle-controls.mjs`, counts only) still run first |
| 3. Decision-level verification | 10 (primary), 4 ($0 consequence tier), 18, 19, 48 | D2, D1 option 2, D6, D8 and the D8 cluster note all converge here. Do it before portfolios (C9) | "Measure the catch rate on the D1 misses offline using the archived dev tasks" needs the lost solvers. The tasks regenerate, but R0's solvers may not reproduce D1's misses. Fallback: the static C0 solver plus row 18's planted near-twins |
| 4. Spec-first compile for kinetics | 21 (primary), 2 and 3 first, 31, 34; 9 is the records analogue | D5: B6 is at least half instrument, so fix acceptance and comparison first, or the experiment re-measures the artefact. D3's ruled demonstrator tests the same "settle the law once" idea on records at about a sixth of the cost | The 3 warmup traces are lost, so fresh kinetics warmups are needed. The re-acceptance of the 11 archived kinetics compiles (D5 E6.1) cannot be done |
| 5. Compile portfolios | 28, 13, 44 | D1: diversity helps only when forced; use variants to locate decision points, not to vote. D7: measure compile variance with identical-input recompiles first | The archived Sonnet trace pool is lost; needs R0 |
| 6. Judge leverage, then Kev J2 | 11 (leverage), 4, 15 (J1), 16, 40 | D6: leverage, not cost share, decides tiering. Consequence checks come first. Kev training waits on B15-E2's kill rule | "Counterfactual replay at $0" needs R0 plus a salt-free journal. Kev J2 also needs the held-out and OOD material, which must be re-authored. J1 is unaffected: its three inputs survive. Jev can substitute for J1-type reads, not for J2 (§2.3) |
| 7. Reuse experiment | 12 (primary), 17, 35, 36 | D4: the profile gate sees size and nothing else (M1); `shapeKey` cannot tell d3 from d4 (M2). Compare five gates, not one | "The proven records solver" (S/H v1) is lost. The static C0 solver can be the lender now (proven on d3 14/16, silent on d4 2/8); JIT lenders after R0 |
| 8. Replication streams | 14, 30, 32, 49 | D7: build the conformance evaluator first; it targets the $4.6 verification share of each item's $11. B18 needs B14 to run | None. The R-bench items and the corpus survive |
| 9. Router v0 in the stream | 26, 5, 39 | D6: v0 has no quality term. On records it would interpret with Haiku (15/24) where JIT S/H got 22/24. Replay first; FG P3(d): park the wiring if no policy beats both fixed choices | Per-task rows are lost; replay works at arm-total level only until R0 |

### 4.1 Proposed revised order

0. **(New) Persistence and push check, $0.** Before any model call, implement FG P1: per-run outputs, flow events, salt-free
   journals, and a commit path that does not depend on a gitignored `.tgz` or on swallowed errors. *Why first:* the loss
   happened here, and every later "$0 replay" depends on it.
1. **§5.1 Dev write-up, $0.** Same position, different content: write from surviving numbers, add D13 (§6.2) and the errata
   (§6.1). *Why unchanged:* it costs nothing and fixes the record that everything else cites.
2. **(New) $0 and cents work that needs nothing lost:** rows 1–7, 14 and J1 (row 15), plus rows 29–30 in the background.
   *Why:* these fix the instruments the PREREG will freeze and test cheap mechanisms with strong prior evidence.
3. **(New) R0, the records dev re-run.** About $23, budget $30, owner usage. *Why here:* it is the largest unblocker, and it
   rehearses the exact config to be frozen.
4. **§5.3 decision-level verification and §5.6a leverage** (rows 10, 11). *Moved up* from 3 and 6. Once R0 exists both are $0
   replays plus at most $3, and between them they serve six blockers. If decision checks catch the D1 class, they belong in the
   frozen config. Freezing first would need a second held-out round just to test them.
5. **§5.2 Freeze the PREREG and run the held-out stream.** *Moved from 2 to 5.*
   - **Why not earlier:** freezing now would freeze known defects: literal-regex acceptance, a tolerance band with no data
     behind it, seeds that collide with Kev's reserve, a noise rule that counts tasks, and no random audit floor.
   - **Why not later:** the capability-number rule (FG §4.1) and the owner's goal need a held-out number. New mechanisms
     (§5.4, §5.5) get their own amendments rather than delaying the first held-out test.
   - **Condition:** if row 1's power table, with R0 as a second lineage, says K=2 cannot decide at δ = 10, the owner chooses
     between raising K and reporting the run as directional by rule.
6. **§5.7 Reuse** (row 12). *Moved from 7 to 6.* With the C0 lender it costs $1–3 and can start in step 2.
7. **§5.4 Spec-first compile for kinetics** (row 21). *Moved from 4 to 7.* It needs rows 2 and 3 and fresh warmups, and at about
   $40 it is the first large spend that can still be withdrawn by row 2.
8. **§5.8 Replication.** Rows 14 and 30 already run in step 2. Row 32 runs here, after owner sign-off under D10/D15.
9. **§5.5 Compile portfolios** (row 28). *Moved from 5 to 9.* It comes after row 13 measures compile variance and after
   decision-level verification; the dossiers disagree on what diversity buys (C9).
10. **§5.6b/c Kev.** J1 stock reads run in step 2 (GPU, $0). J2 training waits for B15-E2's kill rule, re-authored held-out
    material and a frozen PREREG-J2. Whether Jev enters at all is owner question Q4.
11. **§5.9 Router.** Unchanged: last. Do not wire v0; replay first (row 26).

---

## 5. Shared mechanisms and ideological roots

### 5.1 Mechanisms where one fix moves several blockers

| mechanism | blockers | the one fix |
|---|---|---|
| Verification sits at the answer, but the risk sits in a few decisions | B1, B7, B5, B12, B13, B8, B17, B15; B2 option 2 | A **decision ledger** emitted by `flow`: decision id, inputs, margin, leverage, tier, check coverage, quote. It feeds margin-proportional audits (B1), comparison by decisions (B7), leverage (B5), module boundaries (B12), step labels (B13), conformance acceptance (B8), precedents (B17) and Kev labels (B15) |
| Agreement taken as correctness inside one model family | B2, B3, B5 (leaf agreement), B8 (agreement with demonstrations), B15 (teacher value = label), B16 (quality assumed equal), B17 | Independent sources by construction: code consequence checks (D6 N3, the B1 double-entry count, B12 residuals), a non-Claude labeller (the owner; Kev or Jev), and a random audit floor |
| No random-propensity audit, so every oracle-free rate is biased | B2 (discrepant analysis), B17 (dispute-only labels), B16 (missing counterfactuals), B15 (Kev evaluation set), B1 (risk-limiting audit) | One ε-random shadow floor with logged propensities, used for every silent-miss and durability number. Targeted shadows stay, but never feed the reported rate |
| The domain of validity lives in code the compiler rewrites | B4, B11, B12, B18, B13; B2 (lone answerer) | A runtime-owned, monotone domain artifact: profile, concept set, contract key, refusal suite, evidence record. It widens only through a recorded re-baseline. One "guarded region" construct (D8) serves module boundaries, reuse gates and episode handoffs |
| Semantics never made explicit and owned | B6, B8, B7 (comparator spec), B3 (law against fact), B17 (precedent), B5 (global reads), B14 (approved deviations) | The strong model or the owner settles questions of law once per family: quoted rulings, a rulebook, a contract with per-field materiality. Cheap tiers fill in facts. Rows 9 and 21 test this on records and kinetics |
| Instrument defects passing as system defects | B6, B8, B7, B9, B10 | Gauge and instrument checks before mechanism experiments (rows 1, 2, 3, 6) |
| An arm is one draw from a lineage distribution | B9, B2, B12 (heal blast radius), B18 | Lineages as the unit of analysis (power and CI per lineage) and of deployment (siblings rather than replacements, as in D4 option c) |
| Shared resources without a scheduler | B10, B10b; shared draws (B9) | One admission layer with a usage meter and a CPU meter, criticality classes and a pacing curve (rows 6, 39, 46) |

### 5.2 Ideological roots that recur

| root belief | blockers |
|---|---|
| The task, and its whole answer, is the unit of compiling, verifying and healing | B1, B7, B12, B13 |
| Agreement (with a teacher, siblings or demonstrations) is evidence of correctness | B2, B3, B5, B8, B15, B16 |
| A refusal is a defect to compile away; a silent miss costs nothing because nobody sees it | B4, B18 (D7: D9 is a deletion-only patch), B11 |
| A teacher is one entity with one trust level | B3, B5, B15, B17 |
| An arm is a configuration with one performance number | B9, B18 |
| A compile failure is a compiler-skill failure, so a stronger or trained compiler fixes it | B6, and the composer question |
| The meter is dollars, parallelism is free, a 429 is an outage | B10, B10b |
| Replication means rebuild once and score once against a hand-built oracle | B14 |

---

## 6. Claims to treat with care

### 6.1 Dossier numbers that disagree with the repo

| claim | where | repo | note |
|---|---|---|---|
| s214 was under-merged "identically by three independently compiled solvers", "compiled from Opus, Sonnet and Haiku traces" | D1 §B2.1 Fact 1; D2 §B1.1; D8 §B12.1 | nversion JSON: s214 was answered by `opusV1`, its child `opusV2`, and `sonnetV1`; `haikuV1` deopted | Only two independent lineages agreed on s214. The common-mode evidence is one task and two lineages |
| O/H v2 "answered and failed 5 of 7" d4 tasks | D4 §B4.1, D7 §B18.1, D8 §B12.1 (from DEV-NOTES D9) | nversion JSON: `opusV2` is wrong on 6 of 8 d4 tasks (passes only s219 and s221); 5 of 7 if s217 is left out | This is the offline probe, not the stream; the live O/H stream lost 2 d4 tasks (D12: d4 6/8). **DEV-NOTES D12's "5 silent compiled misses on d4" also describes the probe, not the stream.** Erratum for §5.1 |
| Haiku "loses 1" task to the tier swap | D6 §0 N1 | Committed tier-down JSON: s204's variant status is `deopt` | 2 lost (C3). Also, D11's wording ("Of the 3 Haiku tasks lost against Opus, … the second deopt …") does not match the committed file, which shows one deopt (s204), one pass→fail (s208) and one task both tiers failed (s205). Erratum for §5.1 |
| Haiku agent "$0.062 per task" (sweep F5) | D4 §B11.6 | FG §0.3: $0.103 | Corrected before the dossiers were written |
| A deopt costs "about 130×" a compiled run (sweep F9) | D4 §B4.2 | FG §0.3: about 55× the median `ok` run, about 30× the all-in mean | As above |
| "Of 6 disagreements so far, 3 were unresolved" | D3 §B17.1 | FG S3 at 04:22: 9 disagreements, 5 unresolved | The 03:55 snapshot |
| "The 17 known wrong compiled outputs" (records) | D5 E8.2 | FG S1: 17 of 56 at 03:55 counted records 15 and kinetics 2; records had 16 at 04:22 | Wrong denominator |
| "The 17 compiled deliveries" | D2 E2, E3 | D10: S/H delivered compiled answers 19 times (17 pass) | An AUROC needs failures in the set |
| Router threshold "$4.5 at slider 0.5" | D6 §B16.1 | `router.mjs`: payback = 1 + 2s = 2.0, so 2.0 × $3 = $6 | The conclusion (interpret) does not change |
| The recompile prompt "orders the widening" (`prompts.mjs:96–101`) | D4 §B4.1 | Prompt v4, in the §3 config, says "Never widen a guard further than the traces you can reproduce" (`prompts.mjs:125–137`); v1–v3 keep the old text | Partly fixed. The deeper point (the fence lives in rewritable code; one example stretches the profile, M3) stands |
| Kinetics compiles cost "$3.2–8.1", cited to FG §0.1 | D5 §B6.1 | FG §0.1 gives per-arm compile totals ($9.63–13.94); HANDOFF §2 gives $3–7 for Opus fallbacks | Not traceable to the cited table |
| Tolerant comparison not landed; kinetics never compiled well; hidden paths mean contamination; seeds ≥ 7001 | D5, D2, D7 | See C5, C4, C7, C2 | — |

### 6.2 Measurements made on data that is now lost

These are now the only record. They cannot be re-verified, and R0 will not reproduce them exactly. Copy them into DEV-NOTES D13
with that label:
- **D1:** the S/H-vs-O/H split, 5 S-only and 1 O-only.
- **D2:**
  - s205 (36 predicted against 34 entities, recall 0.970) and s214 (40 against 36, recall 0.873);
  - s205's grader cliff at `entitySlack` 0.02;
  - the S/H v1 identity rule at `solve.mjs:493–498`.
- **D3:**
  - H/H label noise: s202 at 0.973 (a warmup trace) and s205 at 0.981 (a deopt fallback);
  - 4 of 11 compiled outputs passed;
  - the sign overrides in BUILD-NOTES: 16, 9 and 17;
  - the Sonnet agent's per-seed string `0100100010101000|11111111`.
- **D4:** M2 (one `shapeKey` for d3 and d4); M3 (O/H v3 profile); S/H v2 adopted with `accepted: false` at exact 0.143.
- **D5:** N1–N6, all of them, including N6's 23.7 °C scope dispute (+2.8% Km, a changed exclusion set).
- **D6:** N1–N3, including the data margins that decided the three cheap-tier date errors (s204 4:1, s207 1:3, s208 0:6) and
  the 61 date sentences that collapse to 36 forms.
- **D7:** 21 compile records, $44.30, and 41 hidden-path attempts.
- **D8:** helpers re-derived 10/10 times; 0 imports across 21 solvers.
- **D9:**
  - the 187-minute stall, 252 rows and 71 `MODEL_RATE_LIMIT` faults;
  - 19–20 fault rows per Haiku agent arm;
  - the concurrency table;
  - the peak of 19 concurrent task rows.

### 6.3 Small-n and K=1 claims not to repeat as findings

- **"Common mode is real"** (B2) rests on:
  - s214, one task with two independent lineages (§6.1);
  - Fisher p ≈ 0.032 on 3 joint failures among 20 tasks;
  - β ≈ 0.7, with an interval D1 itself calls very wide.
- **"Lineage variance dominates interpreter strength"** (B9, D12) rests on one lineage per arm. McNemar p = 0.22 means *no
  evidence either way*, not evidence for lineage variance as the cause. The design effect of 3.3 assumes ρ = 0.1; ρ has never
  been measured.
- **Tier-down and consequence checks:**
  - D11 is 8 tasks per tier, and partly confounded (C3).
  - D6 N3's 25/25 is on 13 dev tasks that D11 had already diagnosed.
  - Haiku's 3% per-leaf date-order error is 1 of 33.
- **Acceptance (B6, B8):**
  - "Acceptance does not predict success" is n = 17.
  - "Opus is rejected at a similar rate" is 6 attempts against 5.
  - The regex false reject is n = 1, though its mechanism is confirmed in code.
- **Teachers (B3):**
  - "29% label noise" is 2 of 7.
  - "The compiler override was probably correct" is unchecked.
- **Profiles (B4):** "every detection comes from size" holds on records dev only. Kinetics d5 had signals that were not size
  (HANDOFF §4).
- **Router (B16):** "v0 would pick the worse option" uses K=1 arm totals.
- **"Verifying whole answers spends about 50× too much"** (D2 §B1.2; THESIS-JIT §6.2's "about 1/50"). This is an estimate;
  FG S5 says the cost of decision-level checks is unmeasured.
- **Throughput (B10):** the contention table (≤ 6 in flight: 78%; ≥ 10: 72%) is confounded by task mix and arm. The 69% and
  36% shareable-spend figures are upper bounds that assume request equivalence, which is unchecked.
- **Other beds:** B13's gridquest figures are code stand-ins, and no LLM has run there. B14's pilot figures (18, 11 and 5 design
  classes; $11 per item) come from 5 pilots.

### 6.4 External sources the dossiers did not verify

This synthesis fetched nothing, so every external claim below is as reported by a dossier agent. Each was marked by its dossier as
abstract-only, secondary, unverified, or recent enough to need a check.

**N-version and aggregation.**
- Ron, Baudry, Monperrus, arXiv 2606.20158: failures 387.44 → 130.99.
- Nogueira et al., arXiv 2607.02808: 0.43 and 0.44 of the independent gain; under 0.3 for same-model ensembles. D1 calls this the
  closest analogue to D8, and C9 leans on it.
- Goel et al., ICML 2025 (abstract only).
- Ai et al., ICML 2026: "surprisingly popular" is worse than majority for correlated LLMs (abstract only).
- Prelec et al.'s 21.3% (from a search snippet).

**Skills and reuse.**
- SkillApt, arXiv 2609.26863: 81.9% → 91.3% at 26.3% activation (abstract).
- SkillOps, arXiv 2605.13716: the meaning of its contract fields is unverified.
- SkillsBench's "self-generated skills give no average benefit" (via the earlier sweep, not re-opened).

**Standards and practice.**
- IEC 61508 β point values; NUREG/CR-5485 (seen only through citing papers).
- AIAG MSA edition and page; JCGM 106 normative text.
- The RCV formula and the MUS 3.0 factor (from model knowledge).
- Krippendorff's α thresholds (secondary); ISO 2859-1 switching rules (secondary).
- Whether an FDA PCCP can cover a change to intended use.
- Hand and Henley 1993 (secondary).
- Celonis's handling of allowlisted violations (its docs and forum disagree).

**Games and agents.** Code World Models, PORTAL and BTGenBot-2 figures; Thresholdout details.

**Operational claims for B10.** These matter most, because a governor would be built on them:
- "limits are shared across all models";
- `autoContinueAtUsageLimit`;
- "the cache lives an hour on a subscription";
- window anchoring at first use (third-party guides only);
- whether the subscription meter discounts cache reads.

Verify them against current Claude Code documentation, or measure them with row 6, before building a governor.

---

## 7. Open questions for the owner

1. **Held-out seeds.** PREREG-stream's 7001–7024 and 7101–7124 sit inside Kev's reserved records test ranges (C2). Move the
   JIT held-out set to 8001–8024 and 8101–8124 per family, recorded in a global seed ledger (FG P2)?
   - *Recommendation: yes.* It satisfies the "≥ 7001" rule and removes the collision before anything is inspected.
2. **R0.** Authorise the records dev re-run (JIT S/H, O/H, H/H plus the Haiku agent, §3 config, persistence on), at about $23
   list, budget $30, in your usage, after rows 1, 2 and 6 and the persistence fix?
   - *Recommendation: yes.* Records only. Kinetics waits for rows 2 and 3, then O/H first.
3. **O1, for one parameter.** May the kinetics tolerance from the gauge study (row 3) enter the frozen PREREG as a
   dev-calibrated value?
   - *Recommendation: yes,* for this parameter only, with the calibration slice frozen, disclosed and kept apart from any
     claim seeds.
   - If no: the PREREG states a value derived from the prompt's ±10% grading rule, with its reasoning, before row 3's results are
     read, and row 3 only reports that value's error rates.
4. **Jev.** Add a `policy/models.json` entry for analyst-side use only (J1 comparison, B15-E2, an extra cheap tier in row 4),
   with the key from an env var and dev bed text only?
   - *Recommendation: yes for analyst-side use.* No system-component use until a dev comparison with Haiku and stock Kev
     exists. The Kev J2 training decision stays gated on B15-E2's kill rule (§2.3). Check first whether TypeSafe offers
     fine-tuning; if it does not, Jev cannot answer any training question.
