# BLOCKER-SYNTHESIS critique

*research/jit-20261008/BLOCKER-SYNTHESIS-CRITIQUE.md · 2026-10-09*

**Status: adversarial critique of [BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md) (commit db12bd0). Not yet folded into the
synthesis.**

**Method.** Every claim that changes an action was checked against committed files, the working tree and `git log`. No model
calls, runs, web fetches or commits were made. A claim counts as confirmed only when a file or commit shows it. Sealed beds were
not read: one early repo-wide grep matched two lines of `beds/sealed/sealed.test.mjs` (generate and determinism calls, no bed
content), and every later search excluded `beds/sealed/`.

**Notation.** In this document "dossier N" is agent result N of `handoff/workflows/wf_da253fe6-f97.md`. "DEV-NOTES Dn" is a
DEV-NOTES entry, and "THESIS Dn" is an owner decision in `docs/THESIS.md` §10. The synthesis writes all three as "Dn"
(must-fix M8). "Row n" is a row of the synthesis §2 table.

**Bottom line.**
- Most of the synthesis's arithmetic reproduces exactly from committed files. That covers the nversion statistics, Fisher,
  Wilson and McNemar, the tier-down counts, the shareable spend and the router threshold.
- Its action-changing claims are weaker:
  - the seed "collision" is a reservation, not contamination;
  - the rank-2 regex fix has little bearing on the §3 config;
  - C10 confuses oracle-scored PREREG outcomes with oracle-free ones;
  - row 7 misreads what the v2.2 rule checks;
  - R0 is asked to do two incompatible jobs;
  - the Jev material predates the owner's direction and the J1 Jev reads, which are already committed.

---

## 1. Must-fix items

| id | where | exact change |
|---|---|---|
| **M1** | C2; §1 last bullet; §4.1 step 5; §7 Q1 | Rename the problem "registry reservation, no contamination". Keep the move to 8001–8024 / 8101–8124 per family, as $0 insurance and not as a defect fix. State the clean range as **test-split seeds ≥ 7200 for every bed**. Add that synth test seeds 7000–7099 were already generated and scored, so the ledger must be keyed per bed (§2, V1–V4) |
| **M2** | row 2; §2.1 lines 234–235; §4.1 step 7 (line 338) | Demote row 2 from rank 2 to a ≤ 1 h hardening task inside step 0 (case-insensitive id match, an id-range parser, or a structured `verdicts.json`). Couple it with the decision on adopting `accepted: false` versions. Delete "after row 2 has a chance to withdraw B6's premise" and "can still be withdrawn by row 2". Only re-accepting real kinetics compile attempts can test B6, which needs a kinetics re-run (M10) |
| **M3** | C10 verdict; §4.1 step 5 "no random audit floor"; §5.1 row 3 | The PREREG's silent-miss rate is oracle-scored on every delivered answer (`durability.mjs:19–20`; PREREG §3), so the shadow schedule cannot bias it. New verdict: a random-propensity floor is needed for **system-view** (oracle-free) estimates (system-view durability, router training rows, any self-reported miss rate). It is not needed for the PREREG's oracle-scored outcomes. Adding a floor changes arm behaviour and cost, so it is a config choice to freeze, not an instrument defect |
| **M4** | row 7; §2.1 "Row 7" bullet | Delete "the opusV1 → opusV2 edge is computable now" as a test of v2.2. v2.2 replays only the refusal traces in the pool (`stream.mjs:181, 520–522`). At v2's recompile those were s205 and s206 (DEV-NOTES D3), and v2 passes both (nversion JSON), so v2.2 would most likely have **accepted** the D9 heal. Delete "the deletion-diff tool can be built and tested on the v1–v3 solvers in `tools/run-view/test/streams-fixture`": those files are one-line comments (`// fixture v2`). Say that the D9 class needs the AST deletion diff or a runtime-owned domain artifact, and use hand-made guard-deletion mutants of the static C0 solver as the testbed |
| **M5** | row 8; §2.1 "R0" bullets; §4.1 steps 3 and 5; §7 Q2 | Give R0 one job: a rehearsal of the §3 config. Delete "a second lineage per arm" and the step-5 condition "with R0 as a second lineage". R0 differs from the lost runs in config (prompt v4, strict, tolerant, preserveRefusals, shadowOnFlags) and in engine (2f9862a, plus the uncommitted Jev policy and `src/` changes), so pairing them confounds lineage with config. Restate the cost as about $23 for the default config, and **$25–40 expected** under the §3 config, with per-arm spend caps. Either run R0 on fresh dev seeds 225–248 (reserved by FG §4.1, where the v2.x guidance was not tuned) or label it non-validating |
| **M6** | row 1; §2.1 line 196 | Change "Replace `NOISE_SUCCESSES`" to: keep the owner's 3-point floor (HANDOFF §0; ROADMAP:889), add the exact McNemar test and the lineage-clustered CI, and report an effect only if it clears the floor and the test and holds in both streams. Replace "counts tasks where PREREG-stream counts points, so a 22-vs-18 draw prints as real" with: "a fixed threshold is not a test; 22 vs 18 clears it in either unit" |
| **M7** | §0 "Also new"; §2.3; row 15; C11; §4 row 6; §4.1 steps 2 and 10; §7 Q4 | Rewrite for the owner's direction "Jev replaces Kev for the judge program" (`policy/models.json` working-tree note, `judgmentModels: jev-latest`, `credentialEnv FOUNDRY_SYSTEMONE_API_KEY`). The J1 Jev reads are done (commit 4517c4a). Mark Kev J2 as parked. Replace Q4 (§6 of this document). Downgrade "Jev comes from a different vendor lineage … better than Kev" to unverified |
| **M8** | whole document | Rename the dossier references "dossier 1–9" (or A1–A9). Examples of the collision: line 246 "(2/8, D5)" means DEV-NOTES D5; line 294 (C9) uses "D8" in both senses; line 306 "(D9)" means dossier 9; row 32's "D10/D15" are THESIS decisions, while D10 elsewhere is DEV-NOTES D10 |
| **M9** | §6.1 | Add these errata. (a) DEV-NOTES D8, "wrong in all three solvers", needs the same two-lineage correction as s214. (b) DEV-NOTES D9's "5 of 7" becomes "6 of 8 (5 of the 7 after s217)". (c) The live O/H d4 silent misses (s218, s223) came from **v3**, not v2 (FG S8), so the "v2 heal → d4 silent misses" link is shown only in the offline probe. (d) For dossier 5 E8.2 on the nversion data, the count of known wrong outputs is **24 of 67** answers, not 15 or 16 |
| **M10** | §2 table; §4.1 | Add a costed kinetics dev re-run ("R0-K": O/H first, about $25 for 24 tasks at FG §0.1's $17.82 per 17) as its own row and owner question. Dossier 5 E6.1 (is B6 an artefact?), the E8.1 acceptance-predictiveness audit, row 21's gate and row 34 all depend on it. The synthesis defers kinetics but never prices or ranks it |

---

## 2. Verdict table

### 2.1 Seeds (C2)

| id | § | claim | verdict | evidence | required change |
|---|---|---|---|---|---|
| V1 | §1; C2 | Kev's registry reserves test 7000–7039 and 7040–7199 (`README.md:31, 232, 307`) | **confirmed**. The registry covers every bed, not only records | `experiments/kev-data/README.md:31, 232, 307`; `lib/registry.mjs:2–13` ("The ranges apply to every bed"); `build.mjs:61–62`; `JUDGE-PROGRAM.md:1121` | Drop "records" from "reserves records test seeds"; say "every bed" |
| V2 | C2 | "Both PREREG ranges collide" | **partly**. The keys collide: same bed, same split, same seed, and difficulty inside d3–d5, and the world is a pure function of (bed version, split, seed, difficulty). But **nothing in 7000–7199 has been generated or read for any bed by Kev**: the `realtrace-x8` and `e2e-harness` groups were planned and never built, and the records factory yields 0 reserve-slice records | `beds/records/world.mjs:308` (`rng('records','v2',split,seed,difficulty,attempt)`); `experiments/lib/beds.mjs:29–34` (same key form); `JUDGE-BUILD-PLAN.json` groups `realtrace-x8` and `e2e-harness`, with no `experiments/kev-data/realtrace/` or `e2e/` directory and no commit; `experiments/kev-data/test/records.test.mjs:148–149` ("the real and e2e reserves yield nothing"); `ports/kinetics.mjs:68`, `runbook.mjs:85` and `synth.mjs:60` all give `'real-reserve': []` | See M1. The real hazard is future and two-way. If X8-real ran (Haiku on records test 7000–7039 × d3–d5) and anyone read its outputs, the JIT records set would no longer be "never inspected". If the JIT held-out run went first, it would burn Kev's reserve. With Kev training replaced by Jev, X8-real may never run, but the registry is still code |
| V3 | C2; §7 Q1 | "≥ 8000 is clean" | **confirmed**. No code, config, test or document generates or reserves test-split seeds ≥ 7200 for any bed. The only mentions of ≥ 8000 are proposals | Repo-wide search (sealed beds excluded): bed tests use test seeds 1–30, 101–103, 777, 900–907 and 5000–5099; Kev uses up to 7199; `experiments/c0/run-dev.mjs:132` uses 6001–6004; the heal experiments use 5002, 6001 and 6004. ≥ 8000 appears only in FG P2/P10, dossiers 3, 4 and 8, and `review-20261007/11-CRITIQUE-rigor.md:469` | Keep 8001–8024 / 8101–8124 |
| V4 | C2 (missing) | (not stated) other uses of 7000+ | **missing**. The synth bed's test seeds 7000–7099 were generated and scored once, at all five levels, by the triviality attack | `beds/synth/AUDIT.md:15, 26, 134`; `beds/synth/README.md:311` | The ledger is per (bed, split). If synth ever becomes a PREREG family, treat synth 7000–7099 as burned |

**C2 verdict.** No JIT held-out world is contaminated today:
- No records or kinetics world in 7000–7199 has been generated or read.
- The Kev entries are reservations, and the two consumers that would have read them were never built.
- `stream.mjs:80` enforces only ≥ 7001, so nothing stops an accidental run in Kev's range.

**Safe range:** test split, seeds ≥ 7200, for every bed. This range is neither used nor reserved, and it satisfies the owner's
"≥ 7001" rule. Records and kinetics 7001–7199 are also unread, but Kev reserves them. Synth 7000–7099 is used.

**Recommendation:**
- Keep 8001–8024 (stream A) and 8101–8124 (stream B) per family. Record them in a per-bed ledger that both `stream.mjs` and
  `kev-data/lib/registry.mjs` check.
- Freezing the PREREG does not have to wait on this. It is a one-line PREREG edit.

### 2.2 Ranking rows

| id | § | claim | verdict | evidence | required change |
|---|---|---|---|---|---|
| V5 | row 2 | `acceptance.mjs:45` needs the literal token in both modes | **confirmed** as code | `acceptance.mjs:45, 48, 112` (`explainCase` filters note blocks by `mentions`) | — |
| V6 | row 2; §2.1 | The strict gate can reject a numerically right compile on wording, which matters for §3 | **mostly refuted** for §3. Three reasons. (1) The §3 kinetics `compile.compare` is tolerant (relTol 0.01), so dossier 5 N3's "≤1e-5" diffs become `exact` and need no note. (2) Case sensitivity is a deliberate, tested design choice. (3) Adoption does not require acceptance; a false reject only triggers the Opus fallback and its ranking. One residual risk the synthesis misses: strict's "shared text explains no case" rule can reject a disagreement argued only from SOP boilerplate that every task shares | HANDOFF §3 table; `check-traces.mjs:161` (tolerant → `exact`); `acceptance.test.mjs:46` ("the case id is matched as written by check-traces"); `stream.mjs:528, 531, 554`; `acceptance.mjs:20–21, 116` | M2 |
| V7 | row 2 | "Add a test that reproduces D5 N3" | **partly**. The case-sensitivity behaviour is already tested (`TRACE-0` is rejected). N3's real trigger was the dev config (named mode, canonical compare), not §3 | `acceptance.test.mjs:17, 46`; `configs/dev-kinetics-1.json` (no `compile.acceptance` or `compare`) | If kept, test the §3 path: a tolerant within-band diff produces no diff case |
| V8 | §2.1 lines 234–235; §4.1 step 7 | Row 2 can withdraw B6's premise before the $40 rulebook spend | **refuted**. Row 2 produces no evidence about Haiku against Opus acceptance. That was dossier 5 E6.1 (re-accept the 11 kinetics attempts), and its inputs are lost | Dossier 5 §6 E6.1; synthesis §4 row 4 itself says E6.1 "cannot be done" | M2, M10 |
| V9 | row 1; §2.1 | Report counts tasks where PREREG counts points, "so" 22 vs 18 prints as real | **partly**. The unit mismatch is real (`report.mjs:10, 177`; PREREG §4 "≈1.5 tasks of 48"), but the task-count rule is the *stricter* one. 22 vs 18 clears either rule; the defect is that neither is a test | `report.mjs:10, 177, 185`; `PREREG-stream.md:49–51`; dossier 1 §B9.1 | M6 |
| V10 | row 3 | Stage A is $0 now and yields the kinetics relTol to freeze | **partly**. The inputs exist: the bed has 8 plausible-but-wrong controls (`beds/kinetics/index.mjs:171–251`), and the grading rule is in the prompt (`render.mjs:891`). But Stage A's correct–correct spread comes from two fitters the analyst writes, and most controls differ by ≥ 15% or by the exclusion set, which any relTol ≤ 0.05 plus a set-exact comparison already separates. Stage B (agent answers) is the evidence. It runs sandboxed agent sessions, so it needs `CLAUDE_CODE_OAUTH_TOKEN` | `beds/kinetics/README.md:62, 96–98, 272–273`; `compare.mjs:45, 53`; RESUME "Running here" | Freeze the value from Stage B; present Stage A as a sanity check; add the token dependency |
| V11 | row 4 | Stage 1 is $0 and runnable now | **confirmed** (the records generator regenerates, and truth comes from the generator) | `beds/records/world.mjs`; dossier 6 N3 | Score Stage 1 on fresh dev seeds 225–248 as well as 201–224: the check was designed after the three errors on 201–224 were known |
| V12 | row 5 | The simulator settles whether the PREREG needs a random floor | **partly**. It runs now on the nversion JSON, but with a perfect reference (the Opus agent's 24/24) and n = 24 it is essentially a power calculation. Its stated payoff (bias in PREREG silent-miss numbers) does not apply (V27) | `nversion-records-dev.json`; `durability.mjs:19–20` | Re-scope to "size an ε floor for system-view estimates"; keep it cheap |
| V13 | row 6 | Meter capture, Haiku-cents, runnable now | **confirmed** as runnable (`claude -p` with Haiku works; RESUME). It is not a hard prerequisite for R0 | RESUME "The bridge" | Make it a parallel task, not an R0 gate |
| V14 | row 7 | The opusV1 → opusV2 edge tests v2.2 | **refuted** | `stream.mjs:178–186, 520–522`; DEV-NOTES D3; nversion rows s205 and s206 (opusV2 passes both) | M4 |
| V15 | row 7 | The deletion diff can be tested on the run-view fixture v1–v3 solvers | **refuted** | `tools/run-view/test/streams-fixture/runs/jit-fix-1/.../v{1,2,3}-*/solve.mjs` each contain one comment line | M4 |
| V16 | row 8 | R0 costs about $23; budget $30 | **partly**. The arithmetic is right for the default config: 8.99 + 7.53 + 4.09 (H/H, $3.24 for 19 tasks, scaled to 24) + 2.46 = $23.07. It omits the §3 config's flag-triggered shadows (about $0.6–1.2 each, FG S5) and strict-acceptance fallbacks. It also leaves out the static arm ($1.21), which the PREREG lists | DEV-NOTES D10, D12; FG §0.1, S5; PREREG §2 | M5 |
| V17 | row 8; §2.1 | R0 is both a rehearsal of the frozen config and a second lineage | **refuted** as a pair | Dev configs lack `promptVersion`, `acceptance`, `preserveRefusals` and `shadowOnFlags` (`configs/dev-records-1.json`); commit 2f9862a changes `src/` ("the frozen construction-kit hash changes"); the working tree changes `policy/` and `src/` | M5 |
| V18 | row 8 / §2.1 | R0 makes rows 11, 13 and 24 "$0 replays" | **partly**. Row 11 needs an override hook and memo replay, which `flow-v2.mjs` does not have. They must exist **before** R0 compiles, or R0's solvers cannot be replayed that way | `flow-v2.mjs` (no `FLOW_OVERRIDE`); dossier 6 X5-2; FG P1 item 3 | Put the hook and the salt-free memo in step 0 as R0 prerequisites |
| V19 | row 10 | "blocked: needs R0 solvers" | **partly**. The synthesis names a fallback that exists now (the static C0 records solver), so the label is "partly" | `research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs` | Relabel "partly: C0 now, JIT after R0" |
| V20 | row 15 | J1: Kev and Haiku yes; "Jev needs owner (a policy entry)" | **overtaken**. The Jev J1 reads ran and are committed: jev-1.13.0; 487/562, 461/461 and 158/158 records/questions; 0 faults; on re-read, 0 argmax flips and max \|dp\| 0.03–0.07, which fails the \|dp\| < 0.01 validity rule | Commit 4517c4a; `research/judge-20261009/data/jev/J1/*.report.json` | M7 |
| V21 | row 16 | B15-E2 is runnable because the generator-only parts rebuild | **partly**. The laptop rebuild with stub pools is not byte-identical to wave A, and the factory's paraphrase pools are lost, so a factory stream would understate surface-form novelty. That is exactly what the kill rule measures | `research/judge-20261009/data/rebuild-check.json` (`devSelectIdentical: false`); RESUME "Lost" | Run it on bed-rendered records notes (dossier 6 N3 used those: 61 sentences, 36 forms), not on factory pools |
| V22 | §1 spot checks | nversion statistics; Fisher p ≈ 0.032; Wilson 74–98%; McNemar p = 0.22; 7 unanimous, 6 correct; opusV1's 15 refusals, of which opusV2 got 8 right (d3 6/7, d4 2/8); d4 refusal sets | **confirmed** (recomputed: hypergeometric P(X≥3) = 0.0320; Wilson 0.741–0.977; 14/64 = 0.219) | `nversion-records-dev.json` rows | — |
| V23 | §1 | Tier-down: Haiku 5/8 against 7/8, Sonnet 3/8; $0.0061 / $0.0241 / $0.0386 | **confirmed** (Haiku `meanTotalUsd` is 0.006169, which rounds to $0.0062) | `tierdown/live-rules-{haiku,sonnet}.json` | — |
| V24 | §1 | `report.mjs:10`; the router is not imported; adoption does not need acceptance; shareable spend $5.16 / $3.27; kinetics README bounds | **confirmed** | `report.mjs:10`; `stream.mjs` imports (lines 10–20); `stream.mjs:528–554`; DEV-NOTES D10, D12; `beds/kinetics/README.md:62, 84, 96–98` | — |

### 2.3 Errata in synthesis §6.1

| id | claim in §6.1 | verdict | evidence | required change |
|---|---|---|---|---|
| E1 | s214: only two independent lineages (opusV1, opusV2 = its child, sonnetV1; haikuV1 deopted) | **confirmed** | nversion row s214 | DEV-NOTES D8 makes the same "all three solvers" claim and needs the erratum too (M9a) |
| E2 | O/H v2 is wrong on 6 of 8 d4 tasks; "5 of 7" only without s217 | **confirmed** | nversion d4 rows (passes only s219 and s221) | Name DEV-NOTES D9 as needing the erratum, not only D12 (M9b) |
| E3 | D12's "5 silent compiled misses on d4" describes the probe, not the stream | **confirmed**, and stronger than stated. The stream had 6 compiled failures in all (d3 4, d4 2). Its d4 misses s218 and s223 were v3's; v2 met only s217 on d4, and a shadow caught it | DEV-NOTES D12 (compiled 18, 12 pass; d4 6/8); FG §0.1 (7/19, 6 delivered, 1 caught); FG S8 | M9c |
| E4 | D11: Haiku lost 2 (not 1); the D11 wording does not match the file | **confirmed**: s204 is the variant deopt (labelled "cap reached"), s208 went pass→fail, s205 failed in both | `tierdown/live-rules-haiku.json` tasks | — |
| E5 | $0.062 → $0.103 "corrected before the dossiers were written" | number **confirmed**; timing **unverifiable**. FG was first committed at 04:33:50 while the dossier agents were still running, and dossier 4 cites the uncorrected sweep F5 | `git log` (3630926); FG §0.3; dossier 4 line 1329 | Drop "before the dossiers were written" |
| E6 | 130× → about 55× / 30× | **confirmed** | FG §0.3 | — |
| E7 | "6 disagreements, 3 unresolved" is the 03:55 snapshot; 9 and 5 at 04:22 | **confirmed** (03:55: 3 true plus 3 false disagreements; unresolved: H/H s208, H/H s214, kinetics O/H s207) | FG S1–S3 | — |
| E8 | "17 known wrong outputs" mixes families (records 15 + kinetics 2) | **partly**. Right about the 03:55 count, but E8.2 runs on the nversion table, where the count is 24 wrong of 67 answers | nversion summary; DEV-NOTES D8 ("43 of 67") | M9d |
| E9 | "17 compiled deliveries" should be 19 (17 pass) | **confirmed**. Add: on S/H the AUROC rests on 2 positives and is degenerate. Pool the arms, or use the static C0 solver's 8 wrong outputs | DEV-NOTES D10; FG §0.1 | Add the degenerate-AUROC note |
| E10 | Router threshold $6, not $4.5 | **confirmed**: payback 1 + 2 × 0.5 = 2.0, times the $3 default | `router.mjs:32, 47, 60` | — |
| E11 | Prompt v4 says "never widen…"; v1–v3 keep the old text | **confirmed** (v4 at `prompts.mjs:129–137`, not 125; v1–v3 at 137–143). v4 is opt-in, and the dev streams ran the old text | `prompts.mjs`; dev configs | Fix the line range |
| E12 | "$3.2–8.1" is not in FG §0.1 | **confirmed** | FG §0.1 gives per-arm totals of $9.63–13.94 | — |

### 2.4 Conflict resolutions C1–C12

| id | verdict on the synthesis's pick | evidence | required change |
|---|---|---|---|
| C1 | **partly.** "Unresolved, row 3 decides" is right. The provenance note is wrong: DEV-NOTES D7 and FG §4.1 explicitly allow the **bed README's stated precision** as a threshold source when O1 = no, so the 5% and 8% bounds are not off-limits by the repo's own rule | DEV-NOTES D7; FG §4.1; `render.mjs:891`; README:96–98 | Fix the provenance note and the Q3 fallback ("the prompt's ±10% rule **or the README's stated precision**") |
| C2 | **partly** (§2.1 above) | V1–V4 | M1 |
| C3 | **confirmed.** Haiku 2 (dossier 6 itself diagnoses s204 as ATLAS). Sonnet 3 against 4 stays unresolved | Tier-down JSON; dossier 6 N1 | — |
| C4 | **partly.** The 0.547 ceiling is the instrument (exact comparison), but dossier 5 N2 is tagged [inference] by its own author, and compiled kinetics quality is mixed: O/H 9/10 correct, H/H 3/5, S/H 0/2 | FG §0.1 kinetics table; dossier 5 N2 | Say "the partial-agreement ceiling is an artefact; compiled kinetics quality still varies by arm" |
| C5 | **confirmed** | Commits 5506c63, 14612a9; `compare.mjs`; `check-traces.mjs:9–11` | — |
| C6 | **confirmed** (unresolvable, immaterial) | — | — |
| C7 | **confirmed**, with one gap: the §0.4 isolation probe was measured on the cloud host. On the laptop, before 2f9862a, the executor sandbox exposed `/home/raed` (repo, sealed beds, `~/.claude`) | FG §0.4; commit 2f9862a message | Re-run the §0.4 cross-arm probe on the laptop before R0 ($0) |
| C8 | **confirmed** | — | — |
| C9 | **partly.** The lean is defensible, but both sides are blocked on R0, and the evidence cell uses "D8" in two senses | DEV-NOTES D8; dossier 8 | M8; note both arms need R0 |
| C10 | **partly / mis-aimed.** The facts hold (periodic schedule; 4 of 21 known-wrong outputs shadowed). The consequence drawn ("PREREG silent-miss and durability numbers biased optimistic") is wrong for oracle-scored outcomes | `durability.mjs:18–28` (silent miss = experimenter's view; oracle-view and system-view durability); PREREG §3 | M3 |
| C11 | **overtaken.** Kev training is replaced by Jev. Dossier 6's point survives in a new form: hosted Jev should verify local facts, while global reads keep the strong tier plus consequence checks | `policy/models.json` working-tree note; ROADMAP §2.4 | M7 |
| C12 | **confirmed** (S/H's $4.83 covers 3 attempts: v1 Haiku, the rejected v2 Haiku and the Opus fallback) | DEV-NOTES D10 | — |

### 2.5 Revised order (§4.1) and owner rules

| id | step | verdict | why | required change |
|---|---|---|---|---|
| S0 | 0 Persistence | **confirmed** (`snapshot.sh:10, 12, 32` swallow errors; `*.tgz` is ignored) | — | Add: the override hook and memo (V18); the laptop isolation probe (C7); a recorded engine freeze point (V17); host-load fields (row 45). Persist journals as JSONL, or as release assets with a sha256 manifest: committing `journal.sqlite` conflicts with ROADMAP §6 rule 6 (no binaries in git) |
| S1 | 1 Dev write-up | **confirmed** | — | Add M9's errata |
| S2 | 2 $0 work | **partly** | J1 Jev is done; row 2 is demoted | — |
| S3 | 3 R0 | **partly** | M5 | M5 |
| S4 | 4 Decision verification and leverage before the freeze | **refuted as placed**. It contradicts step 5's own rule ("new mechanisms get their own amendments rather than delaying the first held-out test"). Rows 10 and 11 need code that does not exist (a decision ledger in `flow`, an override hook), which would change the config R0 rehearses. And §2.1's caveat says R0's solvers may not reproduce DEV-NOTES D1's misses | Synthesis lines 242–247, 326–333 | Run 10 and 11 in parallel with the freeze; adopt them by amendment or in the next held-out round. Or give a time box, after which the freeze goes ahead without them |
| S5 | 5 Freeze after R0 | **partly**. Moving it after R0 is justified: the §3 config has never run end to end, and the kinetics tolerance has no data. But 3 of the 5 "known defects" are mis-stated (regex V6, seeds V2, audit floor C10) | V6, V2, C10 | Rewrite the defect list as: the untested §3 config, the kinetics tolerance, the noise rule wording, K and power, the env-fault definition, and the engine freeze point |
| S6 | 6 Reuse | **confirmed** | — | — |
| S7 | 7 Spec-first kinetics | the move holds; **the rationale is refuted** (V8) | — | Gate on R0-K, row 3 and fresh warmups (M10) |
| S8–S9 | 8 Replication; 9 Portfolios | **confirmed** | — | — |
| S10 | 10 Kev | **overtaken** | M7 | M7 |
| S11 | 11 Router | **confirmed** | — | — |
| R1 | Owner rules | Nothing breaks a rule as written, but two places come close. (a) Row 1's "Replace" drops the owner's 3-point floor (M6). (b) Pairing R0 with the lost run, or using it as a second lineage for the power table, would turn a cross-config K=1 pair into a comparative inference (M5). No Workflow fan-outs, sealed-bed reads, sub-7001 test seeds or heal-proposal actions are proposed | HANDOFF §0; ROADMAP:881–891 | M5, M6. When B6 is withdrawn as an artefact, keep the raw rejection counts (dossier 5 N1) in DEV-NOTES D13 as a negative result |

### 2.6 Jev section (§2.3) and other items

| id | claim | verdict | evidence | required change |
|---|---|---|---|---|
| J1 | "the owner is exploring Jev as a substitute for training Kev" | **overtaken**. The owner directed that Jev replaces Kev. Jev was also already ROADMAP §2.4's default judgment engine, with Kev as the local alternative that had to beat Haiku 5.5 | `policy/models.json` (working tree) notes and `judgmentModels`; ROADMAP §2.4 | M7 |
| J2 | The dev-select files are in Jev's shape after stripping `label`, `src` and runbook `target` | **confirmed**: 1,106 records and 1,181 questions; `target` is on 2 runbook questions. Also strip `_meta` | `~/foundry-bridge/work/data/*-dev-select-*.jsonl` | Now historical (J1 done) |
| J3 | "Jev comes from a different vendor lineage … better than Kev" for independence | **unverifiable**. Jev's training data and base model are undocumented ("We don't know what Jev was trained on"), and Kev is Qwen-based, so it is also outside the Claude family | `research/kev-20261007/01-kev-dossier.md:93–99` | "Possibly independent; measure the error correlation of Jev with the Haiku, Sonnet and Opus reads on generator-labelled items (J1 data) before using it as a voter" |
| J4 | Jev "as one more cheap tier in the consequence gate" | **partly**. Jev sits in `judgmentModels`, which ModelPort does not read (it reads `models[]` only). `flow.judge` tiers are Claude model ids through the gateway, so a Jev tier needs new routing code: a new subsystem under ROADMAP §6 rule 12 | `policy/models.json` working-tree note ("ModelPort and class resolution read models[] only"); tier-down rewrite diff (`tiers: ['claude-opus-5-5']`) | State the routing work and keep it analyst-side until a port-level comparison exists |
| J5 | "Record whatever version the API reports" | **confirmed** and done (jev-1.13.0 per response). New: re-reads differ by up to 0.07 in probability, so any Jev use in a "$0 replay" must be journaled; it cannot be recomputed | 4517c4a message | Add a journaling requirement |
| J6 | `tests/model-policy.test.mjs` rejects other ids | **refuted** (the name is wrong; the policy notes repeat it) | `tests/models-policy.test.mjs` | Fix the file name |
| J7 | Jev price "unknown here" | **partly**. A second-hand, unverified $0.042 per M input tokens is now in the working-tree policy | `policy/models.json` `judgmentModels[0].price` | Quote it as unverified |
| O1 | §6.3: "D6 N3's 25/25 is on 13 dev tasks that D11 had already diagnosed" | **partly**. D11 covered 8 tasks (s204–s211). The real issue is that the check was designed with the three errors already known | Tier-down JSON; dossier 6 N3 | Reword |
| O2 | §2.1 / §4: the static C0 solver's "d4 silent failures (2/8)" | **wording**. 2/8 is its d4 *pass* count, so it had 6 silent d4 failures | DEV-NOTES D5 | Reword |

---

## 3. Missing items

1. **A kinetics re-run, costed and ranked** (M10). The kinetics run data is lost too, so every B6/B8 premise test needs it,
   along with the kinetics tolerance and the PREREG's second family.
2. **Two experiments of dossier 5 were dropped:**
   - E6.1's decision function (Haiku against Opus acceptance once the instrument is corrected);
   - E8.1's acceptance-predictiveness audit (AUC of four acceptance rules against downstream pass).

   Both need R0 and R0-K and deserve their own rows. Row 2 does not cover them.
3. **Dossier 2 E3 (double-entry entity count) deserves its own row near the top.** It costs $0, runs now on the static C0
   records solver (8 wrong outputs; FG §0.1) and regenerated tasks, and targets the DEV-NOTES D1 class directly.
4. **v2.2 likely does not prevent D9 as it occurred** (M4). The HANDOFF §3 config presents `preserveRefusals` as the D9 fix,
   and the synthesis repeats this without checking it.
5. **The decision on adopting `accepted: false` versions** (`stream.mjs:554`) needs to be made together with any acceptance
   change. Without it, acceptance only steers fallbacks.
6. **Engine freeze point.**
   - Commit 2f9862a changed `src/` (the kit hash).
   - The Jev work in the working tree changes `policy/` and `src/`.
   - ROADMAP §4.3 requires a named engine freeze for comparative runs. R0 and the held-out stream must run on the same
     recorded engine.
7. **A laptop isolation probe** (C7). The §0.4 refutation was measured on the cloud host.
8. **Reconciliation with FG §4.2.** The synthesis ranks the dossier experiments but does not map FG's own P-plan:
   - P8 is field-local cross-tier adjudication at about $1–3, which overlaps row 10;
   - P9 is the flow-v3 primitives (assume bands, consequence, k=3 global reads);
   - P13 is Bet B and P14 is Bet C;
   - P4b's fresh-seed replay is lost.

   It also ignores FG §4.1's rule that capability numbers come from "dev seeds that arm was not tuned on" (225–248).
9. **Persistence format against ROADMAP §6 rule 6.** "Commit the journals" must not mean binary SQLite in git (S0).
10. **Jev nondeterminism** (J5). It matters for replays, for the validity rule, and for any use as a gate.

---

## 4. Does the top 5 survive?

**Partly.**

| rank | verdict | why |
|---|---|---|
| 1 | survives | Fix the wording so the owner's 3-point floor is kept (M6) |
| 2 | **does not survive** | The §3 config's tolerant comparison removes N3's trigger, case matching is a tested design choice, and adoption ignores acceptance. Demote it to a step-0 hardening task (M2) |
| 3 | survives | Stage B is the evidence; Stage A is a sanity check |
| 4 | survives | Add fresh dev seeds to Stage 1 |
| 5 | survives at lower stakes | It sizes a floor for system-view estimates, not for the PREREG's oracle-scored outcomes (M3) |

**Suggested top group:**
1. Row 1.
2. Row 3 A, then B.
3. Row 4, stage 1.
4. Dossier 2 E3 on C0 (new).
5. Row 5, re-scoped.
6. Row 6.
7. Row 7, re-scoped to the deletion diff on C0 mutants.
8. The step-0 prerequisites: persistence, override hook and memo, laptop isolation probe, engine freeze record, and the row 2
   hardening.
9. Then R0, and R0-K after row 3.

R0's rank and job need M5's single purpose.

---

## 5. Seed verdict, in one place

- **Contamination now:** none. No records or kinetics world with a test seed in 7000–7199 has been generated or read. The Kev
  entries are reservations whose consumers (`realtrace-x8`, `e2e-harness`) were never built.
- **Collision:** real in key space for records (same bed, split, seed and difficulty band; deterministic generator). Nominal
  for kinetics (the registry reserves every bed, but no kinetics consumer exists).
- **Safe range:** test seeds ≥ 7200 for every bed. Use 8001–8024 and 8101–8124 per family, recorded per bed. Synth 7000–7099
  is already used.

---

## 6. How §2.3 and Q4 should read now

- **Direction.** Jev is the judge-program model by owner direction:
  - the working-tree `policy/models.json` lists `jev-latest` under `judgmentModels`;
  - the key comes from `FOUNDRY_SYSTEMONE_API_KEY`;
  - it is billed to the owner's TypeSafe account.
- **Promotion rule.** ROADMAP §2.4 applies: a port's Jev engine gates decisions only after it beats the rule and embedding
  baselines on held-out labelled data. The old Kev-vs-Haiku 5.5 bar becomes a Jev-vs-Haiku 5.5 bar.
- **J1.**
  - The Jev read is done (4517c4a). Its analysis is pending in `research/judge-20261009/`.
  - Haiku and stock-Kev reads are comparison points, not prerequisites.
  - Kev J2 is parked; reopen it only if TypeSafe offers fine-tuning or the owner reverses the direction.
- **B15** becomes "do trace-harvested labels suffice to *calibrate* a Jev port". Dossier 6's X15-1 label model is the source
  for ROADMAP §2.4's per-port calibration ledger.
- **B2 and B17.** Jev's independence from Claude must be measured, not assumed (J3).
- **Inside JIT streams**, Jev is analyst-side or shadow-only (logged, never acting) until a port passes the §2.4 bar. Wiring it
  into `flow.judge` needs new routing (J4), and adding it to the frozen PREREG config would be a new mechanism, so an amendment.
- **Replacement owner questions for Q4:**
  - (a) whether a Jev port may gate decisions in dev streams once it passes §2.4;
  - (b) whether non-synthetic text (R-bench, owner tasks) may be sent to TypeSafe; this is the data-egress question THESIS
    D10 already defaults to no for executors;
  - (c) a TypeSafe credit budget;
  - (d) whether to ask TypeSafe about fine-tuning.

---

## 7. Overall assessment

The synthesis is careful bookkeeping:
- every §1 spot check I re-ran reproduces;
- most §6.1 errata are right;
- the loss accounting is honest.

Its weaknesses sit in the parts that change actions:
- It turns a registry reservation into a "collision" that is listed as a freeze defect.
- It ranks a regex fix second on a premise that the §3 config itself removes.
- It reads oracle-scored PREREG outcomes as if a shadow schedule could bias them.
- It credits v2.2 with a check it does not make.
- It asks R0 to be both a config rehearsal and a replicate.
- Its Jev section was stale within a minute of its commit.

The D-number collision makes several rows ambiguous to read. With M1–M10 applied, the ranking stands on firmer ground: fix the
statistics, calibrate the kinetics tolerance from agent answers, check data consequences at $0, build the step-0 prerequisites,
then run R0 as a clearly scoped rehearsal and price a kinetics re-run.
