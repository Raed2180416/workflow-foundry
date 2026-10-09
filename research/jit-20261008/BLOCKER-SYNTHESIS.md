# BLOCKER-SYNTHESIS: one ranking across the nine blocker dossiers

*research/jit-20261008/BLOCKER-SYNTHESIS.md · 2026-10-09*

**Status: revised after critique (BLOCKER-SYNTHESIS-CRITIQUE.md).** The first version is commit db12bd0 and the critique is
commit ea6d36c. §8 maps each must-fix item (M1–M10) and each missing item to the change made here. Every critique item was
checked against the file and line it cites before it was accepted.

**What this is.** The `blocker-dossiers` workflow (wf_da253fe6-f97) wrote nine cluster dossiers on blockers B1–B18, then the
cloud session ran out of usage before the workflow's synthesis and critique steps. This document is the synthesis, written by
hand from the exported agent results. It:
- lists the step-0 prerequisites and ranks every dossier experiment in one list (§2);
- records where dossiers disagree with each other or with the repo (§3);
- maps the experiments to HANDOFF §5 and proposes a revised order (§4);
- names the mechanisms that recur across blockers (§5);
- lists claims that should not be repeated as fact, with errata (§6);
- asks the owner six questions (§7).

No model calls, runs, web fetches or commits were made for it.

**Notation.**
- **"dossier N"** is agent result N of `handoff/workflows/wf_da253fe6-f97.md` (table below). "Dossier 5 N3" is measurement N3
  in dossier 5. "Dossier 1 §B2.1" is dossier 1, blocker B2, section 1.
- **"DEV-NOTES Dn"** is an entry in [DEV-NOTES.md](DEV-NOTES.md).
- **"THESIS Dn"** is an owner decision in `docs/THESIS.md` §10.
- **"FG"** is [FRONTIER-GAPS.md](FRONTIER-GAPS.md).
- A bare "Dn" is not used anywhere in this document.
- **"Bn"** is blocker n in the workflow's numbering. **"Row n"** is rank n in the §2 table, and **"S0-n"** is step-0 item n (§2.0).

**Sources.**
- `handoff/workflows/wf_da253fe6-f97.md`, agent results 1–9.
- FG §0.1–0.4 (including the §0.4 correction) and §4.1–4.4; [HANDOFF.md](HANDOFF.md) §2, §3, §5; DEV-NOTES D1–D12;
  [THESIS-JIT.md](THESIS-JIT.md) §6; [CALIBRATION.md](CALIBRATION.md); [PREREG-stream.md](PREREG-stream.md);
  [BLOCKER-SYNTHESIS-CRITIQUE.md](BLOCKER-SYNTHESIS-CRITIQUE.md).
- Spot checks against committed files:
  - [nversion-records-dev.json](nversion-records-dev.json) and `tierdown/live-rules-{haiku,sonnet}.{json,md}`;
  - `experiments/jit/{report,stream,compare,acceptance,check-traces,durability,router,prompts}.mjs` and
    `experiments/jit/configs/dev-*.json`;
  - `beds/kinetics/README.md`, `beds/synth/AUDIT.md`;
  - `experiments/kev-data/README.md`, `experiments/kev-data/lib/registry.mjs`;
  - the static C0 records solver in `research/construction-20261006/artifacts/`;
  - the Jev commits 4517c4a, 38f74fd and 3816d88, and `research/judge-20261009/data/`.

| dossier | blockers | topic |
|---|---|---|
| 1 | B2, B9 | diversity and statistics: common-mode failures; lineage variance and small-K validity |
| 2 | B1, B7 | decision verification: silent near-threshold misses; answer equivalence without an oracle |
| 3 | B3, B17 | teachers and labels: weak-demonstrator trap; human adjudication of unresolved cases |
| 4 | B4, B11 | domain of validity: a heal widened the domain (DEV-NOTES D9); applicability gating for reuse |
| 5 | B6, B8 | semantics and acceptance: kinetics compile failures and the composer question; acceptance without ground truth |
| 6 | B5, B15, B16 | cascade economics: tiering a high-leverage judge (DEV-NOTES D11); Kev from traces; router and slider |
| 7 | B14, B18 | discovery and meta: replicating hand-built workflows; a compiler that improves itself |
| 8 | B12, B13 | composition and control: guarded sub-modules; interactive environments |
| 9 | B10, B10b | throughput: the usage quota; scheduling on the 4-vCPU VM |

**Blocker numbering.** B1–B18 is the workflow's own numbering, fixed by the dossier titles above. FG has no B1–B18 list. Its
§2 table B uses B1–B4 for four different gaps, and dossier 4 notes the collision. In this document Bn always means the
dossier numbering.

**What changed since the dossiers were written.**
- **Lost with the cloud container:**
  - the stream run data and model-call journals of `jit-dev-records-1` and `jit-dev-kinetics-1`: every compiled `solve.mjs`,
    trace, BUILD-NOTES, `compile.json`, `events.jsonl`, `results.jsonl` and `journal.sqlite`;
  - all Kev held-out, calib-OOD and OOD material and pools;
  - the wave-A built datasets.
- **Survives:**
  - the numbers written into DEV-NOTES, HANDOFF §2, FG §0 and CALIBRATION;
  - `nversion-records-dev.json`: 4 compiled records solvers × 24 dev tasks, with status, pass, score, cost and a
    distinct-answer count per task, but no answers;
  - the tier-down summaries;
  - the static C0 records and codefix solvers;
  - the bed generators and dev configs, so every dev task input regenerates;
  - the R-bench pilot items, the recovered corpus, and the three Kev J1 dev-select files.
- **So:** any dossier experiment that says "$0 replay", "archived shadow pairs", "archived traces" or "re-analyse dev journals"
  now needs a fresh dev run first. That run costs the owner's own Claude usage, and its outputs will differ.
- **The engine changed.**
  - Commit 2f9862a changed `src/` (sandbox portability), so the frozen construction-kit hash changed.
  - Commit 38f74fd added Jev to `policy/models.json` and `src/models/policy.mjs`. The owner policy hash went
    `8069fa33b93bc0e8 → cfe79728f185334b`, and the heal kit's policyDrift gate now reports blocking drift.
  - Any run from here is on a different engine from the lost dev runs.
- **Jev replaces Kev for the judge program** (owner direction 2026-10-09, recorded by 38f74fd).
  - The stock Jev J1 read of the three surviving dev-select files is done and committed: raw rows in 4517c4a; baselines, a
    Haiku arm and the analysis in 3816d88.
  - Kev J2 training is parked. §2.4 has the details.

**Evidence class.** Everything below is development evidence: dev seeds, K=1 streams, K_c=1 compiles, and a K=1 Jev read.
Nothing is claim-bearing. "Supported" means supported by dev evidence.

**Rules in force for every item below.**
- No new Workflow fan-outs; everything runs as a plain script or CLI call.
- Never read sealed beds (`beds/sealed/`).
- Held-out JIT seeds are ≥ 7001 only; 5001–5006 and 6001–6004 are burned. This document proposes 8001–8024 and 8101–8124,
  which sit inside that rule (C2).
- Preregister before any comparative claim. No K=1 claims. Gaps under 3 points are noise. Keep negative results.
- Heal proposal `p-a3336190-r4` is untouched by anything here. Credentials come only from env vars.

---

## 1. Spot checks behind this document

Every repo number carried into §2–§5 was checked against DEV-NOTES, HANDOFF, FG or a committed file. The critique re-ran these
checks and they reproduced (critique V22–V24). Where a dossier number disagrees with the repo, §6.1 lists it.

**From `nversion-records-dev.json`:**
- 67 answers in all, 24 of them wrong. This matches DEV-NOTES D8's "43 of 67" correct.
- `opusV2` and `sonnetV1` both answered 20 tasks. They were wrong on 5 and 4 respectively, and on 3 together, where
  independence predicts 1.0 (one-sided Fisher p ≈ 0.032).
- `opusV1` and its child `opusV2` were wrong together on 2 tasks against 0.67 expected, with identical scores (s212 0.723,
  s214 0.892).
- `opusV1` refused 15 tasks. Its child `opusV2` answered all 15: 8 right and 7 wrong (6 of 7 right on d3, 2 of 8 on d4).
- `opusV1`'s two consecutive d3 deopts were s205 and s206. These are the traces that drove O/H v2's recompile (DEV-NOTES D3;
  FG P9 lists O/H trace and deopt-trace seeds 205, 206 and 217). `opusV2` passes both.
- On d4:
  - `sonnetV1` refused s217, s218, s220 and s222;
  - `haikuV1` refused the same four plus s224;
  - `opusV1` refused all 8.
- 7 tasks were unanimous, and 6 of them were correct.

**Statistics and tier-down:**
- The Wilson 95% interval for 22/24 is 74–98%. An exact McNemar test on a 5/1 split gives p = 0.22; the split itself can no
  longer be checked.
- Tier-down: Haiku 5/8 against 7/8 once s204's deopt is counted; Sonnet 3/8. Per-task run cost: $0.0062 (Haiku), $0.0241
  (Sonnet), $0.0386 (Opus).

**Dev configs.** `configs/dev-records-1.json` and `dev-kinetics-1.json` set `jit.compare: 'unordered'`, `maxFallbacks: 2` and
`spendStopUsd: 40`. They set no `promptVersion`, `compile.acceptance`, `preserveRefusals` or `shadowOnFlags`. So the dev
streams ran:
- the v1–v3 prompt text;
- named acceptance;
- periodic shadows only.

Kinetics dev had no Opus agent arm.

**Code:**
- `report.mjs:10` sets `NOISE_SUCCESSES = 3` and compares task counts.
- `stream.mjs` does not import `router.mjs`.
- `acceptance.mjs:45` matches case ids with the literal, case-sensitive pattern `\b<id>\b`. This is deliberate and tested
  (`acceptance.test.mjs:46`).
- Under tolerant comparison, a within-band difference counts as `exact` (`check-traces.mjs:161`), so it needs no note.
- Adoption records `accepted` but does not require it (`stream.mjs:554`).
- The v2.2 check replays only the refusal traces in the pool (`stream.mjs:181, 518–522`).
- `durability.mjs:19–20`: the silent-miss rate is oracle-scored, the experimenter's view.

**Seeds:**
- Kev's registry reserves test seeds 7000–7039 and 7040–7199 **for every bed** (`experiments/kev-data/lib/registry.mjs:2–13`;
  `README.md:31, 232, 307`).
- These are reservations only. The records factory yields nothing in them (`test/records.test.mjs:148–149`), and their two
  consumers were never built.
- Synth test seeds 7000–7099 were generated and scored once (`beds/synth/AUDIT.md:15, 26, 134`).
- `stream.mjs:80` enforces only "≥ 7001".

**Other:**
- Shareable interpreter spend (dossier 9 §B10.1): O/H $5.16, which matches DEV-NOTES D12's interpreter + shadows +
  adjudicator total of $5.15; S/H $3.27, which equals DEV-NOTES D10's $1.46 + $1.81.
- `beds/kinetics/README.md`:
  - pass needs every Vmax and Km within 10% of truth, and an exact exclusion set;
  - the reference fit is within 5% and a replicate-mean fit within 8%;
  - conditions differ by at least 30%.
- The ±10% rule is also stated in the task prompt (`beds/kinetics/render.mjs:891`).

---

## 2. Step 0, and a cross-blocker ranking of experiments

### 2.0 Step 0: prerequisites before any model-call spend

These are engineering tasks, not experiments, so they are not ranked. All are $0. R0 (row 8) should not start until they are
done, because each one either protects R0's output or decides what R0 can be used for.

| id | task | why before R0 | source |
|---|---|---|---|
| S0-1 | **Persistence.** Persist per-run outputs, flow events, flags and check reasons. Persist journals as JSONL, or as release assets with a sha256 manifest; binary SQLite in git conflicts with ROADMAP §6 rule 6. Verify the push with `git ls-files`, and stop `snapshot.sh` swallowing errors (`2>/dev/null`) | The dev run data was lost here | FG P1 items 1–2; critique S0 |
| S0-2 | **Override hook and a salt-free memo port in `flow-v2.mjs`**, plus FG P1's coverage check (replay one task; if coverage is under 90%, "$0 replays" become capped live re-runs) | Rows 14 and 27 replay R0's solvers with other judges held fixed. That is possible only if the hook exists before R0 compiles | critique V18; dossier 6 X5-2; FG P1 items 3–4 |
| S0-3 | **Laptop isolation probe.** Re-run FG §0.4's $0 cross-arm probe (real `maskSteps`, `sandboxScript`, `UNSHARE_ARGS`) on the laptop. Classify the hidden-path attempts in R0's compile records | The §0.4 refutation was measured on the cloud host; before 2f9862a the laptop sandbox exposed `/home/raed` | critique C7; FG P2 item 4 |
| S0-4 | **Engine freeze record.** Record the commit, construction-kit hash and policy hash that R0, R0-K and the held-out run will share. Requires the owner's heal-kit policyDrift decision (Q6) | ROADMAP §6 rule 13 and §4.3: no comparative run on a changing engine. 2f9862a and 38f74fd both changed the engine | critique missing item 6 |
| S0-5 | **Per-(bed, split) seed ledger,** checked by both `stream.mjs` and `kev-data/lib/registry.mjs`. It records Kev's reserves, synth test 7000–7099 as used, dev 225–248 and 249–272 as fresh, and the held-out 8001–8024 / 8101–8124 | Stops an accidental run in Kev's range (`stream.mjs:80` checks only ≥ 7001) and fixes which seeds R0 may use | FG P2 items 1–3; critique M1 |
| S0-6 | **Acceptance hardening, about 1 h** (formerly rank 2; dossier 5 E6.1 part a, dossier 5 option 1 for B8). Options: a case-insensitive id match, an id-range parser ("Trace-0, 2, 4"), or a structured `verdicts.json`. Add a test of the §3 path (a tolerant within-band diff produces no diff case). Check the strict rule "shared text explains no case" (`acceptance.mjs:20–21, 116`), which can reject a disagreement argued only from SOP boilerplate. **Decide the adoption rule with it:** may a version with `accepted: false` be adopted (`stream.mjs:554`)? Without that rule, acceptance only steers fallbacks | Removes a wording failure from the strict gate before R0 uses it. It is hardening, not a test of B6 (§2.2) | critique M2, V6, missing item 5 |
| S0-7 | **Host-load fields** (in-flight count, CPU load) on every result row | The only way to audit contention (row 48) on future runs | dossier 9 B10b-E1 |

**Adoption rule (S0-6).** Dossier 5 N4 found that acceptance did not predict success, but at n = 17. This synthesis leans
towards leaving adoption as it is until row 11 measures predictiveness on R0 and R0-K. Whatever is chosen should be written
into the PREREG explicitly.

### 2.1 The ranked table

**Ids.** Each id is the blocker plus the dossier's own experiment number:
- E2-k → B2-Ek and E9-k → B9-Ek;
- E1–E3 → B1-E1..E3, and E4–E6 → B7-E4..E6;
- E-B3-k → B3-Ek and E-B17-k → B17-Ek;
- X-B4-k → B4-Ek and X-B11-k → B11-Ek;
- E6.k → B6-Ek and E8.k → B8-Ek;
- X5-k → B5-Ek, X15-k → B15-Ek and X16-k → B16-Ek;
- E14-k → B14-Ek, E18-k → B18-Ek, E12-k → B12-Ek and E13-k → B13-Ek;
- QEk → B10-Ek and CEk → B10b-Ek.

R0, R0-K and the Jev independence check are added by this synthesis. Where two dossiers propose the same experiment, the rows
are merged and both are cited.

**Cost classes.**
- **$0:** offline, no model calls.
- **Haiku-cents:** under about $5.
- **Opus-dollars:** about $5 or more, or Opus-heavy.
- **GPU:** laptop time, no usage.
- **Jev:** TypeSafe credit; the price is second-hand and unverified (§2.4).

Every Claude call spends the owner's own usage. Dollar figures are list-price estimates.

**Runnable now?**
- **yes:** nothing lost is needed.
- **partly:** a substitute exists now; the full version needs something below.
- **after X:** waits for row or step X.
- **needs owner** or **needs PREREG:** as stated in the row.

| # | id | experiment | moves | cost | runnable now? | evidence it would produce |
|---|---|---|---|---|---|---|
| 1 | B9-E1 (instrument part) + dossier 9 §B10.1 | Keep the owner's 3-point floor (HANDOFF §0; ROADMAP:889). Add an exact McNemar test and a lineage-clustered CI. Report an effect only if it clears the floor and the test and holds in both streams. Report task and point units side by side (`report.mjs:10` counts tasks, PREREG §4 counts points). Reconcile PREREG §8 (one fixed order) with ROADMAP §4.3 (≥ 3 random orders), or declare the deviation. Power table on lineages. Define the 25% env-fault rule (fault events or unresolved faults) | B9, B10, B2; every comparative claim | $0 | yes | A frozen analysis section. "Directional, no decision" by rule when K is too small |
| 2 | B7-E4 + B8-E1 (gauge half) + HANDOFF §3 relTol | Kinetics comparator gauge study. **Stage B (the evidence):** two Haiku-agent sessions per kinetics dev seed 201–224 (seeds already seen). Measure the spread between correct answers and the overlap with wrong ones, at relTol 0.001–0.05 with set-exact exclusions. **Stage A (sanity check):** correct–correct pairs from two fitters written from the SOP, and correct–wrong pairs from the bed's 8 plausible-but-wrong controls (of its 10 known-bad controls, `beds/kinetics/index.mjs:171–251`). Most controls differ by ≥ 15% or by the exclusion set, so Stage A alone cannot set the value | B7, B8, B6, B2, B1 | A: $0. B: Haiku-cents (~$3–4) | A: yes. B: needs `CLAUDE_CODE_OAUTH_TOKEN` (sandboxed agent sessions). Freezing the value needs O1 or the README-precision fallback (Q4) | The kinetics relTol to freeze, with its false-disagreement and false-agreement rates. Replaces the lost "archived shadow pairs" |
| 3 | B5-E1 + B15-E1 | Consequence gate for global reads. **Stage 1:** re-derive dossier 6 N3's date-order data check on regenerated records dev inputs, scored on generator labels. Score it on 201–224 and out of sample on fresh 249–272. The check was designed with the three 201–224 errors known, and 225–248 stay untouched for R0. **Stage 2:** Haiku k=3 and Sonnet k=1 reads from a re-authored `rules` prompt; a gate at data margin ≥ 2; a completeness assertion for void markers; a Dawid–Skene label model over the same calls | B5, B15, B16, B1, B3 | Stage 1: $0. Stage 2: Haiku-cents (~$1) + ~$0.034 per Opus escalation | Stage 1: yes. Stage 2: after the `rules` prompt is re-authored (the S/H v1 judge is lost; the static C0 solver's config judge is a start). A Jev tier is analyst-side only (§2.4) | Undetected wrong global-read leaves, gated against ungated, in and out of sample; escalation rate; label-model accuracy against Opus as the label |
| 4 | B1-E3 (dossier 2 E3; moved up) | Double-entry entity count. Compute an independent entity count from a DOB+phone blocking estimator and a looser union-find, and log the reconciliation gap per run (AUROC for oracle failure; kill if under 0.7). Score it on the static C0 records solver's outputs on regenerated 201–224. C0 went 16/24 in the dev stream (DEV-NOTES D5), so expect about 8 wrong. Pool with JIT outputs after R0. The dossier's "17 compiled deliveries" (S/H) would give 2 positives, a degenerate AUROC | B1, B7, B12 | count: $0. C0 outputs: Haiku-cents (~$1.2 for 24 tasks; C0 also calls Sonnet or Opus once per task) | yes | Whether a $0 reconciliation gap flags the DEV-NOTES D1 under-merging class |
| 5 | B2-E3 + B17-E3 + B16-E2 (offline part; re-scoped) | Verification-policy simulator on `nversion-records-dev.json` (4 solvers × 24 tasks, the Opus agent's 24/24 as reference). Compare dispute-only adjudication against an ε-random floor with IPW, and every-4th shadows against Z1.4 switching. It now sizes ε for **system-view (oracle-free) estimates only**. With a perfect reference and n = 24 it is close to a power calculation | B2, B17, B16, B9 | $0 | yes | The ε that gives usable CIs on system-view durability, router training rows and self-reported miss rates. Input to the floor decision (C10) |
| 6 | B10-E2 | Meter capture. Read 5-hour and 7-day utilisation from `stream-json` events, probe with Haiku every 10 minutes, and fit a quota weight per model and token class. Runs in parallel with the rest; **not an R0 gate** | B10, B10b | Haiku-cents ($1–3) | yes | Whether this account's `claude -p` exposes the meter; quota weights by model; a price in owner usage for every row below |
| 7 | B4-E1 + B18-E1 (re-scoped) | Recompile non-regression audit for the DEV-NOTES D9 class: an AST deletion and widening diff of guards, invariants and checks from parent to child, plus backward transfer on old cases. **Testbed:** hand-made guard-deletion and guard-widening mutants of the static C0 records solver, with behaviour-preserving refactors as the negatives. It also records why v2.2 is not this check (C13) | B4, B18, B11, B2 | $0 | yes | Whether a deletion diff or a runtime-owned domain artifact catches the mutants that refusal replay cannot (kill if it flags ≥ 50% of behaviour-preserving refactors) |
| 8 | **R0** (added; FG P1, HANDOFF §5.2; scoped by critique M5) | **One job: a dev rehearsal of the HANDOFF §3 config, end to end,** on fresh records dev seeds 225–248 (16 d3 + 8 d4; reserved by FG §4.1 and never used to tune v2.x). Arms: JIT S/H, O/H and H/H, the Haiku agent, and the static C0 arm. Step 0 is on. **Not a second lineage of the lost runs, and not paired with them:** both config and engine differ | about 15 rows; FG §4.1 capability numbers | Opus-dollars. About $24 at dev rates: S/H 8.99, O/H 7.53, H/H 4.09 (scaled to 24 tasks), Haiku agent 2.46, static 1.21. **Expect $25–40 under §3**, which adds flag-triggered shadows at ~$0.6–1.2 each (FG S5) and strict-acceptance fallbacks. Per-arm caps; `spendStopUsd` 40 | needs owner (Q2), `CLAUDE_CODE_OAUTH_TOKEN` and step 0 | Whether the §3 config runs clean end to end; capability numbers on untuned seeds; persisted solvers, traces and journals that make later replays $0 |
| 9 | **R0-K** (added; critique M10) | Kinetics dev run under the §3 config with row 2's relTol, **O/H first,** on fresh kinetics dev seeds 225–248 (16 d4 + 8 d5). O/H yields Haiku compile attempts and Opus fallbacks, and it was the only kinetics arm ahead of the agents (15/17, FG §0.1). Add H/H only if row 10 has too few attempts per builder (dossier 5 expects about 5) | B6, B8, B7; HANDOFF §5.4; the PREREG's second family | Opus-dollars (about $25 for 24 tasks at FG §0.1's $17.82 per 17) | after row 2 Stage B and step 0; needs owner (Q3) | The inputs for rows 10, 11, 24, 36 and 37; a rehearsal of the kinetics half of the §3 config |
| 10 | B6-E1 (decision part; dossier 5 E6.1) | Re-accept every kinetics compile attempt in R0-K, rejected ones included, under the corrected instrument (tolerant comparison and hardened acceptance). Compare Haiku-built and Opus-built acceptance and outcomes. Dossier 5's rule: if Haiku stays below Opus by ≥ 2 of about 5 attempts, the gap is real semantics (go to row 24); otherwise B6 is withdrawn as an artefact | B6, B8 | $0 after R0-K | after R0-K | Whether "Haiku cannot compile kinetics" survives a fixed instrument. This is the input to the composer question. If B6 is withdrawn, keep dossier 5 N1's raw rejection counts as a negative result |
| 11 | B8-E1 (predictiveness half; dossier 5 E8.1) = FG P3(b) | Score every compile event in R0 and R0-K under four acceptance rules (current, tolerant exact-rate, proficiency z-rule, leave-one-trace-out). Compare each against oracle pass on that version's next ≤ 8 compiled deliveries. Kill if no rule reaches AUC 0.7 | B8, B18, B4 | $0 after R0 and R0-K | after R0 and R0-K | Whether any acceptance rule predicts compiled success; evidence for S0-6's adoption decision |
| 12 | B3-E2 | Ruled demonstrator: the Opus `rules` reading is prepended to the Haiku interpreter's prompt as binding rulings. Plain against ruled, dev 201–216 × K=2 | B3, B5, B17, B6 | Haiku-cents + Opus-dollars (~$7) | after row 3's prompt; the dev decision rule is written first | Whether Haiku's systematic trace errors are law-class (sign, date order, void) |
| 13 | B1-E1 (HANDOFF §5.3) | Decision ledger: log the margin of every identity decision, define the band as margin ≤ m, and send batched "which of these candidates, if any" questions to Opus. Overlaps FG P8 (field-local cross-tier adjudication, ~$1–3) | B1, B7, B17, B15 | $0 + ≤ $3 Opus | partly: on the static C0 solver now; JIT after R0. The ledger is new `flow` code, so it enters the frozen config only by amendment | Share of misses inside the band; band size per task; narrow-adjudication accuracy (kill if > 25 pairs per task or < 90%) |
| 14 | B5-E2 (HANDOFF §5.6, #42) | Morris one-at-a-time leverage screen, with every other judge replayed from the journal. Also reruns DEV-NOTES D11 without re-sampling the other judges | B5, B15, B16, B12 | $0 after R0 | after R0, with S0-2 in place before R0 compiles | Leverage per decision unit; an FMEA action-priority table; the true size of the DEV-NOTES D11 effect (C3) |
| 15 | B11-E1 (HANDOFF §5.7) | Reuse confusion matrix over 5 gates (shapeKey, profile, profile without size, + concepts, + contract diff) and 3 borrowers (records d2, records d5, kinetics d4) | B11, B4 | Haiku-cents ($1–3) | partly: the static C0 records solver can be the lender now; JIT lenders after R0. Write a short PREREG-reuse-dev note first | Correct, wrong and missed reuse per gate |
| 16 | B18-E2 | Metamorphic (EMI) compile stability: 3 variants plus 2 identical-input recompiles per trace set, 15 Haiku compiles, scored on 16 dev tasks | B9, B2, B18 | Haiku-cents to Opus-dollars ($12–25) | after R0 (trace sets) | Compile-noise SD against trace-content SD, the most direct input to B9's ρ; whether disagreement between twins predicts failures |
| 17 | B14-E1 (HANDOFF §5.8 prep) | Conformance evaluator: effect-log alignment (fitness and precision) against the 5 pilots' hand-built oracles, on burned dev seeds 0–27 | B14, B18, B7 | $0 | yes (the pilot items are committed) | Whether generic conformance sorts the 18 + 11 + 5 known design classes at least as well as oracle v1 |
| 18 | **Jev independence check** (added; critique J3) | Error correlation of stock Jev with Haiku, Sonnet and Opus reads on generator-labelled J1 items: are Jev's errors independent of Claude's? Use the committed Jev rows; add Claude reads on a stratified subset. Draw from all three groups and oversample the ports with negative results (interactive X6, runbook X4, kinetics X3) | B2, B17, B5 | Haiku-cents to a few Opus-dollars (estimate) | yes (Jev rows in 4517c4a; Claude reads spend owner usage) | Whether Jev can serve as a non-Claude voter. Required before any such use (§2.4) |
| 19 | B15-E2 (re-scoped) | Novel-form residual on **bed-rendered records notes** (dossier 6 N3 used them: 61 date sentences, 36 forms), not factory pools. The laptop rebuild is not byte-identical for interactive and runbook, and the paraphrase pools are lost (`research/judge-20261009/data/rebuild-check.json`), so a factory stream would understate novelty. Compare Jev and Haiku on novel against cached forms; stock Kev optional | B15, B5, B16 | Opus-dollars (~$1.5 for the read cache) + Haiku-cents + Jev | yes (records generator) | Novel-form rate by stream position (kill if < 5% after 50 tasks); Jev against Haiku on novel forms |
| 20 | B4-E2 | Profile ablation: evidence-scaled kNN coverage and concept features against the current profile. Thresholds are frozen on records and scored on kinetics | B4, B11, B16 | Haiku-cents (< $1) | partly: the records half now; the kinetics half after R0-K | Silent-miss recall at a fixed false-alarm rate with size features removed |
| 21 | B1-E2 | Records controls pack: an ITF fictitious person (3 rows, one typo class), Westgard rules, and a PBRTQC merge-ratio EWMA | B1, B7, B12 | $0 build; Haiku-cents (~$1.2 per 24-task C0 run) | partly: on the static C0 solver now (it can share row 4's run); JIT after R0 | In-situ recall per typo class |
| 22 | B12-E1 | Module-level N-version census: extract the helpers from each records solver and run each implementation on harvested module inputs | B12, B2, B1 | $0 | partly: a 2-version pilot on the two static C0 records solvers now; the full census after R0 | Whether known misses show module-level disagreement where whole-task N-version was unanimous |
| 23 | B10-E1 | Shared draws: the 2nd and 3rd agent draws per (task, model) become the JIT arms' shadow and adjudicator pool. Check request equivalence in `interpret.mjs` | B10, B9 | $0 | partly: the design and equivalence check now; the comparison after R0; needs a PREREG amendment | Replaceable interpreter spend (dossier upper bounds: 69% O/H, 36% S/H) |
| 24 | B6-E2 (HANDOFF §5.4) | Rulebook-first kinetics compile, 4 arms × K_c=3: Haiku with the current prompt; Haiku with rulebook and certified fitter; Opus with the current prompt; rulebook + deterministic `apply.mjs` + Haiku fact extractors | B6, B8, B3, B17, B12, B15 | Opus-dollars (~$40) | after R0-K, row 2 and row 10; fresh kinetics warmups; a dev prereg note. If row 10 withdraws B6, rescope or drop it | Whether explicit semantics let Haiku match Opus compiles; the answer to "train a small composer?" |
| 25 | B12-E2 | Behaviour-preserving refactor into `lib/{dates,phones,money,identity}.mjs`, then one DEV-NOTES D1 fix in `identity.mjs`, relinked into each solver | B12, B4, B1 | Haiku-cents ($3–8) | partly: on the static C0 solver now (its exact oracle is the old program); JIT after R0 | Collateral change from a one-module fix, against a whole recompile |
| 26 | B3-E1 | Teacher ledger: law errors against fact errors, compiler-override accuracy, an entrustment matrix | B3, B17 | $0 | after R0 (traces and BUILD-NOTES) | Whether stable Haiku errors are law-class (the ≥ 60% rule) |
| 27 | B9-E3 | Stream simulator over crossed version × task and interpreter × task tables, plus the expected sample size of a paired e-process | B9, B16, B10 | $0 | after R0; the simulator must reproduce R0's result within one task | Order and shadow-schedule variance; usage saved by an anytime-valid design (kill if < 25%) |
| 28 | B17-E1 | Certiorari queue with precedent propagation and a simulated human at error rates 0, 0.1 and 0.2 | B17, B3 | $0 | partly: a pilot on the nversion disagreements now; the full version after R0 | Cases fixed per ruling, against harm from over-broad precedent |
| 29 | B16-E1 (HANDOFF §5.9) | V-aware router replay: Beta posteriors and ski rental with λ, at V ∈ {0.1, 1, 10}, against v0 and every fixed arm (FG P3(d)) | B16 | $0 | partly: arm totals now; per-task replay after R0 | Regret of v1 against v0; whether routing adds anything at 24 tasks |
| 30 | B4-E3 | Live K=2 comparison of v2.2 and v2.1 on O/H records, with a deliberately over-strict check seeded in | B4, B18 | Opus-dollars ($15–30) | after a dev freeze note; R0's O/H run can be one arm | Whether v2.2 cuts d4 silent misses without over-refusing (kill if > 3 points lower on d3). C13 predicts it will not catch a widening |
| 31 | B2-E2 → B9-E2 (HANDOFF §5.5) | Forced against unforced diversity (4 + 4 compiles), then portfolio racing (M=3 lineages, R=3 orders) against one lineage | B2, B9, B18 | Opus-dollars ($20–35, then $40–70) | after R0 and row 16; dev prereg notes | Joint-wrong ratio, forced against unforced; between-replicate SD, portfolio against single lineage |
| 32 | B13-E1 | Gridquest handoff headroom: protocols P0–P4 with code stand-ins, 30 dev seeds × d3–d5 | B13, B12 | $0 | yes | Whether hold-and-resume in the same environment beats a restart (kill if within 3 points of P2) |
| 33 | B14-E3 | Corpus variant-family census by template lineage and graph edit distance | B14, B11 | $0 | yes | Families with ≥ 3 variants and shipped oracles (kill if < 10) |
| 34 | B8-E3 | Rulebook-conformance acceptance with manufactured canaries and mutants | B8, B6, B18 | Opus-dollars ($15–25) | after row 24; known-good and known-bad versions from R0 and R0-K | Mutant kill rate; false rejects of known-good versions |
| 35 | B14-E2 (HANDOFF §5.8) | Parallel-run JIT replication on the Galaxy and selenium items: the original is the interpreter, and shadows compare by conformance | B14, B18, B7 | Opus-dollars ($15–30) | needs owner sign-off under THESIS D10/D15 and a PREREG before test seeds | Time-to-durable; fidelity on fresh seeds |
| 36 | B6-E3 | Disagreement-triggered rulings: do kinetics misses sit on wells where lineages disagree? | B6, B8, B2 | $0, then live | after R0-K | Share of delivered misses on disputed wells |
| 37 | B7-E5 | Decision-first comparison: compare exclusion sets exactly, then refit both answers through one fitter written from the SOP | B7, B6 | $0–0.5 | partly: the fitter can be written now; answers come from row 2 Stage B or R0-K | Share of correct–correct disagreements that vanish after the shared refit |
| 38 | B11-E2 | Admission by bridging study (an SPRT over paired shadows), against a per-task gate only | B11, B16 | Opus-dollars ($8–15) | after row 15 | Wrong reuse per 100 tasks; admission cost |
| 39 | B11-E3 | Evidence-transfer compile: the borrower compiles from the lender's suites plus 2 of its own traces | B11, B12 | Haiku-cents to Opus-dollars ($5–10) | after row 38 | Pass rate and cost against as-is reuse |
| 40 | B3-E3 | H/H compile from ruled or masked traces, K_c=2 | B3 | Opus-dollars ($8–12) | conditional on row 12 | Whether the trap lives in the labels or in the compiler |
| 41 | B13-E2 | World-model compile against policy compile on gridquest (FG P12) | B13, B12 | Opus-dollars ($12–25) | needs the env port, flow-v3 and PREREG-env; seeds from the S0-5 ledger | One-step prediction accuracy; levels per $ |
| 42 | B10-E3 | Quota governor (token bucket, pacing curve, criticality classes, breaker, auto-resume), ABAB over four 5-hour windows | B10, B10b | $0 sim + Opus-dollars ($20–40) | the simulation needs new load data; the live part after row 6 | Tasks finished per 10 h; stall minutes; unchanged pass rates |
| 43 | B10b-E3 | Batched low-leverage judgments, B=1 against B=10 | B10b, B5 | Haiku-cents ($1–2) | after R0 | End-to-end pass rate; CPU and usage per task |
| 44 | B12-E3 | Blame accuracy on 20 single-module mutants (cf. FG P5) | B12, B13 | $0–1 | after row 25 | Detection and blame accuracy against whole-output invariants |
| 45 | B17-E2 | Owner calibration session: 16 field-local cards, 8 blind and 8 showing the system's answer | B17, B3 | $0 in models; about 30 min of owner time | needs owner, and cards built from R0 disputes | Owner accuracy; the automation-bias gap; owner–Opus α |
| 46 | B13-E3 | Gameqa: compile the replay and ddmin verifier | B13 | Haiku-cents ($5–10) | after a gameqa audit | Oracle-passing bugs per $; false reports |
| 47 | B2-E1 | Full coincidence audit over all records versions, with a β-ledger | B2, B9 | $0–4 | partly: the 4-version table is done (§1); the rest after R0 | Observed/expected joint failures per pair; β for dangerous undetected failures |
| 48 | B10b-E1 | Contention-confound audit | B10b | $0 | after S0-7 and R0 (the old load data is lost) | Odds ratio of failure at high concurrency |
| 49 | B10b-E2 | Jobserver against per-process semaphores | B10b | $0–cents | yes, but the 4-vCPU VM is gone; measure the laptop's concurrency knee first | Calls per second and p95 latency |
| 50 | B7-E6 | Order independence of adjudication | B7 | $0 | the archived triples are lost; a unit test of non-transitive majority-of-three replaces it | Whether check order changes outcomes |
| 51 | B8-E2 | Proficiency-style consensus acceptance | B8, B2 | $0–5 | after R0: the nversion JSON has pass, score and a distinct-answer count, but no answers. Its known-wrong count is 24 of 67 answers | Recall of known wrong outputs at a given Opus budget |
| 52 | B18-E3 | Lexicase population of compiler variants on a held-out third family | B18, B9 | Opus-dollars ($60–120) | after rows 7, 16 and 35; needs PREREG | Held-out success against the latest-version compiler |

### 2.2 Ranking rationale

**Instruments come first (rows 1 and 2).**
- **Row 1.** A fixed threshold is not a test. The defect is not the unit: `report.mjs` counts tasks while PREREG-stream counts
  points, but 22 vs 18 clears either rule. The defect is that neither rule is a test. Keeping the owner's 3-point floor and
  adding McNemar and a clustered CI costs nothing, and it decides how every later comparison is read.
- **Row 2.** The kinetics tolerance HANDOFF §3 proposes (0.005 / 0.01 / 0.02) has no data behind it now, because the archived
  shadow pairs it was to be calibrated on are lost. Stage B's agent answers are the evidence. Stage A only checks that the
  comparator separates the bed's known-bad controls, which any relTol ≤ 0.05 plus set-exact exclusions already does.

**Cheap tests of strong prior evidence come next (rows 3, 4, 5, 7).**
- **Row 3, stage 1.** Dossier 6 measured that the data decided 25 of 26 d3 date-order leaves, all in agreement with Opus, and
  caught all three observed cheap-tier date errors. That check was designed with those errors known, so it is scored again on
  seeds it has not seen.
- **Row 4** targets the DEV-NOTES D1 under-merging class directly, at $0 plus about $1.2 to regenerate C0 outputs.
- **Row 5** is re-scoped (C10). The PREREG's silent-miss rate is oracle-scored and cannot be biased by the shadow schedule.
  The floor matters for oracle-free numbers.
- **Row 7** targets the DEV-NOTES D9 class with the right check. v2.2's refusal replay most likely would have accepted the
  DEV-NOTES D9 heal (C13).

**Row 6 runs in parallel.** It prices usage but gates nothing.

**Step 0 comes before any model-call spend.** Each item either protects R0's output or decides what R0 can be used for.
Acceptance hardening (S0-6), ranked second in the first version, sits here now. Under the §3 config, tolerant comparison already
turns dossier 5 N3's ≤ 1e-5 differences into exact matches, and case-sensitive matching is a tested design choice. A false
reject only triggers the Opus fallback. So the fix is about an hour of hardening, not a test of B6.

**R0 (row 8) has one job: rehearse the config the PREREG will freeze.**
- The §3 combination has never run end to end. The dev streams ran unordered comparison, named acceptance and the v1–v3 prompt
  text (§1).
- R0 runs on fresh dev seeds 225–248. FG §4.1 reserved them for out-of-sample checks, so R0's pass rates also count as FG §4.1
  capability numbers.
- **R0 is not a second lineage of the lost runs.** Config and engine both differ (2f9862a, 38f74fd), and pairing the two would
  turn a cross-config K=1 pair into a comparative inference.
- Expect $25–40 under §3, with per-arm caps.

**R0-K (row 9) is priced and ranked here because everything kinetics depends on it.** The kinetics run data is lost too.
Dossier 5's two premise tests (rows 10 and 11), the rulebook gate (row 24), rows 36–37, and the PREREG's second family all need
it. It runs after row 2's Stage B, so it uses a measured tolerance.

**Rows 10 and 11 restore dossier 5's dropped experiments.** They are $0 once R0 and R0-K exist. Only re-accepting real kinetics
compile attempts tests B6; the S0-6 regex fix does not.

**Rows 12–23** are cheap live experiments, or $0 replays once R0 exists, ordered by blockers moved and HANDOFF §5 steps served.
- Decision-level verification (row 13) and leverage (row 14) each serve a §5 step and four blockers. Both need new `flow` code,
  so they run alongside the freeze and enter the config by amendment (§4.1).
- B18-E2 (row 16) goes before portfolios (row 31). If identical-input recompiles barely differ, the $60–105 portfolio pair has
  little to work with.
- The Jev independence check (row 18) comes before any use of Jev as a voter (§2.4).

**Rows 24–31** are the Opus-dollar experiments, ordered by information per dollar. Rulebook-first (row 24) answers the owner's
composer question and moves six blockers, but it waits on row 10, which may withdraw B6. Portfolios come last in this group:
the dossiers disagree on what diversity buys (C9), and cheaper rows can kill them.

**Rows 32–52** fall into two groups:
- $0 items that serve no HANDOFF §5 step (gridquest, the corpus census). They rank low despite their price.
- Items that depend on earlier rows, owner sign-off or data that must be regenerated.

**Caveat on every post-R0 row.** R0's solvers will be different programs on different seeds. The specific failures many dossier
experiments are keyed to may not recur: the s214 under-merge, the s208 BRIGHTDESK date order, and the DEV-NOTES D9 widening.
Where an experiment needs a known failure, there are two options:
- define its target as "whatever R0's solvers get wrong", frozen before scoring;
- or use the static C0 records solver as a fixed testbed. It passed 2 of 8 d4 tasks in the dev stream, which means 6 silent
  d4 failures (DEV-NOTES D5).

### 2.3 What the held-out run is not

The held-out stream (HANDOFF §5.2) is the claim, not an experiment, so it is not in the table. §4.1 step 4 lists what must be
true before it is frozen.

### 2.4 Jev: what the owner's direction changes

**State, from committed sources only.**
- **Direction.** Hosted Jev replaces Kev for the judge program, billed to the owner's TypeSafe account (38f74fd; the
  `policy/models.json` note).
- **Policy.**
  - `judgmentModels` lists `jev-latest` on provider `typesafe-systemone` (systemone-http), with `credentialEnv`
    `FOUNDRY_SYSTEMONE_API_KEY` (a variable name, never a value).
  - Judgment models never enter a ModelPort: ModelPort and class resolution read `models[]` only (38f74fd).
- **J1 Jev read: done** (4517c4a).
  - Every response reported `jev-1.13.0`.
  - 1,176 requests: 10 smoke, 1,106 J1 and 60 re-reads. 0 faults.
  - Re-reads: 0 argmax flips, and max |Δp| 0.03 / 0.07 / 0.06 (runbook / kinetics / interactive). So the unchanged validity
    rule (every |Δp| < 0.01) marks each run invalid.
- **J1 analysis** (3816d88; `research/judge-20261009/data/analysis/j1-jev-dev-tables.md`). Diagnostic only: dev data, K=1. The
  negative results to keep:
  - A $0 train-fitted bag-of-words probe beats stock Jev in-family on kinetics X3 (bacc 0.930 against 0.609) and X4 (0.979
    against 0.742); the paired CIs exclude 0.
  - Interactive X6 and runbook X4 have Brier skill below a uniform guess (−0.022 and −0.092).
  - The 38-item Jev-vs-Haiku check (Δacc −0.132 [−0.270, 0.000]) is not a comparison.
  - The write-up, `research/judge-20261009/J1-JEV-DEV.md`, was still being written at this revision.
- **Kev J2 training is parked.** Reopen it only if TypeSafe offers fine-tuning or the owner reverses the direction. J2 is being
  redrafted as a Jev preregistration (not committed at this revision). It still needs the re-authored held-out and calib-OOD
  material.
- **Promotion rule** (ROADMAP §2.4). A port gates real decisions only after its Jev engine beats the baseline on held-out
  labelled data. The critique (§6) proposes that the Kev-vs-Haiku 5.5 bar carry over to Jev, and this synthesis agrees.

**What each dossier item becomes.**

| dossier item | question | what Jev changes | what is lost or still needed |
|---|---|---|---|
| J1 (HANDOFF §5.6) | How good is an untrained judge on factory dev-select items? | Answered for stock Jev (above). A stock Kev-0.8B read of the same three files remains possible on the GPU at $0, as a comparison point, not a prerequisite | Calib-OOD, so no RISK or BSS against the calib prior |
| Kev J2 training | Does training on wave-A data help? | Parked. No Jev equivalent unless TypeSafe offers fine-tuning (Q5d) | The whole question |
| B15 (dossier 6) | Do trace-harvested labels suffice? | Becomes "do trace-harvested labels suffice to **calibrate** a Jev port?" Dossier 6's X15-1 label model is the source for ROADMAP §2.4's per-port calibration ledger | Volume: FG table F found that 695 judge calls reduce to 51 port-shaped questions, and `rules` yields none |
| B15-E2 (row 19) | Is there a novel-form workload a small judge can take? | Jev against Haiku on novel forms, on bed-rendered notes | Nothing about training |
| B5 (rows 3, 14) | Can a tier below Haiku carry a decision class? | Possible as one more cheap tier, but `flow.judge` tiers are Claude model ids through the gateway and Jev sits outside ModelPort. A Jev tier is **new routing code**, a new subsystem under ROADMAP §6 rule 12. Until a port passes §2.4, Jev stays analyst-side or shadow-only (logged, never acting). Dossier 6's point carries over: Jev verifies local facts, while global reads keep the strong tier plus consequence checks | A preregistered experiment that needs the routing |
| B16 (rows 5, 29) | Can the router estimate p(compiled ok)? | Jev could score a task's state for in-domain plausibility | Unbiasedness, which comes from random holdouts and reverse shadows, not from any judge |
| B2 option 4, B17 | Is there a source outside the Claude family? | **Unverified.** Jev's training data and base model are undocumented ("We don't know what Jev was trained on", `research/kev-20261007/01-kev-dossier.md:93–99`). Kev is Qwen-based, so it is also outside the Claude family. Measure first (row 18) | Owner intent rulings (B17) still need the owner |

**Conditions on any Jev use.**
- **Nondeterminism.** Re-reads move by up to 0.07. Any "$0 replay" that includes Jev must replay the journaled responses
  (`score-served.mjs --jev` keeps raw response bodies, and 4517c4a committed them); recomputing gives different numbers. Any Jev
  gate must be stated on Jev's 2-decimal output grid.
- **Price.** $0.042 per million input tokens is second-hand and unverified, and the output price is unknown
  (`policy/models.json`, `judgmentModels[0].price.source`).
- **Data.** Dev bed text is synthetic and Claude-written. Sending R-bench or owner text to TypeSafe is a separate owner
  decision (Q5b). The nearest existing decision is THESIS D10, which defaults to no third-party egress for executors.
- **Test name.** The policy notes name `tests/model-policy.test.mjs`. The file is `tests/models-policy.test.mjs`, and the first
  version of this synthesis repeated the wrong name.
- **Heal kit.** Adding Jev made the heal kit's policyDrift gate block (Q6).

### 2.5 Reconciliation with FG §4.2 (the P-plan)

FG §4.2 has its own plan, P1–P14. Where each item sits here:

| FG item | what | where it sits here | effect of the data loss |
|---|---|---|---|
| P1 | Persistence and replay | S0-1, S0-2 | Never done. Now a prerequisite |
| P2 | Seed ledger, integrity, isolation | S0-3, S0-5; C2, C7 | Never done. The held-out move to ≥ 8000 is kept (Q1) |
| P3 | $0 audit pack | (a) adjudication table: after R0; (b) = row 11; (c) check-removal diff = row 7; (d) router replay = row 29 | Inputs lost; after R0 or on C0 |
| P4a | Detector candidates, in sample | rows 4, 21 (C0 now), 13 | The archived outputs are lost. FG already labelled this contaminated (DEV-NOTES D1 names the misses) |
| P4b | Fresh-seed replay of archived versions on 225–248 | **Lost**: the archived versions are gone. R0 gives capability numbers for new versions on the same seeds, which is not the same test | — |
| P5 | Mutation scoring | rows 7, 44 | Archived passing outputs are lost; use C0 or R0 outputs |
| P6 | Bet A: compile as search | rows 16, 31 | After R0 |
| P7 | Executable acceptance v2.2 | S0-6, rows 7, 10, 11 | The past compile events are lost; replay R0 and R0-K events |
| P8 | Field-local cross-tier adjudication (~$1–3) | overlaps row 13 | The 9 archived disagreements are lost; after R0 |
| P9 | flow-v3 primitives (assume bands, consequence, k=3 global reads) | rows 3, 13; prompt v4 is already in §3 | New mechanism: adopt by amendment |
| P10 | PREREG amendment | §4.1 step 4 | — |
| P11 | Kev retarget plumbing | Overtaken. Port-shaped rows with generator labels now feed Jev calibration (§2.4) | — |
| P12 | Gridquest env port | row 41 | — |
| P13 | Bet B: population of families (~$40–50, then $80–130) | No dossier ranks it; rows 33 and 52 are adjacent. Owner choice, after R0 | — |
| P14 | Bet C: the agent as its own JIT (~$5–8) | No dossier covers it. FG paired it with the archived arms, which are lost; it would now pair with R0 on 225–248. Owner choice, after R0 | — |

**FG §4.1 capability rule.** Capability numbers come only from dev seeds the arm was not tuned on. R0 (records 225–248) and
R0-K (kinetics 225–248) satisfy it. Every 201–224 number stays diagnostic.

---

## 3. Conflicts between dossiers

Each row gives both sides, the repo evidence, and a verdict.

| # | topic | side A | side B | repo evidence | verdict |
|---|---|---|---|---|---|
| C1 | **Kinetics comparator tolerance** | Dossier 5 §0 N2, E6.1: correct fits agree to about 1e-5 (BUILD-NOTES), so use relTol 1e-3, with the tolerance taken from the prompt's grading rule | Dossier 2 §B7.1, E4: correct answers can differ by about 13% (the 5% and 8% generator bounds), and by up to 20% while both pass; gauge 0.01–0.20. HANDOFF §3: calibrate 0.005 / 0.01 / 0.02 on archived shadow pairs | The README bounds measure distance from truth, not between two careful fits of the same decisions. DEV-NOTES D7: independent correct fits "almost never agree to the last digit". `compare.mjs` caps relTol at 0.05 unless `allowLooseTolerance`. The shadow pairs are lost | **Unresolved; row 2 Stage B decides.** Both can be true: 1e-5 for the same decisions and method, more for independent agent fits. **Provenance:** DEV-NOTES D7 and FG §4.1 allow the bed README's stated precision as a threshold source, so the 5% and 8% bounds are usable. A dev-calibrated value needs O1; without it the fallback is the prompt's ±10% rule or the README's stated precision (Q4) |
| C2 | **Held-out seeds** | HANDOFF §5.2 and PREREG-stream §1: 7001–7024 and 7101–7124. Dossier 7 E18-3: "≥ 7001" | FG J1, P2, P10; dossiers 3, 4 and 8: ≥ 8000 from a global ledger | Kev's registry reserves test 7000–7039 and 7040–7199 **for every bed** (`registry.mjs:2–13`). These are reservations, not use: nothing in 7000–7199 has been generated or read for records or kinetics (`records.test.mjs:148–149`; the `realtrace-x8` and `e2e-harness` consumers were never built). Synth test 7000–7099 was generated and scored once (`beds/synth/AUDIT.md`). No code reserves or uses test seeds ≥ 7200 | **A registry reservation, not contamination.** The hazard is future and two-way: X8-real could read the JIT records worlds, or the JIT held-out run could burn Kev's reserve. **Clean range: test seeds ≥ 7200 for every bed.** Move to 8001–8024 / 8101–8124 per family as $0 insurance, recorded in the per-bed ledger (S0-5). This is a one-line PREREG edit, not a freeze gate (Q1) |
| C3 | **Size of the DEV-NOTES D11 tier-down effect** | Dossier 6 §0 N1: `tierdown-e2e` re-samples every other judge on the variant side; the attributable losses are Sonnet 3 (s209 was `vendex` noise) and Haiku 1 | DEV-NOTES D11: Haiku 5/8 against 7/8 (2 lost), Sonnet 3/8 (4 lost) | The committed Haiku JSON records s204's variant as a deopt, and dossier 6 itself diagnoses s204 as an ATLAS misread. Sonnet's s209 attribution rests on lost traces | **Haiku: DEV-NOTES D11** (2 lost). **Sonnet 3 against 4: unresolved.** The mechanism (a global, high-leverage read) holds either way. Row 14 settles the size |
| C4 | **"Kinetics never compiled well"** | Dossier 7 §B18.1: no kinetics compile exceeded 0.547 mean partial agreement over 11 attempts | Dossier 5 §0 N2, N3: 0.533 is 16/30 leaves, which a numerically identical solver scores under exact comparison | DEV-NOTES D7: exact comparison gives correct kinetics solvers 0 exact matches. FG §0.1 kinetics at 04:22: compiled answers O/H 9/10 correct, H/H 3/5, S/H 0/2. Dossier 5 tags N2 [inference] | **The partial-agreement ceiling is an artefact of the instrument; compiled kinetics quality still varies by arm.** Rows 10 and 11 test the rest. Kinetics compiling is still a dev cost negative (FG S7) |
| C5 | **Whether tolerant comparison exists** | Dossier 5 §B6.1: "has not landed (#36)" | HANDOFF §3: v2.1 is merged | `compare.mjs`, `check-traces --tolerant` and `jit.compare: 'tolerant'` are in the repo (5506c63, 14612a9). They are opt-in, and the dev configs ran `unordered` | **Stale at writing.** The point still applies to the dev runs and to any config that does not opt in |
| C6 | **How many compile records exist** | Dossier 7: 21 compile records (8 roots, 13 recompiles; $44.30). Dossier 8: 21 archived solvers, 10 of them records | Dossier 5: about 26 compile attempts (about 11 kinetics, 15 records). Dossier 1: 9 records versions | Data lost. Adopted versions against all attempts (including rejected ones) would explain the gap | **Unresolved, immaterial.** It matters only for dossier 5's composer threshold (≥ 300 validated compile records across ≥ 3 families), which is far off on any count |
| C7 | **Integrity of compile histories** | Dossier 7 §B18.1, option 4: `hiddenPathAttempts` is nonzero on 11 of 21 compile records (41 attempts), so these are "contaminated episodes" | FG §0.4 correction: the sandbox mounts a private tmpfs over the run root and `/root`, and the hidden-path scan over-approximates | The §0.4 probe refuted cross-arm reads **on the cloud host**. On the laptop before 2f9862a, the executor sandbox exposed `/home/raed`. Builder-session attempts were never classified (FG P2 item 4) | **Unresolved.** "Contaminated" is not established. Re-run the probe on the laptop (S0-3) and classify R0's attempts before using them as memory |
| C8 | **Which $0 analysis goes first** | Dossier 1: E2-1 → E9-1 → E2-3 → E9-3. Dossier 6: X5-2 replay first. Dossier 5: E6.1 + E8.1 | Dossier 7: E14-1 + E18-1. Dossier 8: E12-1 + E13-1 | All of these assumed the archived data | **Superseded** by §2. Rows that need no lost data move up; dossier 5's E6.1 and E8.1 come back as rows 10 and 11 after R0-K |
| C9 | **What to spend verification budget on** | Dossier 2 (B1) and dossier 6: verify decisions, with audits at probability ∝ leverage/margin, consequence checks, and narrow "select" questions | Dossier 1: forced-diversity portfolios and lineage racing (E2-2, E9-2). Dossier 8, option 4: N-version at module boundaries | DEV-NOTES D8 (11 of 13 disagreements contained a correct answer; s214 was unanimous and wrong) supports diversity as a *trigger*, not a vote. Dossier 1's falsifier rests on an unverified external claim (§6.4) | **Leans to decision-level verification first.** Both arms need R0. Dossier 1 option 2 (use variants to find decision points) is the bridge. Portfolios wait for row 16 |
| C10 | **The shadow policy in the PREREG** | HANDOFF §3: `shadowEvery` 4 plus `shadowOnFlags: true` | Dossiers 1, 2, 3 and 6: add a random-propensity floor, because dispute-only and flag-triggered shadows bias oracle-free rates | FG S2: shadows are periodic (every 4th compiled `ok` run), and only 4 of 21 known-wrong outputs were shadowed. But the PREREG's silent-miss rate is **oracle-scored** on every delivered answer (`durability.mjs:19–20`; PREREG §3), so the shadow schedule cannot bias it | **The dossiers are right for system-view (oracle-free) estimates only:** system-view durability, router training rows, any self-reported miss rate. The PREREG's oracle-scored outcomes need no floor. A floor changes arm behaviour and cost, so it is a config choice to freeze (sized by row 5), not an instrument defect |
| C11 | **When to train Kev** | Dossier 6 §B15: training waits on X15-2's kill rule; Kev should verify local facts, not decide global reads. Dossier 5: no small composer before ≥ 300 validated compile records | HANDOFF §5.6: Kev J2 on the laptop GPU once PREREG-J2 is frozen | Owner direction 2026-10-09 (38f74fd): Jev replaces Kev for the judge program | **Overtaken.** Kev J2 training is parked. Dossier 6's point survives in a new form: hosted Jev verifies local facts, while global reads keep the strong tier plus consequence checks (§2.4) |
| C12 | **Compile cost per build, for budgets** | Dossier 1 E2-2: $2–4 per compile | Dossier 7: Haiku records compiles $0.27–2.19 (`compile.json`) | DEV-NOTES D10: S/H compiles cost $4.83 over 3 attempts (v1 Haiku, the rejected v2 Haiku and the Opus fallback), including the builder's gateway test runs ($2.16) and the host check ($0.42). HANDOFF §2: Opus fallbacks $3–7 on kinetics | **Different scopes** (builder only against all-in). Budget all-in |
| C13 | **Does v2.2 prevent DEV-NOTES D9?** (added) | HANDOFF §3 presents v2.2 (`preserveRefusals` plus prompt v4) as the DEV-NOTES D9 fix. DEV-NOTES D9's consequence: replay every input on which the previous version deopted | Dossier 4: the fence lives in code the compiler rewrites, and one example stretches the profile | v2.2 replays only the refusal traces in the pool (`stream.mjs:181, 518–522`). At O/H v2's recompile, those were s205 and s206 (DEV-NOTES D3; §1), and `opusV2` passes both. The d4 inputs it later failed were never in the pool | **v2.2 most likely would have accepted the D9 heal.** It is necessary but not sufficient. The D9 class needs a deletion and widening diff, or a runtime-owned domain artifact (row 7; §5.1) |

---

## 4. Mapping to HANDOFF §5

| §5 step | experiments that serve it (§2 row) | what the dossiers and the critique argue | what the data loss does to it |
|---|---|---|---|
| 1. Finish the dev write-up | row 1 first; R0 and R0-K supply new inputs | Fix the noise-rule wording before printing comparisons. Add the errata in §6.1 | `report.mjs`, `durability.mjs` and `resume-streams.mjs` have no inputs. Write kinetics from FG §0.1 (04:22) and dossier 5's measurements, marked partial. Copy §6.2 into DEV-NOTES as a new entry D13, labelled "measured by a dossier agent on data since lost; not re-verifiable" |
| 2. Held-out stream PREREG | rows 1, 2, 5, 7, 8, 9; S0-4, S0-5, S0-6 | Before freezing: rehearse the untested §3 config (R0, R0-K); measure the kinetics tolerance (row 2); fix the noise-rule wording, K and power, and the env-fault definition (row 1); record the engine freeze point (S0-4); decide the adoption rule (S0-6). Seeds move to 8001+ as insurance (C2). A random floor is a config choice for system-view numbers (C10) | "Calibrate relTol on archived dev shadow pairs" is impossible; row 2 replaces it. Oracle controls (`oracle-controls.mjs`, counts only) still run first |
| 3. Decision-level verification | 13 (primary), 3, 4, 21, 22, 51 | Dossiers 1 (option 2), 2, 6 and 8 converge here. It comes before portfolios (C9) | "Measure the catch rate on the DEV-NOTES D1 misses using archived tasks" needs the lost solvers. Fallback: the static C0 solver now (rows 4, 13, 21), then R0 |
| 4. Spec-first compile for kinetics | 24 (primary); 2, 9, 10 first; 34, 37; 12 is the records analogue | Dossier 5: B6 is at least half instrument, so test that (row 10, on R0-K) before spending $40. Dossier 3's ruled demonstrator tests "settle the law once" on records at about a sixth of the cost | The 3 warmup traces and the 11 archived kinetics compile attempts are lost. R0-K replaces them |
| 5. Compile portfolios | 31, 16, 47 | Dossier 1: diversity helps only when forced; use variants to find decision points. Dossier 7: measure compile variance first | The archived trace pools are lost; after R0 |
| 6. Judge leverage, then the judge program | 14 (leverage), 3, 18, 19, 43; J1 Jev done | Dossier 6: leverage, not cost share, decides tiering, and consequence checks come first. Owner direction: Jev replaces Kev; Kev J2 training is parked | Leverage needs R0 plus S0-2. The judge program's J2 needs re-authored held-out and calib-OOD material whatever the model |
| 7. Reuse experiment | 15 (primary), 20, 38, 39 | Dossier 4: the profile gate sees size and nothing else (dossier 4 M1); `shapeKey` cannot tell d3 from d4 (dossier 4 M2). Compare five gates | The proven S/H v1 lender is lost. The static C0 solver can lend now; JIT lenders after R0 |
| 8. Replication streams | 17, 33, 35, 52 | Dossier 7: build the conformance evaluator first. B18 needs B14 to run | None. The R-bench items and the corpus survive |
| 9. Router v0 in the stream | 29, 5, 42 | Dossier 6: v0 has no quality term. On records it would interpret with Haiku (15/24), where JIT S/H got 22/24. Replay first; FG P3(d): park the wiring if no policy beats both fixed choices | Per-task rows are lost; arm-total replay only until R0 |

### 4.1 Proposed revised order

0. **Step 0 (§2.0), $0.** Persistence; override hook and memo; laptop isolation probe; engine freeze record; per-bed seed
   ledger; acceptance hardening with the adoption rule; host-load fields.
   - *Why first:* the data was lost at this point, and each item protects R0 or decides what R0 can be used for.
1. **§5.1 Dev write-up, $0.** Write from surviving numbers, and add DEV-NOTES D13 (§6.2) and the errata (§6.1).
   - *Why unchanged:* it costs nothing and fixes the record everything else cites.
2. **$0 and cents work that needs nothing lost:** rows 1–7, plus rows 17, 32 and 33 in the background.
   - Row 2 Stage B is a small live run.
   - Row 6 runs in parallel and gates nothing.
   - J1 Jev is done; its write-up is in progress.
   - *Why:* these fix the instruments the PREREG will freeze and test cheap mechanisms with strong prior evidence.
3. **R0, then R0-K.** R0 is the records rehearsal of the §3 config on fresh dev 225–248: $25–40 with per-arm caps, owner
   usage. R0-K is the kinetics run, O/H first, about $25, after row 2's Stage B.
   - *Why here:* they are the biggest unblockers and the first real spend. They rehearse the exact config to be frozen, and
     their pass rates on untuned seeds are FG §4.1 capability numbers.
4. **§5.2 Freeze the PREREG, then run the held-out stream.** *Moved from 2 to 4.*
   - **Why not earlier.** Freezing now would freeze six open items:
     - the untested §3 config (R0 and R0-K rehearse it);
     - a kinetics tolerance with no data behind it (row 2);
     - the noise-rule wording (row 1);
     - K and power (row 1);
     - the env-fault definition (row 1);
     - no recorded engine freeze point (S0-4).
   - The seed move (Q1) is a one-line edit that does not gate the freeze.
   - Whether to add a random shadow floor is a config choice for system-view numbers (C10).
   - **Why not later.** The capability rule (FG §4.1) and the owner's goal need a held-out number. New mechanisms get
     amendments rather than delaying the first held-out test.
   - **Condition.** If row 1's power table says K=2 cannot decide at δ = 10, the owner chooses between raising K and reporting
     the run as directional by rule. R0 is not used as a second lineage for this table.
5. **§5.3 decision-level verification and §5.6a leverage** (rows 13, 14), **alongside step 4, not as a freeze gate.**
   - *Moved up* from 3 and 6, but no longer placed before the freeze. Both need code that does not exist yet: a decision ledger
     in `flow`, and the override hook from S0-2. That code would change the config R0 rehearses.
   - They are adopted by PREREG amendment, or in the next held-out round. Row 13 can start on the C0 solver in step 2.
6. **§5.7 Reuse** (row 15). *Moved from 7 to 6.* With the C0 lender it costs $1–3 and can start in step 2.
7. **§5.4 Spec-first compile for kinetics** (row 24). *Moved from 4 to 7.* It is gated on R0-K, row 2, row 10 and fresh
   warmups. If row 10 withdraws B6 as an artefact, rescope or drop it before spending about $40.
8. **§5.8 Replication.** Rows 17 and 33 already run in step 2. Row 35 runs here, after owner sign-off under THESIS D10/D15.
9. **§5.5 Compile portfolios** (row 31). *Moved from 5 to 9.* It comes after row 16 measures compile variance and after
   decision-level verification, because the dossiers disagree on what diversity buys (C9).
10. **§5.6b/c Judge program.** Jev replaces Kev. J1 Jev is done; Kev J2 training is parked. A Jev J2 preregistration waits on
    re-authored held-out and calib-OOD material. Inside JIT streams, Jev stays analyst-side or shadow-only until a port passes
    ROADMAP §2.4 (§2.4).
11. **§5.9 Router.** Unchanged: last. Do not wire v0; replay first (row 29).

---

## 5. Shared mechanisms and ideological roots

### 5.1 Mechanisms where one fix moves several blockers

| mechanism | blockers | the one fix |
|---|---|---|
| Verification sits at the answer, but the risk sits in a few decisions | B1, B7, B5, B12, B13, B8, B17, B15; B2 option 2 | A **decision ledger** emitted by `flow`: decision id, inputs, margin, leverage, tier, check coverage, quote. It feeds margin-proportional audits (B1), comparison by decisions (B7), leverage (B5), module boundaries (B12), step labels (B13), conformance acceptance (B8), precedents (B17) and judge-port calibration labels (B15) |
| Agreement taken as correctness inside one model family | B2, B3, B5 (leaf agreement), B8 (agreement with demonstrations), B15 (teacher value = label), B16 (quality assumed equal), B17 | Independent sources by construction: code consequence checks (dossier 6 N3, row 4's double-entry count, B12 residuals), a labeller outside the family (the owner; Jev once its independence is measured, row 18), and generator labels where they exist |
| No random-propensity audit, so oracle-free rates are biased | B2 (discrepant analysis), B17 (dispute-only labels), B16 (missing counterfactuals), B15 (judge evaluation set), B1 (risk-limiting audit) | One ε-random shadow floor with logged propensities, used for every **system-view** silent-miss and durability number and every router training row. Targeted shadows stay, but never feed those rates. Oracle-scored outcomes do not need it (C10) |
| The domain of validity lives in code the compiler rewrites | B4, B11, B12, B18, B13; B2 (lone answerer) | A runtime-owned, monotone domain artifact: profile, concept set, contract key, refusal suite, evidence record. It widens only through a recorded re-baseline. Refusal replay alone does not enforce this (C13). One "guarded region" construct (dossier 8) serves module boundaries, reuse gates and episode handoffs |
| Semantics never made explicit and owned | B6, B8, B7 (comparator spec), B3 (law against fact), B17 (precedent), B5 (global reads), B14 (approved deviations) | The strong model or the owner settles questions of law once per family: quoted rulings, a rulebook, a contract with per-field materiality. Cheap tiers fill in facts. Rows 12 and 24 test this on records and kinetics |
| Instrument defects passing as system defects | B6, B8, B7, B9, B10 | Gauge and instrument checks before mechanism experiments (rows 1, 2, 6, 10, 11) |
| An arm is one draw from a lineage distribution | B9, B2, B12 (heal blast radius), B18 | Lineages as the unit of analysis (power and CI per lineage) and of deployment (siblings rather than replacements, as in dossier 4 option c) |
| Shared resources without a scheduler | B10, B10b; shared draws (B9) | One admission layer with a usage meter and a CPU meter, criticality classes and a pacing curve (rows 6, 42, 49) |

### 5.2 Ideological roots that recur

| root belief | blockers |
|---|---|
| The task, and its whole answer, is the unit of compiling, verifying and healing | B1, B7, B12, B13 |
| Agreement (with a teacher, siblings or demonstrations) is evidence of correctness | B2, B3, B5, B8, B15, B16 |
| A refusal is a defect to compile away; a silent miss costs nothing because nobody sees it | B4, B18 (dossier 7: DEV-NOTES D9 is a deletion-only patch), B11 |
| A teacher is one entity with one trust level | B3, B5, B15, B17 |
| An arm is a configuration with one performance number | B9, B18 |
| A compile failure is a compiler-skill failure, so a stronger or trained compiler fixes it | B6, and the composer question |
| The meter is dollars, parallelism is free, a 429 is an outage | B10, B10b |
| Replication means rebuild once and score once against a hand-built oracle | B14 |

---

## 6. Claims to treat with care

### 6.1 Numbers that disagree with the repo (errata)

| claim | where | repo | note |
|---|---|---|---|
| s214 was under-merged "identically by three independently compiled solvers" from "Opus, Sonnet and Haiku traces" | dossier 1 §B2.1 Fact 1; dossier 2 §B1.1; dossier 8 §B12.1; **DEV-NOTES D8** ("wrong in all three solvers") | nversion row s214: `opusV1`, its child `opusV2`, and `sonnetV1`; `haikuV1` deopted | Two independent lineages, not three. The common-mode evidence is one task and two lineages. **Erratum for DEV-NOTES D8** |
| O/H v2 "answered and failed 5 of 7" d4 tasks | dossiers 4, 7, 8; **DEV-NOTES D9** | `opusV2` is wrong on 6 of 8 d4 tasks (passes only s219 and s221); 5 of the 7 after s217 | **Erratum for DEV-NOTES D9:** "6 of 8 (5 of the 7 after s217)". This is the offline probe, not the stream |
| O/H v2's heal "led to 5 silent compiled misses on d4" | **DEV-NOTES D12** | The stream had 6 compiled failures in all (d3 4, d4 2). Its d4 silent misses, s218 and s223, came from **v3** (FG S8). v2 met only s217 on d4, and a shadow caught it (DEV-NOTES D9) | **Erratum for DEV-NOTES D12.** The link from the v2 heal to silent d4 misses is shown only in the offline probe |
| Haiku "loses 1" task to the tier swap | dossier 6 §0 N1 | Committed tier-down JSON: s204's variant status is `deopt` | 2 lost (C3). DEV-NOTES D11's wording ("Of the 3 Haiku tasks lost against Opus, … the second deopt …") does not match the file either: one deopt (s204), one pass→fail (s208), one task both tiers failed (s205). **Erratum for DEV-NOTES D11** |
| "The 17 known wrong compiled outputs" (records) | dossier 5 E8.2 | FG S1: 17 of 56 at 03:55 counted records 15 and kinetics 2. On the nversion table, which E8.2 runs on, the count is **24 wrong of 67 answers** | Wrong denominator, and a mixed family |
| "The 17 compiled deliveries" | dossier 2 E2, E3 | DEV-NOTES D10: S/H delivered compiled answers 19 times (17 pass) | On S/H alone an AUROC rests on 2 positives and is degenerate. Pool the arms, or use C0's outputs (row 4) |
| Haiku agent "$0.062 per task" (sweep F5) | dossier 4 §B11.6 | FG §0.3: $0.103 | FG was first committed while the dossier agents were still running, so whether the correction preceded the dossiers cannot be checked |
| A deopt costs "about 130×" a compiled run (sweep F9) | dossier 4 §B4.2 | FG §0.3: about 55× the median `ok` run, about 30× the all-in mean | — |
| "Of 6 disagreements so far, 3 were unresolved" | dossier 3 §B17.1 | FG S3 at 04:22: 9 disagreements, 5 unresolved | The 03:55 snapshot |
| Router threshold "$4.5 at slider 0.5" | dossier 6 §B16.1 | `router.mjs`: payback = 1 + 2s = 2.0, so 2.0 × $3 = $6 | The conclusion (interpret) does not change |
| The recompile prompt "orders the widening" (`prompts.mjs:96–101`) | dossier 4 §B4.1 | Prompt v4 says "Never widen a guard further than the traces you can reproduce" (`prompts.mjs:129–137`); v1–v3 keep the old text (137–143). v4 is opt-in, and the dev streams ran the old text | Partly fixed in §3. The deeper point stands: the fence lives in rewritable code, and one example stretches the profile (dossier 4 M3) |
| Kinetics compiles cost "$3.2–8.1", cited to FG §0.1 | dossier 5 §B6.1 | FG §0.1 gives per-arm compile totals ($9.63–13.94); HANDOFF §2 gives $3–7 for Opus fallbacks | Not traceable to the cited table |
| The static C0 solver's "d4 silent failures (2/8)" | this synthesis, first version | DEV-NOTES D5: 2/8 is its d4 **pass** count | 6 silent d4 failures |
| The deletion-diff tool "can be tested on the v1–v3 solvers in `tools/run-view/test/streams-fixture`" | this synthesis, first version | Each fixture `solve.mjs` is one comment line (`// fixture v2`) | Withdrawn. Row 7 uses C0 mutants |
| "The dev streams ran the default configuration" | this synthesis, first version | `configs/dev-*.json`: `jit.compare: 'unordered'`, `maxFallbacks: 2` | Corrected in §1 |
| Model ids rejected by `tests/model-policy.test.mjs` | this synthesis, first version; the `policy/models.json` notes | The file is `tests/models-policy.test.mjs` | Name corrected here; the policy note still carries the old name |
| Tolerant comparison not landed; kinetics never compiled well; hidden paths mean contamination; seeds collide | dossiers 5, 2, 7; this synthesis, first version | See C5, C4, C7, C2 | — |

### 6.2 Measurements made on data that is now lost

These are now the only record. They cannot be re-verified, and R0 will not reproduce them exactly. Copy them into DEV-NOTES D13
with that label:
- **Dossier 1:** the S/H-vs-O/H split, 5 S-only and 1 O-only.
- **Dossier 2:**
  - s205 (36 predicted against 34 entities, recall 0.970) and s214 (40 against 36, recall 0.873);
  - s205's grader cliff at `entitySlack` 0.02;
  - the S/H v1 identity rule at `solve.mjs:493–498`.
- **Dossier 3:**
  - H/H label noise: s202 at 0.973 (a warmup trace) and s205 at 0.981 (a deopt fallback);
  - 4 of 11 compiled outputs passed;
  - the sign overrides in BUILD-NOTES: 16, 9 and 17;
  - the Sonnet agent's per-seed string `0100100010101000|11111111`.
- **Dossier 4:** M2 (one `shapeKey` for d3 and d4); M3 (O/H v3 profile); S/H v2 adopted with `accepted: false` at exact 0.143.
- **Dossier 5:** N1–N6, all of them, including N6's 23.7 °C scope dispute (+2.8% Km, a changed exclusion set). N1's raw
  rejection counts stay recorded as a negative result even if row 10 withdraws B6 as an artefact.
- **Dossier 6:** N1–N3, including the data margins that decided the three cheap-tier date errors (s204 4:1, s207 1:3,
  s208 0:6) and the 61 date sentences that collapse to 36 forms.
- **Dossier 7:** 21 compile records, $44.30, and 41 hidden-path attempts.
- **Dossier 8:** helpers re-derived 10/10 times; 0 imports across 21 solvers.
- **Dossier 9:**
  - the 187-minute stall, 252 rows and 71 `MODEL_RATE_LIMIT` faults;
  - 19–20 fault rows per Haiku agent arm;
  - the concurrency table;
  - the peak of 19 concurrent task rows.

### 6.3 Small-n and K=1 claims not to repeat as findings

- **"Common mode is real"** (B2) rests on:
  - s214, one task with two independent lineages (§6.1);
  - Fisher p ≈ 0.032 on 3 joint failures among 20 tasks;
  - β ≈ 0.7, with an interval dossier 1 itself calls very wide.
- **"Lineage variance dominates interpreter strength"** (B9, DEV-NOTES D12) rests on one lineage per arm. McNemar p = 0.22 is
  no evidence either way. The design effect of 3.3 assumes ρ = 0.1, which has never been measured.
- **Tier-down and consequence checks:**
  - DEV-NOTES D11 is 8 tasks per tier (s204–s211), partly confounded (C3).
  - Dossier 6 N3's 25/25 comes from a check designed with the three date errors already known, which is why row 3 scores it out
    of sample.
  - Haiku's 3% per-leaf date-order error is 1 of 33.
- **Acceptance (B6, B8):**
  - "Acceptance does not predict success" is n = 17.
  - "Opus is rejected at a similar rate" is 6 attempts against 5.
  - The regex false reject is n = 1, under a dev config that the §3 config changes.
  - Dossier 5 N2 is tagged [inference] by its own author.
- **Teachers (B3):** "29% label noise" is 2 of 7, and "the compiler override was probably correct" is unchecked.
- **Profiles (B4):** "every detection comes from size" holds on records dev only. Kinetics d5 had signals that were not size
  (HANDOFF §4).
- **Router (B16):** "v0 would pick the worse option" uses K=1 arm totals.
- **"Verifying whole answers spends about 50× too much"** (dossier 2 §B1.2; THESIS-JIT §6.2's "about 1/50"). This is an
  estimate; FG S5 says the cost of decision-level checks is unmeasured.
- **Throughput (B10):** the contention table (≤ 6 in flight: 78%; ≥ 10: 72%) is confounded by task mix and arm. The 69% and 36%
  shareable-spend figures are upper bounds that assume request equivalence, which is unchecked.
- **Jev J1:**
  - It is a K=1 read on in-family dev data, invalid by the re-read rule, with no calib-OOD.
  - The interactive and runbook CIs are form-unclustered (3816d88).
  - No port has a verdict.
- **Other beds:** B13's gridquest figures are code stand-ins, and no LLM has run there. B14's pilot figures (18, 11 and 5 design
  classes; $11 per item) come from 5 pilots.

### 6.4 External sources the dossiers did not verify

This synthesis fetched nothing, so every external claim below is as reported by a dossier agent. Each was marked by its dossier as
abstract-only, secondary, unverified, or recent enough to need a check.

**N-version and aggregation.**
- Ron, Baudry, Monperrus, arXiv 2606.20158: failures 387.44 → 130.99.
- Nogueira et al., arXiv 2607.02808: 0.43 and 0.44 of the independent gain, and under 0.3 for same-model ensembles. C9 leans on
  this claim.
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

**Jev.** Its training data and base model are undocumented, and Kev's architecture is a third party's guess about it
(`research/kev-20261007/01-kev-dossier.md:93–99`). Its price is second-hand.

**Operational claims for B10.** These matter most, because a governor would be built on them:
- "limits are shared across all models";
- `autoContinueAtUsageLimit`;
- "the cache lives an hour on a subscription";
- window anchoring at first use (third-party guides only);
- whether the subscription meter discounts cache reads.

Verify them against current Claude Code documentation, or measure them with row 6, before building a governor.

---

## 7. Open questions for the owner

1. **Held-out seeds.** PREREG-stream's 7001–7024 and 7101–7124 sit inside Kev's registry reservation. This is a reservation,
   not contamination: nothing there has been generated or read (C2). Should the JIT held-out set move to 8001–8024 and
   8101–8124 per family, recorded in a per-(bed, split) ledger that `stream.mjs` and `kev-data/lib/registry.mjs` both check?
   - *Recommendation: yes,* as $0 insurance. The clean range is test seeds ≥ 7200 for every bed.
   - Treat synth test 7000–7099 as used.
   - This does not gate the freeze.
2. **R0.** May I run the records dev rehearsal of the §3 config? It covers JIT S/H, O/H and H/H, the Haiku agent and the
   static arm, on fresh dev 225–248, after step 0 and row 1. It costs about $24 at dev rates and **$25–40 expected** under
   §3, in your usage, with per-arm caps and `spendStopUsd` 40.
   - *Recommendation: yes.* Its only job is the rehearsal and capability numbers. It is not a second lineage of the lost runs.
3. **R0-K.** May I run the kinetics dev re-run under the §3 config, O/H first, on kinetics dev 225–248, after row 2's Stage
   B? It costs about $25 for 24 tasks.
   - *Recommendation: yes,* O/H only at first. Add H/H only if row 10 has too few compile attempts per builder.
4. **O1, for one parameter.** May the kinetics tolerance from row 2 enter the frozen PREREG as a dev-calibrated value?
   - *Recommendation: yes,* for this parameter only, with the calibration slice (kinetics dev 201–224) frozen, disclosed and
     kept apart from claim seeds.
   - If no: the PREREG states a value taken from the prompt's ±10% grading rule **or the bed README's stated precision**
     (DEV-NOTES D7, FG §4.1), before row 2's results are read. Row 2 then only reports that value's error rates.
5. **Jev, after the direction.** Four questions remain open.
   - **(a)** May a Jev port gate decisions in dev streams once it passes ROADMAP §2.4? *Recommendation:* yes in dev, after it
     passes and after row 18 measures its independence. Until then it is analyst-side or shadow-only, and wiring it into
     `flow.judge` is a preregistered amendment.
   - **(b)** May non-synthetic text (R-bench, owner tasks) be sent to TypeSafe? *Recommendation:* not for now. Dev bed text
     only, matching the THESIS D10 default.
   - **(c)** What is the TypeSafe credit budget? *Recommendation:* set an explicit cap per run (the scorer already enforces a
     request cap) and a total. Verify the price from your account, since the policy price is second-hand.
   - **(d)** Should we ask TypeSafe about fine-tuning and verified pricing? *Recommendation:* yes. It is cheap, and it decides
     whether Kev J2 stays parked for good.
6. **Heal kit and the engine freeze.** Commit 38f74fd changed the owner policy hash, so the heal kit's policyDrift gate now
   blocks (`experiments/heal/kit.mjs`). The options are:
   - re-freeze the kit policy;
   - approve a proved exemption for judgment-only additions;
   - move Jev out of the owner policy file.

   *Recommendation:* decide before S0-4's engine freeze record, because R0, R0-K and the held-out run must share one policy
   hash. This synthesis takes no position on which option, and it does not touch heal proposal `p-a3336190-r4`.

---

## 8. Changelog (revision after BLOCKER-SYNTHESIS-CRITIQUE.md)

All ten must-fix items were checked against their cited files and accepted. None was rebutted.

| item | change made | verified against |
|---|---|---|
| M1 seeds | C2 reframed as "registry reservation, not contamination". The clean range is test seeds ≥ 7200 for every bed. The move to 8001–8024 / 8101–8124 is kept as $0 insurance with a per-(bed, split) ledger (S0-5). Synth 7000–7099 is marked used. Seeds removed from the freeze-defect list. §1, §4.1 step 4 and Q1 updated | `registry.mjs:2–13`; `records.test.mjs:148–149`; `beds/synth/AUDIT.md:15, 26, 134`; `stream.mjs:80` |
| M2 acceptance regex | The old rank 2 became the step-0 hardening task S0-6, coupled with the `accepted: false` adoption decision. "Row 2 can withdraw B6's premise" was deleted; rows 10 and 11 (on R0-K) now carry that test | `check-traces.mjs:161`; `acceptance.test.mjs:46`; `stream.mjs:554`; `acceptance.mjs:20–21, 116` |
| M3 shadow floor | C10, §5.1 and row 5 now limit the floor to system-view (oracle-free) estimates. It is a config choice, not a freeze defect | `durability.mjs:19–20`; PREREG §3 |
| M4 row 7 | The claim that the v2.2 edge is "computable now" was deleted, along with the streams-fixture plan. Row 7 now uses C0 guard-deletion and widening mutants. New conflict C13 says why v2.2 most likely would have accepted the DEV-NOTES D9 heal | `stream.mjs:181, 518–522`; nversion rows s205 and s206; DEV-NOTES D3; the fixture `solve.mjs` files (one comment line each) |
| M5 R0 | R0 has one job: a §3-config rehearsal on fresh dev 225–248. Second-lineage use and pairing with the lost run were removed. Cost restated as about $24 at dev rates (static arm included), $25–40 expected, with per-arm caps | `configs/dev-records-1.json`; commits 2f9862a and 38f74fd; FG §4.1; DEV-NOTES D10 table |
| M6 noise rule | Row 1 keeps the 3-point floor and adds McNemar and a clustered CI. The "22 vs 18 prints as real" argument was replaced by "a fixed threshold is not a test" | `report.mjs:10`; ROADMAP:889; PREREG §4 |
| M7 Jev | §2.4 rewritten for "Jev replaces Kev": J1 Jev done, Kev J2 training parked, routing work stated, independence downgraded to unverified. C11 overtaken. Q4 replaced by Q5 and Q6. The policy is now committed (38f74fd), not only in the working tree | commits 4517c4a, 38f74fd, 3816d88; `policy/models.json`; `j1-jev-dev-tables.md`; `01-kev-dossier.md:93–99`; ROADMAP §2.4 |
| M8 notation | Dossiers are "dossier 1–9" everywhere, alongside "DEV-NOTES Dn" and "THESIS Dn"; bare "Dn" is gone | — |
| M9 errata | §6.1 adds DEV-NOTES D8 (two lineages), D9 (6 of 8), D12 (the d4 silent misses were v3's) and the 24-of-67 count, plus E5, E9, E11 and O2 and three of this synthesis's own errors | DEV-NOTES D8, D9, D12; FG S8; the nversion rows |
| M10 kinetics | Added R0-K (row 9, about $25, O/H first), rows 10 and 11 (dossier 5 E6.1 and E8.1), and owner question Q3. §4.1 step 3 runs R0-K after row 2 Stage B | FG §0.1 ($17.82 per 17); dossier 5 E6.1, E8.1 |

**Critique "missing" items.**
1. Kinetics re-run: row 9 and Q3.
2. Dossier 5 E6.1 and E8.1: rows 10 and 11.
3. Dossier 2 E3: row 4.
4. v2.2 and DEV-NOTES D9: C13 and row 7.
5. The adoption decision: S0-6.
6. The engine freeze point: S0-4 and Q6.
7. The laptop isolation probe: S0-3 and C7.
8. FG P-plan reconciliation: §2.5.
9. Persistence format: S0-1.
10. Jev nondeterminism: §2.4 conditions.

**Other critique items accepted.**
- V10: Stage B is the evidence; the token dependency is stated.
- V11: out-of-sample scoring for row 3.
- V12: row 5 re-scoped.
- V13: row 6 is not an R0 gate.
- V18: the override hook comes before R0.
- V19: row 13 relabelled.
- V21: row 19 moved to bed-rendered notes.
- C1 provenance and the Q4 fallback; C4 wording; C9's "both need R0"; C12's three attempts.
- J5–J7: journaling, the test-file name, price unverified.
- O1, O2: reworded.
- S4: decision verification runs alongside the freeze.
- S5: the defect list rewritten.
- R1: dossier 5 N1 kept as a negative result.

**Where this revision departs from the critique (minor, with evidence).**
- **Row 4's cost.** The critique lists dossier 2 E3 at $0. The count is $0, but C0's dev-stream outputs were lost. Regenerating
  them on 24 tasks costs about $1.2, because the C0 solver calls a Sonnet/Opus config judge and Haiku judges (static arm $1.21
  in FG §0.1).
- **Row 3's out-of-sample seeds.** The critique suggests fresh dev 225–248. This revision uses 249–272 (also reserved by FG P2)
  so that 225–248 stay untouched for R0's capability numbers.
- **The kinetics dev config.** V7 says `configs/dev-kinetics-1.json` has no `compare`. It has `jit.compare: 'unordered'`, but no
  `compile.compare` or `compile.acceptance`. This does not change the critique's point.

### 8.1 Laptop landing, 2026-10-09 (main session; all on `claude/intelligent-hamilton-vg1f9a`)

| item | status | where |
|---|---|---|
| S0-1 export, S0-5 seed ledger, S0-6 adoption rule, S0-7 host-load | landed | 6020c14 |
| S0-2 override hook, salt-free memo port, replay coverage; exact `requestDigest` | landed; exact digests in progress (port.mjs) | 74eb3ae, 40a7426 |
| S0-3 isolation probe → env allow-list, private `/dev`, uid drop; CLI root check | landed; live smoke passed ($0.052, oracle 0.998) | b018f5d, DEV-NOTES D15, SMOKE-laptop-20261009.md |
| S0-4 engine freeze | draft; re-stamp after the last src change | ENGINE-FREEZE.md |
| S0-6 acceptance ids / verdicts prompt / `allowSharedExplanation` wired; `jit.replayJournal`; per-arm caps | landed | 40a7426 |
| Q6 heal-kit drift exemptions | landed | e8d7a53 |
| row 1 stats instrument; row 5 verification-policy simulator → `jit.shadowFloor` 0.25 with logged propensity | landed | 07d122d, 40a7426 |
| row 2 Stage A (0.05 with exact exclusion sets); Stage B driver; Stage B live | A landed; B running (48 Haiku sessions, $5 stop) | 5b56a15, ee688db |
| row 3 Stage 1, row 4 (AUROC 0.874, survives), row 7 (10/12, 0/10, survives) | landed | ba29a07, D20 |
| row 6 quota meter | landed; 5h 0.44 / 7d 0.34 at 11:18 UTC | 94f396c |
| row 17 (no fire), row 33 (**fires**) | landed | 21e9b5c, D21 |
| row 18 Jev independence | landed, negative | 5b56a15 |
| row 23 shared draws → neutral workdirs | landed; realisable saving $0 | ec2d58d, 3f80815, D18 |
| row 28 certiorari pilot | landed; Q1 fails, Q2 only via the D9 class | ec2d58d, D19 |
| row 29 router replay | landed, negative; router parked | ec2d58d, D17 |
| row 50 adjudication order | landed; non-transitive, todo | ec2d58d, D16 |
| row 8 R0 configs + runbook | configs validate; runbook with seven $0 gates | 40a7426, ac84c75 |

### 8.2 Direction correction from the owner (2026-10-09)

The owner restated the thesis: Foundry is a way to JIT-construct **micro-harnesses and complex workflows** that humans
normally hand-curate (nesting, nodes with their own sub-agents, swarms as in Kimi's agent swarm and Claude Code's
Workflow tool), test whether **Haiku can build them cheaply**, run them against worst-case scenarios, and watch them
evolve, reuse and self-heal as the work gets more complex. The stream programme above is substrate and economics for
one flat unit; it is not the thesis test. A structural bed (the **W-bed complexity ladder**, `design/W-BED.md`), the
`flow-v3` primitives (`call`, `agent`, `wide`, `plan`; `design/FLOW-V3.md`), a prior-art primitive table
(`design/PRIOR-ART-SWARMS.md`) and a Prime Agent principle extraction (`analysis/prime-agent/`) are in flight. R0 is
reduced to the Haiku-agent vs H/H-JIT pair as an engine rehearsal; the remaining budget goes to the first W-bed rungs.
