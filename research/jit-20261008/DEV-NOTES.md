# JIT dev-stream diagnoses (running log, development evidence)

*Dev split seeds only. The bed oracle's per-field mismatches are read here to diagnose, which dev evidence allows.
Nothing here is a claim. Each entry gives the observation, the mechanism and the design consequence.*

## 2026-10-09

**D1. Every silent compiled miss on records so far is under-merging.**
- Observation: the Opus- and Sonnet-interpreted arms (v1 and v2) have 4 compiled failures. All 4 have `predicted > entities`: 42 vs 41, 40 vs 39, 36 vs 34, 40 vs 36. The unmerged pairs are one-typo variants: "Bneoit N."/"Benoît", "de Vreis"/"de Vries", "Anook"/"Anouk". The split entity then takes the wrong country, phone or amount. No guard or invariant fired, and the result passed its own checks.
- Mechanism: the compiled fuzzy identity rule (one typing error allowed, plus an equal date or a shared phone) is a hard threshold. Clear cases go right, and near-threshold cases fall on the wrong side. The agent handles them by judgment.
- Consequence (v2 compile guidance): after any grouping, dedup or merge step, scan for near-miss groups (similar keys plus a shared secondary attribute). Send them to a narrow same-entity `flow.judge` with a verifiable check, and `flow.flag` them so the stream shadows those runs. This is a general pattern (decide clear cases in code, borderline cases with a judge), not a records special case.

**D2. A weak interpreter cannot check its own compiled code.**
- Observation: the Haiku-interpreted, Haiku-compiled arm learned a conflict-resolution procedure error from noisy Haiku traces. Amount, phone and country fields are wrong on several entities in every compiled run, at $0.004–0.007 per run. On task 7 a Haiku shadow disagreed, the Haiku adjudicator gave no majority (`unresolved`), and the wrong compiled answer was delivered.
- Consequence: interpreter quality bounds both the traces and the shadows. The economical configuration is a strong demonstrator used rarely (warmup, deopts, sampled shadows) with a cheap compiler and executor. The held-out round keeps Haiku/Haiku as an explicit negative control.

**D3. Over-strict judge checks cause deopts, and deopts heal.**
- Observation: the Opus/Haiku v1 deopted on 2 consecutive tasks. Its `vendex-entries` judge failed its own check (spans must be substrings and dates and amounts must parse) on every tier. Both tasks were re-solved correctly by the Opus interpreter. The two traces triggered recompile v2, which passed its first task ($0.90 including the recompile), and its compiled runs then cost about $0.009.
- Consequence: the loop works as designed. Check calibration is the next lever. A check that fails on every tier for an input class should become a guard (deopt immediately, without paying for escalation) or be loosened at recompile.

**D4. Compile acceptance is too permissive under the noisy-label rule.**
- Observation: kinetics Haiku/Haiku v1 was accepted with exact 0/3 and partial 0.546, because the rule is "clean (no crash or deopt) plus every disagreement named in BUILD-NOTES". The Sonnet-arm records v1 was accepted with exact 0/3 and partial 0.997, and that one worked fine.
- Consequence (v2): acceptance needs a minimum agreement level (for example mean partial ≥ 0.9, or at least one exact match among the labelled traces). Each named disagreement must also quote the task sentence that decides it. Otherwise the run counts as not accepted and gets the Opus fallback.

**D5. Static compiled code fails silently on drift.**
- Observation: the C0 B1-haiku records solver was built with oracle-scored probes at d3. In this stream it went 14/16 at d3, then 2/8 at d4, and never signalled. The JIT arms' guards fired on their first d4 tasks (Sonnet arm: deopt on #16 and #17, both re-solved correctly by the interpreter).
- Consequence: guards are the difference between graceful and silent degradation on distribution shift. This needs a preregistered held-out test with a drift segment.

**D6. Leaf agreement under-counts semantically equal judge outputs.**
- Observation: the Sonnet arm's `rules` judge is Opus-only and makes up about 90% of compiled cost. When it was replayed on Haiku and Sonnet, every decision matched except the marker representation (`"env":"sandbox"` vs `sandbox`). Leaf agreement was 0.966, under the 0.98 bar.
- Consequence: screen a tier-down end to end. Swap the judge's tier inside the compiled solver and compare final answers and dev-oracle scores (`tierdown-e2e`, being built).

**D7. Exact answer comparison breaks shadows and compile checks on numeric families.**
- Observation: on kinetics task 6, an Opus shadow disagreed with the compiled answer, and the Opus adjudicator gave no majority (`unresolved`). The compiled answer passed the oracle, so $1.13 went on a check that could not have concluded. Kinetics answers are fitted `vmax`/`km` numbers, and two correct independent fits almost never agree to the last digit. `check-traces` compares exactly as well, so a correct kinetics solver can score 0 exact matches against its traces. That inflated the kinetics compile "diffs" and would make D4's stricter acceptance reject good solvers.
- Consequence (v2.1): use tolerant comparison everywhere answers are compared without an oracle: shadows, adjudication, `check-traces` and tier-down. Numbers match within a relative tolerance and arrays match as multisets. The tolerance is a property of the task family, chosen from the bed README's stated precision and never read from oracle code.

**D8. Agreement between independently compiled solvers is a useful but imperfect oracle-free signal (N-version probe, final).**
- Observation: [nversion-records-dev.json](nversion-records-dev.json) ran four compiled records solvers (Opus-arm v1 and v2, Sonnet-arm v1, Haiku-arm v1) on all 24 dev tasks for $2.50. The comparison was exact, with arrays treated as multisets.
  - Unanimous: 7 tasks, 6 correct (86%), against a 64% compiled base rate (43 of 67 answers).
  - One unanimous answer was wrong in all three solvers (s214, under-merging). This is a common-mode failure, the classic N-version result: versions that implement the same spec interpretation fail together.
  - Disagreeing: 13 tasks. The majority was right on 6, at least one solver was right on 11, and 5 had no majority.
  - On 4 tasks only one solver answered, because the others refused; that answer was wrong all 4 times.
- Consequence: run cheap variants and send any disagreement to the interpreter. Disagreement is an efficient trigger, since 11 of 13 disagreements contained a correct answer. Unanimity cannot stand in for checking (common mode). Code-versus-agent disagreement is more independent than code-versus-code because the two decide differently.
- *Erratum (2026-10-09, dev write-up).* The text above says "One unanimous answer was wrong in all three solvers (s214,
  under-merging)". Correction: the three solvers that answered s214 are `opusV1`, its own recompile `opusV2`, and
  `sonnetV1`. All three fail with the same score, 0.892067, and `haikuV1` deopted. `opusV1`→`opusV2` is one compile lineage,
  so s214 is a common-mode failure of **two independent lineages** (Opus arm and Sonnet arm), not three. The common-mode
  evidence is one task and two lineages. Evidence: [nversion-records-dev.json](nversion-records-dev.json), row
  `records:dev:d3:s214` (line 502); [BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md) §6.1 row 1.

**D9. A heal can remove the ability to refuse, which turns deopts into silent failures on drift.**
- Observation: Opus-arm v2 was recompiled to fix the over-strict `vendex-entries` check (D3). In the N-version probe it never deopted (24/24 answered, 15 correct). On the d4 drift tasks it answered and failed 5 of 7. Its predecessor v1 and the other solvers refused most d4 tasks. In the live stream, v2's first d4 task was wrong and a shadow caught it (adjudicated, regression recorded).
- Mechanism: reject-if-worse compares only old labelled cases, so it cannot see a guard that has been widened.
- Consequence: a recompile also has to replay every input on which the previous version deopted, and every guard-triggering input in the trace pool. Each must either still deopt or now match the interpreter's answer. Otherwise the version is rejected. A recompile must not silently widen the input domain.
- *Erratum (2026-10-09, dev write-up).* The text above says "On the d4 drift tasks it answered and failed 5 of 7".
  Correction: in the N-version probe `opusV2` answered all 8 d4 tasks (s217–s224) and was wrong on **6 of 8**; it passed only
  s219 and s221. On the 7 d4 tasks after s217 (s218–s224) it was wrong on 5. This is the **offline probe, not the stream**:
  in the stream, v2 met only one d4 task (s217, caught by a shadow; see the D12 erratum). Evidence:
  [nversion-records-dev.json](nversion-records-dev.json), rows `records:dev:d4:s217` to `records:dev:d4:s224` (lines
  607–852) and `summary.perSolver.opusV2` (ok 24, pass 15); [BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md) §6.1 row 2.

**D10. The records dev stream for the Sonnet-interpreter / Haiku-compiler JIT is complete (K = 1, dev seeds, directional only).**

| arm | pass | d3 | d4 (drift) | total $ | $/success |
|---|---|---|---|---|---|
| Opus agent, every task | 24/24 | 16/16 | 8/8 | 13.54 | 0.564 |
| **JIT Sonnet → Haiku** | **22/24** | 14/16 | 8/8 | 8.99 | **0.409** |
| Sonnet agent, every task | 13/24 | 5/16 | 8/8 | 7.05 | 0.543 |
| Haiku agent, every task | 15/24 | 9/16 | 6/8 | 2.46 | 0.164 |
| static C0 solver (oracle-scored probes) | 16/24 | 14/16 | 2/8 | 1.21 | 0.076 |

- Delivered by: compiled code 19 times (17 pass) and the interpreter 5 times (5 pass, warmup plus 2 drift deopts). There were 4 shadows, 2 disagreements and 2 adjudications, and both adjudications sided with the correct compiled answer. 1 recompile followed the 2 drift deopts; the Haiku attempt was rejected and the Opus fallback was adopted.
- Cost: compiles $4.83 (54%: builder 2.25, builder's test runs through the gateway 2.16, host check 0.42), interpreter 1.46, shadows and adjudication 1.81, compiled runs 0.89. A pure compiled run costs **$0.0425** (11/13 pass).
- Reading: the JIT beats its own interpreter by 9 successes, at 1.27× the Sonnet agent's cost and 0.75× its cost per success. The gap to the Opus agent (22 vs 24) is inside the noise band. Its cost is 66% of the Opus agent's.
- At 24 tasks the one-time compile cost dominates. Steady state is about $0.04 per task plus the shadow rate × about $0.3. Against the Opus agent that pays back after about 10 tasks; against the Sonnet agent, after about 25–30.
- Biggest cost lever: the builder's own test runs went through an Opus-only `rules` judge ($2.16). Tier-down (D6) and tolerant checks (D7) cut that directly.

**D11. Tiering down a high-leverage judge breaks the solver even though its decisions mostly agree (end-to-end screen).**
- Observation ([tierdown/](tierdown/)): records Sonnet arm v1, judge `rules`, 8 archived dev tasks i003–i010. The originals were the reused Opus runs.
  - Haiku in place of Opus: 5/8 oracle pass vs 7/8, exact final-answer agreement 5/8, cost $0.0061 vs $0.0386 per task. Of the 3 Haiku tasks lost against Opus, 1 was a wrong answer and 1 an invariant deopt. The second deopt was mislabelled "cap reached" by the tool, now fixed.
  - Sonnet in place of Opus: 3/8 pass, exact agreement 3/8, $0.0241 per task.
  - Field-level screening (D6) had found the cheaper tiers agreeing on nearly every decision leaf.
- Mechanism: `rules` is one global, per-task reading (date orders, void markers, sign flips) that conditions every row. A cheap tier that gets 95% of its fields right still breaks the task. Leaf agreement weighs every field equally, but end-to-end success does not.
- Consequence: tier-down targets low-leverage per-item judgments (one row, one entity, one quote). High-leverage global judgments keep the strong tier or use k-sample agreement. The strict lint already flags a single global-configuration read without k-sample agreement. Leverage can be measured: the number of downstream output leaves that depend on the judgment.
- *Erratum (2026-10-09, dev write-up).* The text above says "Of the 3 Haiku tasks lost against Opus, 1 was a wrong answer and
  1 an invariant deopt. The second deopt was mislabelled "cap reached" by the tool". Correction: the committed file shows
  **2** Haiku tasks lost against Opus, not 3, and one deopt, not two. The 5/8 against 7/8 headline stands.
  - s204: the Opus original passed (1.000; `tierdown/live-rules-sonnet.md` line 10 reuses the same archived original) and the
    Haiku variant **deopted** (`tierdown/live-rules-haiku.json` lines 90–105, `variant.status: "deopt"`). This is the task
    the tool labelled "cap reached during the run: excluded" (`tierdown/live-rules-haiku.md` line 10). The file does not
    record the deopt kind, so "invariant" cannot be checked.
  - s208: one pass→fail, 1.000 → 0.776 (`live-rules-haiku.json` lines 442–449; `.md` line 14).
  - s205: failed under both tiers, 0.924 and 0.924 (`live-rules-haiku.json` lines 176–183; `.md` line 11), so it is not a
    loss to the swap.
  - Dossier 6 §0 N1 attributes only 1 Haiku loss to the swap (see D13); the committed file keeps it at 2
    ([BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md) §3 C3, §6.1 row 4). Sonnet's 4 against 3 is unresolved there.

**D12. The Opus-interpreter / Haiku-compiler records arm is complete: 18/24 (d3 12/16, d4 6/8), $7.53, $0.418/success.**
- Delivered by: compiled 18 (12 pass), interpreter 5 (5 pass), adjudicated 1 (1 pass).
- Cost: interpreter $2.31, compiles $2.07, shadows $2.20, adjudicator $0.64, compiled runs $0.31 (about $0.017 per run).
- It did worse than the Sonnet-interpreter arm (22/24), even though Opus is the stronger demonstrator. Two causes: its v1 judge check was over-strict (D3), and its v2 heal widened a guard (D9), which led to 5 silent compiled misses on d4 and under-merging misses on d3 (D1).
- Reading: with one compile lineage per arm (K = 1), compile variance and what each heal does dominate interpreter strength. Three things follow:
  - the held-out round needs K ≥ 2 streams per arm;
  - the v2.2 domain-preservation check (D9) is required;
  - compile ensembles (several Haiku compiles, voting or disagreement-triggered shadows, D8) are a direct way to reduce lineage variance.
- *Erratum (2026-10-09, dev write-up).* The text above says "its v2 heal widened a guard (D9), which led to 5 silent compiled
  misses on d4". Correction:
  - In the stream this arm had 6 compiled failures in all, 4 on d3 and 2 on d4. That follows from this entry's own figures:
    compiled 18 (12 pass), interpreter 5/5, adjudicated 1/1; d3 12/16, d4 6/8.
  - Its two silent d4 misses, s218 (score 0.828444) and s223 (0.664426), came from **v3**, the recompile driven by the s217
    regression case, not from v2 ([FRONTIER-GAPS.md](FRONTIER-GAPS.md) §0.2 S8, lines 147–151; dossier 4 §0 M3 in
    `handoff/workflows/wf_da253fe6-f97.md` line 1059).
  - v2 met only one d4 task in the stream, s217, and an Opus shadow caught it (D9; FRONTIER-GAPS §0.2 S3, line 95).
  - The link from the v2 heal to silent d4 misses is shown **only in the offline N-version probe** (D9 and its erratum).
  - Source of the correction: [BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md) §6.1 row 3.

**D13. Measurements on data since lost (dossier agents, 2026-10-08/09; not re-verifiable).**

*Development evidence only (dev seeds, K = 1 streams, K_c = 1 compiles). Each item below was measured by a
`blocker-dossiers` agent (workflow wf_da253fe6-f97) on the stream run data of `jit-dev-records-1` and `jit-dev-kinetics-1`
(traces, `solve.mjs` versions, BUILD-NOTES, `compile.json`, `events.jsonl`, `results.jsonl`, journals) before that data was
lost with the cloud container (see [BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md), "What changed since the dossiers were
written"). These lines are now the only record. **They cannot be re-verified, and R0 will not reproduce them.** The list is
[BLOCKER-SYNTHESIS.md](BLOCKER-SYNTHESIS.md) §6.2, item by item. "Dossier N" is agent result N of
[handoff/workflows/wf_da253fe6-f97.md](handoff/workflows/wf_da253fe6-f97.md); line numbers are in that file. Numbers are
copied as the dossier states them, with its own tags ([M], [repo], [inference]). Where BLOCKER-SYNTHESIS disputes or
qualifies an item, the note says so.*

- **Dossier 1 (§B9.1, lines 236–238) [M].** S/H 22/24 against O/H 18/24 splits as 5 tasks S-only and 1 task O-only. Exact
  McNemar p = 0.22: "a lineage draw, not evidence about interpreter strength". (BLOCKER-SYNTHESIS §6.3: McNemar p = 0.22 is
  no evidence either way; the split itself can no longer be checked, §1.)
- **Dossier 2 (§B1.1, lines 431–448) [repo].**
  - Under-merging with precision 1.0 and recall below 1: s205 predicted 36 against 34 entities, recall 0.970; s214 40
    against 36, recall 0.873 (source named: `results.jsonl` oracleDetails).
  - The grader's own cliff: s205 failed on `entitySlack 0.02` (2 extra entities out of 34) while fieldAccuracy was 0.979
    and pairF1 0.985.
  - The S/H v1 identity rule, `.../jit-claude-sonnet-5-5--claude-haiku-5-5/versions/v1-haiku55/solve.mjs:493-498`: names
    must satisfy `partDist(given)+partDist(family) <= 1` (OSA edit distance over rendering variants); then the DOB must be
    equal if both rows have one, otherwise the phone must be equal; then union-find over all pairs (lines 500–503). Every
    pair is decided link or non-link, with no abstain region.
- **Dossier 3 (§B3.1, lines 760–772) [M], records H/H arm.**
  - Label noise: 2 of the 7 interpreter deliveries were oracle-wrong, s202 at 0.973 (a warmup trace) and s205 at 0.981 (a
    deopt fallback); the dossier calls this "about 29% label noise" (BLOCKER-SYNTHESIS §6.3: 2 of 7).
  - 4 of 11 compiled outputs passed; the failing scores were 0.979, 0.985, 0.967, 0.773, 0.979, 0.711 and 0.704.
  - The v1–v3 BUILD-NOTES overrode the agent on 16, 9 and 17 `amount_usd` signs. That the override was correct is the
    dossier's inference, unchecked (BLOCKER-SYNTHESIS §6.3).
  - The Sonnet agent arm's per-seed pass string: `0100100010101000|11111111` (5/16 at d3, 8/8 at d4).
- **Dossier 4 (§0, lines 1058–1059; §B4.1 step 7, line 1084) [M].**
  - M2: `shapeKey` (`experiments/jit/router.mjs:16`) gives one key for records dev seeds 201–204 (d3) and 217–220 (d4), 8
    tasks, 1 key [M, scratch script].
  - M3: in the O/H records arm, v2's first d4 task (idx 16) was adjudicated wrong and became a regression; v3 was compiled
    with that single d4 case; v3's version profile marks only 1 of the 8 d4 tasks as novel, yet v3 silently missed 2 of its
    7 d4 deliveries (idx 17 and 22).
  - S/H v2 was adopted with `accepted: false` (exact 0.143, Opus fallback; `events.jsonl` idx 18), because rejection fires
    only on "not clean" or "fewer exact". It went 6/6 on d4.
- **Dossier 5 (§0, lines 1410–1415) [M unless tagged], kinetics compiles.**
  - N1: kinetics compile attempts, Haiku 6 (1 accepted, 3 clean) and Opus 5 (2 accepted, 4 clean); Opus fallbacks "not
    accepted" 3 of 5 times. These raw rejection counts stay recorded as a negative result even if BLOCKER-SYNTHESIS row 10
    later withdraws B6 as an artefact.
  - N2: the recurring per-case `partial = 0.533` is 16/30 leaves (O/H `v1-opus55` `perCase`, 0.533 ×3; BUILD-NOTES "differ
    by ≤1e-5 relative"). The reading that a numerically identical solver scores about 0.53 under exact `check-traces` is
    tagged [inference] by the dossier itself.
  - N3: the O/H v2 Haiku compile ($1.58, `compile.json`) was clean and numerically matched 4/5 traces, and argued its one
    real disagreement (trace-3) with a quoted SOP sentence. It was rejected only because its notes wrote "Trace-0, 2, 4
    differ by ≤1e-5" and the acceptance regex `\btrace-2\b` (`stream.mjs:172-181`) is case-sensitive and needs the literal
    token. The Opus fallback followed; idx 9 cost $3.51 in total.
  - N4: versions marked accepted delivered compiled passes 8/12 times (H/H v1 3/5, O/H v2 5/6, S/H v1 0/1); versions adopted
    although not accepted delivered 4/5 (O/H v1-opus 4/4, S/H v2 0/1). n = 17, so this only shows no visible signal.
  - N5: compiled cost per run spans $0.011 to $0.43 within one family and one compiler; Haiku-built H/H per-document judges
    cost about $0.23–0.25 per run, more than the Haiku agent's whole task ($0.088).
  - N6: the live semantic dispute is a scope question: does "Block read 23.7 °C during this read" exclude all nine wells of
    the read under SOP 2.4, or one? The two readings move one condition's Km by +2.8%, inside the 10% tolerance, but change
    the `excluded_samples` set, which the grader compares exactly (O/H v2-haiku BUILD-NOTES).
- **Dossier 6 (§0, lines 1760–1788) [M], tier-down of `rules` (D11).**
  - N1: `tierdown-e2e` re-samples every Haiku `vendex-*` judge on the variant side. Haiku's s208 pass→fail came from one leaf,
    `date_order.BRIGHTDESK` returned DMY where Opus said MDY despite the worked example in the notes; on the excluded s204
    Haiku also misread `ATLAS`. Sonnet's four pass→fail: s206 omitted the VENDEX void marker; s207 and s208 BRIGHTDESK date
    order; s209's `rules` value is identical up to marker spelling, and its failure (an unmerged "Matthias Krueger") is
    noise from re-sampled judges. The dossier's attribution: Sonnet loses 3 to the swap, Haiku 1. (BLOCKER-SYNTHESIS §3 C3:
    Haiku stays at 2 lost, because the committed JSON records s204's variant as a deopt; Sonnet 3 against 4 is unresolved
    because s209's attribution rests on lost traces. See the D11 erratum.)
  - N2: `rules` has about 15 decision units (3 date orders, 4 sign flips, about 7 void markers, the unreliable-update list;
    `versions/v1-haiku55/solve.mjs:262-301`). The `check` verifies only void-marker provenance; date order, sign flip, the
    unreliable list and void-marker completeness are unchecked. One date-order leaf governs 7–23 numeric birth dates per
    task.
  - N3: a $0 data check of the BRIGHTDESK and ATLAS date-order leaves. d3 (13 tasks, 26 leaves): decisive (margin ≥ 1) on
    25 of 26, all 25 agree with Opus; at margin ≥ 2, 23 of 23. d4 (8 tasks, 16 leaves): 11 of 14 agree; the 3 disagreements
    are ATLAS near-ties (3:4, 4:3, 4:7). The check catches all 3 observed cheap-tier date-order errors: s204 ATLAS 4:1
    against Haiku, s207 BRIGHTDESK 1:3 against Sonnet, s208 BRIGHTDESK 0:6 against both. Across 24 tasks the 61
    date-convention sentences take 36 distinct forms once digits are masked (a sentence-keyed cache would hit about 41%).
    (BLOCKER-SYNTHESIS §6.3: the check was designed with the three errors already known, so it is not out-of-sample.)
- **Dossier 7 (§B18.1, lines 2308–2317) [repo: `compile.json`, recomputed].** 21 compile records (8 roots, 13 recompiles)
  over 2 families, $44.30 of compile spend. No kinetics compile exceeded 0.547 mean partial agreement with its own traces,
  across 11 attempts and both builders. `hiddenPathAttempts` is nonzero on 11 of 21 compile records, 41 attempts in total
  (records H/H v3 alone: 17). (BLOCKER-SYNTHESIS §3: the record count is disputed, C6; the partial-agreement ceiling is an
  instrument artefact, C4; "contaminated" is not established, C7.)
- **Dossier 8 (§B12.1, lines 2484–2486) [repo].** Across all 21 archived compiled solvers, 0 import anything besides flow,
  model and `node:` modules. In the 10 records solver versions, `parseDate`, `osa`, `normPhone`, `namesMatch`, `linked`,
  `isoOf` and `parseLine` are each written 10/10 times, and `parseMoney`/`partDist`/`splitName` 7/10; the solvers are
  311–629-line monoliths.
- **Dossier 9 (§B10.1, lines 2853–2873; §B10b.1, lines 3076–3086) [repo].**
  - 252 stream rows across 12 arms in two families. First row 2026-10-08T23:37:03Z; 88 rows by 23:47:23 (about $19 at list
    price). Between 23:47 and 23:51, 74 faults, 71 of them `MODEL_RATE_LIMIT`. Next row 02:54:24: a 187-minute stall. Hour
    03 then wrote 117 rows.
  - The Haiku agent arms logged 19 fault rows (records) and 20 (kinetics), all inside 4 minutes.
  - Peak of 19 concurrent task rows, rebuilt from `at − latencyMs`.
  - Concurrency table: ≤ 6 in flight, 37 rows, 29/37 pass (78%), median latency 84 s; ≥ 10 in flight, 206 rows, 149/206
    (72%), 109 s. The dossier and BLOCKER-SYNTHESIS §6.3 both mark it confounded by task mix and arm; it is not causal
    evidence.

**D14. The kinetics dev stream `jit-dev-kinetics-1`, as far as it got (partial; JIT arms still running when the container
was destroyed; raw data lost).**

*Development evidence only, K = 1. No final numbers exist and none can be produced: `report.mjs` and `durability.mjs` have
no inputs (BLOCKER-SYNTHESIS, "What changed since the dossiers were written"). Everything below is a snapshot taken while
the JIT arms were still running.*

- **Setup** (`experiments/jit/configs/dev-kinetics-1.json`): dev seeds 201–216 at d4, then 217–224 at d5 drift. Arms: Haiku
  agent, Sonnet agent, JIT H/H, S/H and O/H (Haiku compiler, Opus compiler fallback). There was no Opus agent arm
  (BLOCKER-SYNTHESIS §1). The config ran `jit.compare: 'unordered'`, so the exact-comparison artefact of D7 applies
  throughout.
- **State at handoff** (HANDOFF §2 lines 59–60, §4 line 115): the JIT arms were still running; the data was said to be in
  `handoff/runs/jit/jit-dev-kinetics-1/`, which never reached git (see the docs/RESEARCH.md data-loss row).
- **Per-arm snapshot at 04:22 UTC** ([FRONTIER-GAPS.md](FRONTIER-GAPS.md) §0.1, lines 57–65, tag [M]):

  | arm | tasks | pass | $ | compile $ | $/success | compiled delivered (wrong) | deopts by kind |
  |---|---|---|---|---|---|---|---|
  | Haiku agent | 24 | 17/24 | 2.10 ($0.088/task) | — | 0.124 | — | — |
  | Sonnet agent | 24 | 17/24 | 7.40 | — | 0.435 | — | — |
  | JIT H/H | 12 | 8/12 | 12.09 | 9.63 | 1.51 | 5 (2) | judge 3, guard 1 |
  | JIT O/H | 17 | 15/17 | 17.82 | 11.56 | 1.19 | 10 (1) | guard 3, judge 1 |
  | JIT S/H | 8 | 4/8 | 15.59 | 13.94 | 3.90 | 2 (2) | guard 4 |

- **Other 04:22 observations** (FRONTIER-GAPS §0.2):
  - Wrong compiled outputs: kinetics 2/8 at 03:55, 5/17 at 04:22 (S1, lines 69–75).
  - Shadow disagreements on correct compiled answers: O/H s207 (03:55) and s214 (04:22) (S2, lines 83 and 86). Both
    adjudications ended unresolved and the correct compiled answer was delivered; FG reads these as the D7 exact-compare
    artefact. H/H s209 was also unresolved, and there the wrong compiled answer was delivered (S3, lines 98–99).
  - O/H shadows plus adjudication cost $1.80 against $1.11 of compiled runs (S5, line 130).
  - Compiled cost per run: H/H $0.13–0.43; O/H $0.011–0.016, or $0.16–0.33 for runs that escalated (S6, lines 136–137).
  - Compile spend alone was 4.6–6.6× the Haiku agent's whole 24-task stream ($2.10, 17/24). S/H made 6 compiled attempts: 4
    ended in guard deopts and 2 were wrong. O/H was the only kinetics arm ahead of the agents on pass rate, 15/17 against
    17/24 (S7, lines 142–145). FG records kinetics JIT as a dev-level cost negative (S7; §4.3).
  - Kinetics S/H's deopts were all of kind `guard` (S9, line 164).
- **HANDOFF summaries:** Haiku compiles are often rejected, and Opus fallback compiles cost $3–7 (§2, line 59). Input
  profiles: 2 of 13 false alarms on d4, and 8 of 8 d5 tasks flagged, including some signals that are not size (§4, line
  124). Durability: all kinetics arms (partial) were never durable (§4, line 131).
- **Compile measurements from dossier 5** (N1–N6, in D13): 11 compile attempts (Haiku 6, Opus 5) with their acceptance
  counts; the 0.533 = 16/30 partial-agreement artefact; the case-sensitive regex reject of the O/H v2 Haiku compile; n = 17
  on acceptance against delivered success; the $0.011–0.43 compiled-run spread; and the 23.7 °C scope dispute.
  BLOCKER-SYNTHESIS §3 C4 reads the partial-agreement ceiling as an instrument artefact and notes that compiled kinetics
  quality still varies by arm (O/H 9/10 correct, H/H 3/5, S/H 0/2, from the table above).
- **Compile cost figures measure different scopes** (BLOCKER-SYNTHESIS §3 C12: budget all-in). Do not compare them directly:
  - $0.27–2.19 per Haiku **records** compile: builder session only, from `compile.json` (dossier 7 E14-2 line 2291 and E18-2
    line 2423).
  - $2–4 per compile: a planning estimate for records compiles (dossier 1 E2-2, line 209: "D10: builder $2.25 plus gateway
    test runs").
  - $4.83 all-in for the records S/H arm over 3 attempts (v1 Haiku, the rejected v2 Haiku, the Opus fallback): builder
    $2.25, the builder's test runs through the gateway $2.16, host check $0.42 (D10).
  - Kinetics: Opus fallback compiles $3–7 each (HANDOFF §2); the O/H v2 Haiku compile $1.58 builder-only, and $3.51 in total
    at idx 9 once the Opus fallback followed (dossier 5 N3); per-arm compile totals at 04:22 of $9.63 (H/H), $11.56 (O/H)
    and $13.94 (S/H), all attempts of that arm (FG §0.1).
  - Both families: $44.30 over 21 compile records (dossier 7, D13).
  - Dossier 5 §B6.1's "kinetics compiles cost $3.2–8.1", cited to FG §0.1, is not traceable to that table
    (BLOCKER-SYNTHESIS §6.1).

**D15. The laptop sandbox could not run a single builder session until 2026-10-09 ~11:00 UTC; it now does, and it is
tighter than the cloud's.** Claude CLI 2.1.295 refuses `--permission-mode bypassPermissions` at uid 0, and
`unshare --map-root-user` made every session uid 0, so the first live smoke (bb81aff) died in 0.8 s with
`EXECUTOR_PROTOCOL`, $0 spent but **booked at the full $0.45 budget** (`costUnknown`). Two fixes in b018f5d
(`src/executors/claude-code.mjs` only): the generated script now ends in `exec unshare --user --map-user=<host uid>
--map-group=<host gid> claude …`, a nested user namespace that drops uid 0 *and* mount capability after the mount phase
(`IS_SANDBOX`/`CLAUDE_CODE_BUBBLEWRAP` are not used; inside, `mount` fails even after a further `--map-root-user`); and
`neverStarted = !result && !events.length`, so a CLI that emits no stream event costs $0 (under R0 the old rule would have
imputed $2 per retried attempt toward `spendStopUsd` with nothing spent). Same commit: the executor environment is an
allow-list (`executorEnv`), credential-like variable names inside the sandbox 27 → 0, variables 154 → 21, `/dev` 240 →
13 entries on a private tmpfs (`/dev/nvidia0` gone), `/var/log` masked, `~/.local/bin` 402 → 1 (`claude`), kept
binaries bound read-only by canonical path. Second smoke on the main tree: records s201 d3, Haiku, 8 turns, 7 tool
calls, 245 s, **$0.052, oracle pass 0.998**, `costUnknown false`. Kit hash moved 94c3360e18e2d0d3 → fb4154deec675f2a
(ENGINE-FREEZE re-stamp pending the last src change, S0-2 exact digests). Suites after the fix: core 1037 tests / 0 fail /
19 env skips; JIT 210 / 0 fail / 1 todo. Separate observation: the account's 5-hour meter went 0.22 → 0.44 during the
day with ~10 subagents and $1.4 of paid runs; subagent work on the owner's account, not the experiments, moved it.

**D16. The tolerant comparator is non-transitive, so adjudication's event trail depends on check order (row 50,
ec2d58d).** At relTol 0.01, L = 1.000 ≈ M = 1.009 ≈ H = 1.018 but L ≉ H. With compiled = L, shadow = H, adjudicator = M
both checks hold; "adjudicator ≈ compiled" runs first, so the compiled answer wins and no regression is recorded; the
reverse order would deliver the shadow's answer and record one. Across all 6 role assignments the *delivered* answer is
always the compiled one; only whether the shadow "agreed" (and so joins the compile pool) changes.
`experiments/jit/test/majority-order.test.mjs` pins the behaviour, with a `test.todo` for an order-independent rule.
`nversion.mjs` groups by exact canonical key and is order-independent.

**D17. Router wiring is parked: no v0 or v1 policy beats "agent every time" or a fixed JIT on either family (row 29,
dev replay, K = 1).** Records, net value V × passes − $: at V = 1 the best agent (Haiku) gives 12.54, the best fixed JIT
(S/H) 13.01, v0 in hindsight 12.54, v1 with free labels 10.55–10.96 (regret +1.6 to +2.5), v1 without labels ≈ 12.55 (it
cannot see quality and always buys the cheapest arm). At V = 10 the Opus agent (226.5) beats every router (v1 183.8–196.8).
Clairvoyant headroom over the best fixed choice is ≤ $2.16. Static C0 tops V ≤ 1 only because its build cost is
excluded. Limits: arm totals only, outcomes assumed independent across arms, kinetics JIT arms extrapolated from 8–17
tasks.

**D18. Agent-arm and JIT-role sessions were byte-equivalent in every config-controlled field except the working
directory, which named the arm and the role (row 23, ec2d58d → fixed in 3f80815).** Model, prompt (one sha across all
five sessions), schema, argv, env, timeout and workdir files were identical; the cwd `agent-<model>/iNNN-interpreter-…`
versus `jit-…/iNNN-shadow-…` was a systematic cue visible through `pwd` and absolute tool paths. Interpreter-family
sessions now run in `<work>/<experiment>/w/<sha12>` (sha over armHash:idx:role:rand; no hash moved; the `interpret` event
records `workdir`). Shared draws would replace at most 68% of records O/H spend, 36% S/H, 14% H/H, 10% kinetics S/H, 0%
kinetics O/H (19.8% of the whole records dev stream), but **$0 is realisable under the current PREREG**: its two streams use
different seed sets, so no (task, model) has a second agent draw. The bias rule if ever used: comparisons use the agent
arm's own draw d0 only; a JIT role consumes d1/d2.

**D19. Precedent on "same split signature" is not precedent on "same question" (row 28 certiorari pilot, $0, 10k
resamples).** On the stream's own unresolved set (s205, s206, s208, s210, s224) four tasks share one split and different
sides are right, so a precedent ruling harms ≈ 0.5 tasks per ruling even with a perfect human, and every policy fails the
dossier rule (≥ 2 prevented misses at budget 2, harm ≤ 1). Adding the four "one lineage answered, the rest refused"
cases (s217, s218, s220, s222) passes (+2.0–2.5 fixed per ruling) but only through that one structure, which code can
route to the interpreter without a human (the D9 class). Unanimous-and-wrong (s214) and majority-wrong cases are
invisible to any queue. Full version after R0 must match on decision units, not split signatures.

**D20. C0 rerun on regenerated dev 201–224: 15/24 (d3 13/16, d4 2/8), $1.18, versus D5's 16/24 (rows 3, 4, 7;
ba29a07).** Failures: s207 a misread balance sign; s208 and s214 read BRIGHTDESK dates as DMY (they are MDY), splitting
entities — so C0's s214 under-merge is an upstream date misread, not a name-distance near-miss, which bears on dossier 2
E1's falsifier; d4 reads one ATLAS date order for both regimes (s222 an over-merge). **Row 3 Stage 1** (dossier 6 N3's
date-order data check): on single-order leaves it was never wrong when it decided, 61/64 in sample and 63/64 out of
sample (249–272), 0 wrong; it flags both of C0's wrong single-order reads and 9/62 correct ones; d4 ATLAS switches order
at a dated cutoff, so one order per task is the wrong unit (4/8 agree as a whole, 13/14 and 14/14 split at the generator's
cutoff). **Row 4** (double-entry entity-count gap): AUROC for oracle failure 0.874, 95% CI [0.706, 1.000], survives the
< 0.7 kill rule, but difficulty alone gives 0.767 and within-difficulty 0.824; the DOB+phone blocking estimator alone is
0.663 (fails); neither estimator is an accurate count (MAE 2.6 and 5.4). **Row 7** (AST guard diff, `astdiff.mjs`,
acorn from Node's internals): 10/12 mutants flagged (deletions 4/5, widenings 6/7), 0/10 refactors, survives; misses two
plain-boolean edits; $0 replay from the journal shows 9/12 mutants are output-identical on these 24 tasks (the diff
catches 8 of those 9) and the phone-linking mutant the diff misses drops passes 15 → 6. Mutants were hand-written by the
tool's author; the false-alarm rate on real recompiles is unmeasured (the archived JIT version pairs are lost).

**D21. Replication prerequisites (rows 17 and 33, 21e9b5c): the conformance evaluator works at τ = 1 only; the corpus
has too few oracle-bearing variant families.** Row 17, effect-log conformance on the 5 pilots: tier I (per-item
"not a difference" declarations, 19–33 lines each, oracle-like work) detects 17/18 wrong classes and accepts 10/11 correct
ones, i.e. oracle v2 plus one miss (the n8n:12679 Berlin-midnight birthdays); tier G (generic normalisation) rejects every
correct class on two items; τ = 0.95 or "90% of cases exact" accepts wrong classes; the forged model tape (n8n:20281) is
invisible to any effect log. Kill rule does not fire. Row 33, census of 1,559 corpus items over 49 platforms: 67
variant families of ≥ 2, 18 of ≥ 3, and only 4 with ≥ 3 oracle-bearing members (WDL warp, Airflow Amazon system tests,
Kubeflow, Galaxy VGP); no cell reaches 10, so **the kill rule fires**; none of the 5 pilots sits in an oracle family. The
corpus is still the natural source of hand-curated complex workflows for the structural (W-bed) programme, as reference
graphs rather than as replication families.

**D22. A tiny Haiku judge call through the `claude-cli` ModelPort costs about $0.00011 and takes 1.4 s (20-call probe,
2026-10-09 12:40 UTC, $0.0022 total).** 20 live classification calls (4-way document kind, ~60-token prompt, 50-token
cap, portable schema) via `createModelPort` → `port.call` on the host's own login: 20/20 ok, mean $0.000110 per call
(range 0.000173–0.000175 for the first three, i.e. list price of the CLI's ~2.5K-token system prompt as a cache write
plus the question), mean latency 1,430 ms, 29 s wall at concurrency 2. This answers W-BED-R2R3-NOTES §7's open question:
the feared "$0.03 per call" overhead does not exist; a per-document or per-item judge map over 50 items costs about
$0.006, not $1.2–1.9. The binding constraint for fan-out is **latency** (1.4 s per call, serialised per concurrency
slot), not dollars, so R3/R6 designs should batch judgments for wall time, not for cost. Journal:
`/var/tmp/foundry-work/overhead-probe/journal.sqlite` (not committed).

**D23. Stage B (kinetics comparator gauge, live): relTol 0.05 stands; every wrong Haiku answer differs in the exclusion
set; R0 launched 2026-10-09 21:14 IST.** 48 sandboxed Haiku sessions on the 24 kinetics dev seeds 201–224 (n = 2;
`analysis/kinetics-gauge/out/stage-b/STAGE-B.md`, $4.49 actual over 55 attempts, 7 environment faults — 5 `MODEL_RATE_LIMIT`
at the owner's usage limit around 18:20 IST, 2 `EXECUTOR_PROTOCOL` — all resolved by the 21:12 refill, which skipped the 45
recorded sessions): 35/48 pass the oracle (d4 24/32, d5 11/16); 15 correct–correct pairs, **0 disagree at relTol 0.05**
(2 disagree at every t ≤ 0.02, both d5, cause "non-convergence/other", gone after the shared refit); 13/13 schema-valid
wrong answers differ from the reference in the exclusion set (0 same-set wrong answers at any distance), so with the set
compared exactly no wrong answer is a false agreement at 0.05; the closest same-set Stage A control stays 0.134. Decision:
`r0-kinetics.json` unblocked at `relTol 0.05` (`e565cb3`; arm hashes `1fde4626b169c84c` O/H, `2e292709027b2786` agent,
ENGINE-FREEZE §5). This is dev calibration under FG §4.1: the PREREG freeze adopts 0.05 either as the README precision
fallback or by O1; nothing here tightens it. Side findings: (i) passing answers sit 3.5–8.2% from the generating truth
(oracle box ±10%) while the reference sits within 4.9%, so a passing answer can be 3.8e-2 from the reference — the slack
the tolerance has to cover is reference-vs-agent, not agent-vs-agent; (ii) 29/48 answers are SOP fits printed at 4–6
significant figures, 3 are loose-optimiser fits (2 of them wrong), none used a non-SOP estimator. **R0 gates** (R0-RUNBOOK
§0) at launch: G1 re-verified (ENGINE-FREEZE §5: kit `a572eeee1ac237aa`, `src` and `experiments/lib` trees equal, `experiments/jit`
moved only by flow-v3 files, configs and test pins); G2 main 1038/0 fail, JIT 247 with one flow-v3 compat flake under load
(order-sensitive stderr comparison of concurrent judge lines; not in the R0 kit; fix queued); **G3 corrected**: the ledger
purpose `jit-r0` has `fresh: true`, so flipping 225–248 to `used` before launch makes `normalizeConfig` refuse the config —
the flip follows validation and is split per bed (records used, kinetics fresh for R0-K); G4 the 16:xx smoke on this
executor; G5 5h 0.32 / 7d 0.53; **G6 deviation**: 3 GB available + 14 GB swap free with the owner's three Kev training
processes (~3.3 GB) running — Stage B ran two sandboxed sessions under the same load without a fault, so R0 proceeds at
concurrency 2; G7 dirs present. R0 pair (`agent:claude-haiku-5-5`, `jit:claude-haiku-5-5/claude-haiku-5-5`) started
21:14 IST from `r0-launch.sh` under `env -i`; log `/var/tmp/foundry-work/r0-records-live.log`.

**D24. Pause 2026-10-09 night (owner: "pause all work after the immediate work, the deep analysis and the plans; we
resume next week"): R0 records pair final, W-bed R5, the L1-a/L6-a audit (both fail), library steps 1–4, prior art.**
State and plan: `PAUSE-20261009.md` (read first on resume). **R0 records pair** (`agent:claude-haiku-5-5` vs
`jit:claude-haiku-5-5/claude-haiku-5-5`, dev seeds 225–248, launched 21:14 IST, concurrency 2, no environment faults):
STOPPED BY THE OWNER at 23:1x IST (pause): agent arm finished 24/24 (14 pass); the JIT arm stopped at 12/24 (9 pass, one compiled miss on s231 at $1.69, no environment faults), so there is NO paired read, no export and no ledger flip (seeds 225-248 stay fresh). Resume with experiments/jit/resume-streams.mjs per R0-RUNBOOK; the run data is intact in /var/tmp/foundry-work/runs/jit-r0-records/. Nothing here is evidence. **W-bed R5** ("legacy dump", c3c4025): R4's group with one subsidiary's invoices replaced by a
legacy dump in one of 11 formats in three tiers (dev, wild, novel; novel only at d5 and split-specific); 34 controls;
the necessity control (dev-format parsers only) fails 14/20 at d2–d4 and 20/20 at d5; the verify predicate (trailer
with count, row-id sum, per-currency totals and code-point hash totals) has 0 misses in 1,100 + 400 wrong decodes, 16/1,100
without the hash totals; W-bed suite 127/127 (re-verified r5.test 25/25); eight deviations and eight engine needs for the
agent node recorded (W-BED-R5-NOTES §9–10; the engine needs are now in the slice 2 brief). **L1-a / L6-a audit**
(`design/library/AUDIT-L1.md`, 0d9d329, single auditor, fixed seeds): L0 + L1 explain **88.4%** of the corpus on 60
stratified hand labels (Wilson 75.0–95.1, Kish n 40.3), not 97.8% (which counted "not refused"); 96.1% if Node-RED
dashboard apps count as explained (owner decision); rule precision 0.73 (bar 0.85, falsifier < 0.75 met), all pairs 0.65,
recall 0.61; six support-only detectors below 0.5 precision (P02, P16, P17, P18, P30, P49) to remove, P37 mostly CI
push/PR starts (P38); L6-a 6/21 recorded failure causes named (28.6%), 15 lines proposed. Both negatives are in
PROOF-LEDGER D1/D9 and §H; the L1 revision is step 4 of the resume plan, before J1. **Library steps 1–4**
(`experiments/library/`, 88473c7, f22f1a3, 7a11979, 297c3f6, c278c31): store/index/cards/schema/tokens, the §5.2 cap
table as code (`assemblePrompt` refuses, never truncates), 12 cards with 36 fixtures through the real flow-v3 SDK and
call host in stub mode at $0, the composition checker (24 mutants, 18 codes); 63/63 tests (re-verified). Token bound
fitted on 1,243 real Haiku calls; **the L0 card measures 3,643 tokens against its 3,000 S6 allocation** (owner: cut
~650 or raise to ~3,700). **Prior art**: Anthropic's Managed Agents dynamic workflows decomposed
(`design/PRIOR-ART-MANAGED-AGENTS-DW.md`, e3660a4): one clash (frontier open program per task vs cheap closed-vocabulary
composition with evidence-gated reuse), arm (c′) proposed as the construction baseline (PROOF-LEDGER J4), bed R3′ (J5),
four engine mechanisms adopted into slice 2. Commit trailers of four agent commits were rewritten to the Fable 5.1 line
before the push (trees unchanged). At the pause nothing runs: no stream, no cron, no Monitor, no agents.

## 2026-10-14

**D25. Cloud dev streams, final state at the 2026-10-09 usage stop (data rescued 2026-10-14).**

*Development evidence only: dev seeds 201–224, K = 1, `jit.compare: 'unordered'`, prompt v1. The data that D13, D14 and D20 call lost was not
lost. The cloud container survived and still held `experiments/runs/jit/jit-dev-records-1/` and `jit-dev-kinetics-1/`: arm.json,
results/events/faults.jsonl, traces, every solver version with its compile.json, and one `journal.sqlite` of model calls per JIT and
static arm (7 journals, 5,792 calls, `integrity_check` ok). What is in git and what is still only in the container is listed in `research/jit-20261008/RESCUE.md`; the committed mirror is `research/jit-20261008/runs/jit-dev-{records,kinetics}-1/` (e623c5f). Everything below is $0 and made no
model call: `report.mjs`, `durability.mjs` and `eval-profiles.mjs` on a copy of the run files (`report.mjs` writes into the run dir, which would
have overwritten the 2026-10-09 interim reports), and one strict-memo replay (§3). Outputs and scripts are in
`analysis/cloud-dev-final/`. This entry supersedes the D13 header ("cannot be re-verified"), D14 ("raw data lost", "no final numbers
exist", the container "destroyed"), D20 row 7 ("archived JIT version pairs are lost") and WORKFLOWS-PAUSED §3 ("re-run, not resumed"); it
edits none of them. The journals were touched at 12:02Z on 2026-10-14 by another process in this container (their `-wal`/`-shm` files
were merged away, mtimes are new); copies were read, and the data is unchanged.*

**1. Final per-arm tables at the stop.** 24 planned tasks per stream (records d3 = seeds 201–216, d4 = 217–224; kinetics d4 = 201–216, d5 =
217–224). $ is measured list price. "Compile" = builder + gateway test runs + host check, including attempts in flight at the stop.
$/success = total $ over passes. "Burst" = the 23:47–23:52Z 2026-10-08 `MODEL_RATE_LIMIT` burst (78 fault rows over the 12 arms, cleared by the
~02:52Z resume; it left no task impaired).

Records: all seven arms finished.

| arm | done | pass (d3, d4) | total $ | $/success | compile $ (share) | deopts | shadows (disagreed) | adjudications | env faults | versions |
|---|---|---|---|---|---|---|---|---|---|---|
| Opus agent | 24/24 | 24/24 (16/16, 8/8) | 13.54 | 0.564 | – | – | – | – | 12 burst | – |
| JIT S→H | 24/24 | 22/24 (14/16, 8/8) | 8.99 | 0.409 | 4.83 (54%) | invariant 2 | 4 (2) | compiled 2, unresolved 0 | 1 burst | v1, v2 |
| JIT O→H | 24/24 | 18/24 (12/16, 6/8) | 7.53 | 0.418 | 2.07 (27%) | judge 2 | 4 (1) | interpreter 1, unresolved 0 | 1 burst | v1–v3 |
| static C0 | 24/24 | 16/24 (14/16, 2/8) | 1.21 | 0.076 | – | – | – | – | 0 | static |
| Haiku agent | 24/24 | 15/24 (9/16, 6/8) | 2.46 | 0.164 | – | – | – | – | 19 burst | – |
| JIT H→H | 24/24 | 14/24 (8/16, 6/8) | 8.12 (incl. 2.00 imputed) | 0.580 (0.437 without the imputed) | 4.34 (53%; 71% without the imputed) | judge 1, guard 1, invariant 2 | 4 (4) | interpreter 1, unresolved 3 | 1 burst | v1–v4 |
| Sonnet agent | 24/24 | 13/24 (5/16, 8/8) | 7.05 | 0.543 | – | – | – | – | 9 burst | – |

The H→H $2.00 is the adjudicator of s223 (idx 22), which hit `EXECUTOR_TIMEOUT` with `costUnknown` and is booked at its $2 bound
(`EXECUTOR_TIMEOUT` is not an ENV_FAULTS code, so no fault row); measured spend is $6.12. Compiled deliveries that passed: S→H 17/19, O→H
12/18, H→H 8/16 (v1 1/6, v2 3/4, v3 0/1, v4 4/5), static 16/24.

Kinetics: only the two agent arms finished (there is no Opus agent arm in this config).

| arm | done | pass (d4, d5) | total $ (rows + in flight) | $/success | compile $ (share) | deopts | shadows (disagreed) | adjudications | env faults | versions |
|---|---|---|---|---|---|---|---|---|---|---|
| Haiku agent | 24/24 | 17/24 (10/16, 7/8) | 2.10 | 0.124 | – | – | – | – | 20 burst | – |
| Sonnet agent | 24/24 | 17/24 (12/16, 5/8) | 7.40 | 0.435 | – | – | – | – | 12 burst | – |
| JIT H→H | **12/24** | 8/12 (8/12, –) | 20.66 (12.09 + 8.57) | 2.582 | 18.20 (88%) | judge 3, guard 1 | 1 (1) | unresolved 1 | 1 burst + 1 stop | v1 |
| JIT O→H | **19/24** | 17/19 (14/16, 3/3) | 21.99 (20.73 + 1.26) | 1.293 | 14.71 (67%) | guard 5, judge 1 | 2 (2) | unresolved 2 | 1 burst + 1 stop | v1–v3 |
| JIT S→H | **13/24** | 7/13 (7/13, –) | 21.49 (20.45 + 1.04) | 3.070 | 18.14 (84%) | guard 6 | 1 (1) | unresolved 1 | 1 burst + 1 stop | v1–v3 |

Pass rates are over the tasks done; unrun tasks are not failures. On the tasks each JIT arm completed, the Haiku agent passed 9/12, 13/19 and
10/13 and the Sonnet agent 9/12, 15/19 and 10/13, against H→H 8/12, O→H 17/19 and S→H 7/13. Paired, one stream, directional only: O→H is +4 of
19 against the Haiku agent (McNemar 4/0, p = 0.125) and +2 against the Sonnet agent (3/1, p = 0.63). No JIT arm reaches break-even against
either agent in kinetics. Integrity flags: nested model attempts 0 everywhere; hidden-path attempts are nonzero in 10 of 12 arms, mostly in interpreter
sessions (kinetics S→H 55, records S→H 14, records Opus agent 9, kinetics O→H 9); not reviewed here (BLOCKER-SYNTHESIS C7 stands).

**2. What changed against the interim tables.**
- **Records: nothing, for the six arms D10 and D12 report.** Their rows reproduce to the cent (S→H 22/24, $8.99, $0.409, compiles $4.83 =
  builder 2.25 + gateway 2.16 + check 0.42, shadows and adjudication $1.81, compiled $0.89, compiled 19 of which 17 pass, 4 shadows, 2
  disagreements, 2 adjudications to compiled; O→H 18/24, $7.53, $0.418, interpreter 2.31, compiles 2.07, shadows 2.20, adjudicator 0.64,
  compiled 0.31; the agent and static rows). **New: H→H**, which D10 and D12 omitted because it was still running (03:47Z interim report:
  8/16, $1.69). It finished at 04:45Z at 14/24, $8.12 against $2.46 for the Haiku agent, one pass fewer (discordant pairs 5/6, p = 1.0),
  after six passes in the last eight tasks (v4, built by a regression-driven recompile at idx 19, passed 4 of its 5 compiled deliveries).
- **Kinetics:** the D14 04:22Z snapshot reproduces exactly from the archived rows (agents 17/24 at $2.10 and $7.40; H→H 12 tasks 8/12; O→H 17
  tasks 15/17, $17.82; S→H 8 tasks 4/8, $15.59). Up to the stop: H→H gained no row (its idx 12 never finished; $8.57 of v3 compile attempts
  were in flight); O→H +2 rows (s218 and s219, both d5, passed by the interpreter after guard deopts), 17/19, $21.99; S→H +5 rows, 7/13,
  $21.49. Compile $ at 04:22 → final: 9.63 → 18.20, 11.56 → 14.71, 13.94 → 18.14, i.e. 7.0–8.7× the Haiku agent's whole stream (D14
  said 4.6–6.6×). Compiled deliveries (wrong): H→H 5 (2) and O→H 10 (1) unchanged, S→H 2 (2) → 4 (3). Shadow disagreements 3 → 4 (the new one is
  S→H s212, §3). Guard deopts: O→H 3 → 5, S→H 4 → 6. D14's headline stands: kinetics JIT is a dev-level cost negative (O→H $1.29 per
  success, 10.4× the Haiku agent's $0.124 and 3.0× the Sonnet agent's $0.435).
- **D13 spot-checks against the archive, all equal:** S→H/O→H split 5 / 1 (S-only s204, s208, s212, s218, s223; O-only s205); the Sonnet agent pass
  string `0100100010101000|11111111`; s205 36 vs 34 entities (recall 0.970, fieldAccuracy 0.979, pairF1 0.985) and s214 40 vs 36 (recall
  0.873); records H→H interpreter deliveries wrong at s202 (0.973) and s205 (0.981), and the first 11 compiled deliveries 4 passes with failing
  scores 0.979, 0.985, 0.967, 0.773, 0.979, 0.711, 0.704 (the arm now has 16 compiled, 8 pass); records O→H v3 silent misses at idx 17 and 22;
  kinetics O→H v2 Haiku compile $1.58 and idx 9 total $3.51; 88 rows and $18.96 by 23:47:23Z; the 187-minute stall to 02:54:24Z; the
  `eval-profiles.mjs` frozen profile reproduces HANDOFF §4 (kinetics 2/13 d4 false alarms, 8/8 d5 flagged; records 0/13 d3, 8/8 d4). D13 N1
  and N4 and dossier 7 have grown (§3). The totals are now 260 rows, 81 fault rows (all `MODEL_RATE_LIMIT`).

**3. Kinetics JIT findings.**
- **Compiles (events.jsonl, all 15 attempts; `report.mjs` misses the two H→H attempts of its unfinished idx 12).** Every attempt scored exact 0/N
  against its traces (D7); the best mean partial is 0.559 (S→H v3, Haiku; D13 dossier 7 said 0.547 over 11 attempts). *Haiku as builder:* 9
  attempts, 1 accepted (H→H v1, exact 0/3, partial 0.546), 4 not clean (host-check deopts, judge in all four, guard in one), 4 clean but not
  accepted (1, 4, 2 and 5 unexplained disagreements); $23.79. The Opus fallback fired after 6 of the 9 (every arm used its `maxFallbacks` =
  2): 6 attempts, 2 accepted, 2 clean but not accepted, 2 not clean (H→H v2 and v3, both rejected, so $9.23 of Opus compiles bought no new
  version); $24.22, $1.92–5.51 each. Adoption refuses only a not-clean attempt or one with fewer exact matches (D13 dossier 4), so of the 7
  versions adopted 3 were accepted and 4 were not (O→H v1 and v3, S→H v2 and v3). Compiled deliveries by adoption status: accepted 8/12
  passes, not accepted 5/7 (D13 N4 had 8/12 and 4/5): still no visible signal, n = 19. Records, same tool: Haiku 9 attempts, 8 accepted, 9 clean,
  $8.27; one Opus fallback ($2.48, not accepted, adopted). The "Haiku" H→H arm spent $9.23 on Opus compiles.
- **Cost.** Completed compile attempts cost $48.01 of the $64.13 the three JIT arms spent (75%); the compile ledger is $51.04 (80%), the rest being
  $0.73 on compiles a burst fault threw away (records: $0.48) and $2.30 on compiles in flight at the stop. Compiled runs cost $0.011–0.426 each
  (H→H 0.134–0.426, O→H 0.011–0.329, S→H 0.016–0.167). Compiled deliveries passed: H→H 3/5, O→H 9/10, S→H 1/4. Deopt rates over compiled
  attempts: H→H 44% (guard 11%), O→H 38% (31%), S→H 60% (all guard).
- **The D7 exact-compare shadows, rebuilt offline.** The dev streams ran before the tolerant comparator. Their 4 kinetics shadows all
  disagreed under exact comparison and all 4 adjudications were unresolved. A row keeps neither the compiled answer nor the comparison, so the
  archived `solve.mjs` of the version in force was replayed on each task through `run-compiled.mjs` with a strict memo port over only that
  run's journal rows (no live port: a miss throws `REPLAY_MISS`; 24 of 24 requests served, 0 misses, $0). Fidelity check: the replayed
  answer's oracle score equals the archived row's in all four (0.9722, 1, 1, 0.975). The shadow and adjudicator answers are in `traces/`.
  The decision is the stream's own rule (shadow agrees → done; else adjudicator ≈ compiled → compiled; else adjudicator ≈ shadow → deliver the
  shadow and record a regression; else unresolved) with `sameAnswer` in `tolerant` mode at relTol 0.05, absTol 1e-9, tolerantKeys vmax and km, the
  exclusion list exact (the R0-K config).

  | pair | compiled | shadow / adjudicator | max rel. diff compiled–shadow | exclusion lists | as run | relTol 0.05 | effect |
  |---|---|---|---|---|---|---|---|
  | O→H s207 (v1) | pass | pass / pass | 7e-6 | equal | unresolved | agree, no adjudicator | −$0.437; same answer |
  | O→H s214 (v2) | pass | pass / pass | 2e-8 | equal | unresolved | agree, no adjudicator | −$0.483; same answer |
  | H→H s209 (v1) | **fail 0.9722** | pass / pass | 0.012 | differ (HV-0314) | unresolved, wrong answer delivered | adjudicator sides with shadow: deliver shadow, regression | fail → pass; recompile pending (not simulated) |
  | S→H s212 (v3) | **fail 0.975** | fail 0.893 / fail 0.893 | 0.30 | differ (OB-0702) | unresolved, wrong answer delivered | adjudicator sides with shadow: deliver shadow, regression | fail → fail (0.975 → 0.893); the regression case would carry a wrong expected answer |

  (i) relTol 0.05 resolves 4 of 4 and decides exactly as 0.01 and 0.02 do on all four. The seven correct–correct pairs (both O→H triples and
  the H→H shadow–adjudicator pair) are all within 0.65%, so the Stage B result (D23: 0 of 15 correct–correct pairs disagree at 0.05, agent against agent) holds on seven more pairs of a
  different kind (compiled against interpreter), none disagreeing.
  (ii) The exact exclusion list is load-bearing: the wrong H→H s209 answer is 1.2% from the right one on the fitted numbers, inside every
  relTol ≥ 0.0124, and differs only in one excluded sample, so a numeric-only comparator at 0.05 would have called it agreement; both wrong
  answers differ in the exclusion set, as 13 of 13 did in Stage B. (iii) No tolerance fixes a wrong interpreter pair: in S→H s212 the Sonnet
  shadow and adjudicator agree to 3e-5 on the same wrong answer (common mode, D8), so the "adjudicated" delivery replaces a 0.975 miss by a
  0.893 miss and files it as the label for the next compile (D4, D19). (iv) The two correct compiled answers would have saved the O→H arm's
  whole adjudicator spend, $0.92 (4% of its stream). *Not computed:* the compile-time `check-traces` comparison. All 15 compile attempts scored
  exact 0/N and acceptance rested on "clean + named", so the Haiku acceptance rate (1 of 9) is confounded by D7; what a tolerant host check
  would have accepted needs the check outputs, which are not archived. R0-K (tolerant, strict acceptance, prompt v4) is where that gets
  measured.

**4. Durability** (`durability.mjs`, W = 6, ≥ 0.8; oracle view = delivered by compiled code and passing; system view also needs an answered
shadow in the window; the kinetics JIT arms cover only the rows done; agent arms have no compiled path).

| arm | versions (rows each) | deopt (guard) | silent miss | shadow disagree | durable, oracle: from / confirmed ($ cum.) / holds | durable, system |
|---|---|---|---|---|---|---|
| records S→H | 2 (15, 6) | 10% (0%) | 11% (2/19) | 50% (2/4) | 3 / 8 ($2.29) / yes, 1 relapse | 3 / 8 / does not hold |
| records O→H | 3 (3, 11, 7) | 10% (0%) | 33% (6/18) | 25% (1/4) | 18 / 23 ($7.53) / yes | 6 / 11 ($4.64) / yes, 1 relapse |
| records H→H | 4 (8, 6, 2, 5) | 19% (5%) | 50% (8/16) | 100% (4/4) | never | never |
| records static | 1 (24) | 0% | 33% (8/24) | – | 0 / 5 / no, 1 relapse | never (no shadows) |
| kinetics H→H (12 rows) | 1 (9) | 44% (11%) | 40% (2/5) | 100% (1/1) | never | never |
| kinetics O→H (19) | 3 (6, 8, 2) | 38% (31%) | 10% (1/10) | 100% (2/2) | 9 / 14 ($17.23) / no | never |
| kinetics S→H (13) | 3 (3, 3, 4) | 60% (60%) | 75% (3/4) | 100% (1/1) | never | never |

Reading: only the two best records JIT arms settle, and O→H's claim becomes knowable at idx 23, i.e. after the whole stream's cost; S→H
is confirmed by idx 8 at 25% of its cost but relapses. In kinetics only O→H had one oracle-durable stretch (idx 9–14, v2), which ended with a
silent miss at idx 15 (s216, 0.975) and the d5 drift (guard deopts on all three d5 tasks, none with a compiled answer). The system view never held there, so "never
durable" is a statement about 12–19 rows, not about the stream.

**5. Incomplete arms, and why.** All seven records arms and both kinetics agent arms are complete. The three kinetics JIT arms are not:

| arm | done | next task | fault (after the in-place retry) | what was running | unrun |
|---|---|---|---|---|---|
| H→H | 12 | idx 12 (s213, d4) | 04:49:58Z `MODEL_RATE_LIMIT` (8 rate-limited model calls inside the compiled run, retried once) | the v3 compile had just ended (rejected, 04:49:41Z); the first compiled run of the task failed | 12 (s213–s224: 4 d4, 8 d5) |
| O→H | 19 | idx 19 (s220, d5) | 04:50:24Z `MODEL_RATE_LIMIT`, compile builder | a recompile after the d5 guard deopts ($1.26 in flight) | 5 (s220–s224, all d5) |
| S→H | 13 | idx 13 (s214, d4) | 04:50:19Z `MODEL_RATE_LIMIT`, compile builder | a compile ($1.04 in flight) | 11 (s214–s224: 3 d4, 8 d5) |

The three independent processes failed within 26 s (04:49:58–04:50:24Z) and wrote nothing after. The fault rows say only `MODEL_RATE_LIMIT`
with empty stderr; the timing matches the account's usage stop (~04:52Z, WORKFLOWS-PAUSED) and the Stage B usage-limit signature (D23), so it
is read as the usage limit, which is an inference and not a recorded cause. By the stream's rule these are **faults, not failures**: no
outcome row was written ("stream stops at #N (resume continues it here)"), and the arm logs show each process exited on its own, so D14's
"container destroyed while running" is not what happened. Under the PREREG env-fault rule (more than 25% impaired = invalid) H→H (12/24) and
S→H (11/24 = 45.8%) would be invalid and O→H (5/24 = 20.8%) valid; that rule belongs to held-out runs, here it only measures what is
missing. H→H and S→H never reached the d5 drift segment; O→H saw 3 of 8 d5 tasks. In principle `resume-streams.mjs` continues all three
(state is in the last row's `stateAfter`), but the engine has moved since (E1 stamp: kit hash, `experiments/jit` tree, `compare` and prompt
version), so a resume would mix two engines; R0-K supersedes it as the kinetics measurement, and no decision to resume is made here. The
profile replay (`eval-profiles-*.md`) is saved and was not analysed further here.

**Consequences.** (1) The tolerant comparator behaves as D7 and D23 predicted on the 4 pairs, but its safety rests on the exact exclusion
list, and no relTol repairs a common-mode wrong interpreter pair: the interpreter's strength bounds shadow value (D2), and a regression
label taken from a shadow pair needs an independent check before it feeds a compile. (2) Records H→H completes D2's picture: a Haiku
compiler fed Haiku traces ends at parity with its own agent at 3.3× the dollars, with 50% silent misses. (3) The journals (5,792 calls)
and the 25 archived solver versions with compile.json make the $0 replays D20 and the tier-down work assumed lost possible again; the
shadow rebuild above is the first use.

**D26. M3, the reuse acceptance rule: the one-sided exact bound on parent-clustered counts is chosen. A perfect gate
now passes, but a good gate is decided only with about 300–360 admitted decisions (simulation, $0; ATTACK-20261014 §3
M3, PROOF-LEDGER K1).**

*Simulation only. No model call was made, and no gate or L4 data exist. Code: `experiments/lib/stats.mjs` (new exports
`clustersOf`, `kishDeff`, `kishEffectiveN`, `iccAnova`, `clusterDeff`, `binomPmf`, `binomCdf`, `betaInc`,
`exactBinomialBounds`, `reuseBoundRule`, `sprtDesign`, `reuseSprt`, `samplingPlanDesign`, `reuseSamplingPlan`,
`RHO_REUSE_FLOOR`; existing exports unchanged); `experiments/lib/reuse-rule-sim.mjs` (simulator, exact DP and
`decide`); tests in `experiments/lib/reuse-rule.test.mjs`. Output: `analysis/m3-reuse-rule/oc.{md,json}`
(`--reps 20000 --seed m3`; the Monte Carlo SE at 5% is ±0.15 points; two runs gave identical numbers).*

**1. Model.** Admitted reuse decisions cluster by parent, the offered task. Parent j has its own wrong rate
p_j ~ Beta with mean p and ICC ρ, and its m_j decisions are Bernoulli(p_j), so the model is beta-binomial. Every rule
corrects with Kish's Deff = 1 + (m* − 1)·ρ, where m* = Σm²/Σm and ρ = max(0.1, ANOVA ρ̂). The floor 0.1 is
`RHO_PREREG`'s value and is an assumption, since no reuse ICC has been measured. Counts enter as x/Deff of n/Deff. The
grid is p ∈ {0, 0.01, 0.03, 0.05} and ρ ∈ {0, 0.05, 0.1, 0.2}. The scenarios are L4 scale (96 parents × 6 = 576,
the L4 text's 24 × 4 × 6), with equal sizes, with unequal sizes (1–11, m* 7.83) and as 576 independent decisions;
a by-entry sensitivity (24 × 24); 180 decisions (30 × 6); and small n (10 × 6 and 60 × 1). Under the criterion,
false kill = P(not served) at p ≤ 0.01 (a no-decision also leaves reuse off) and miss = P(served) at p = 0.05.

**2. Every ATTACK figure reproduces** (exact, in the tests):
- 0/60 gives 0.0602 two-sided Wilson, and 0.0432 one-sided;
- 73 clean decisions pass the two-sided bound; 1 wrong passes at 110;
- the SPRT steps are +1.609 and −0.0412, with bounds ±2.944, and 72 clean decisions accept;
- the smallest α = β = 0.05 plan is n = 181, c = 4, with false kill 3.63% and miss 4.92%.

**3. Results at L4 scale** (false kill / miss, %). The independent row is exact; the other rows are simulated.

| rule | independent, n 576 | 96 × 6, ρ 0 / 0.05 / 0.1 / 0.2 | unequal sizes, ρ 0 / 0.05 / 0.1 / 0.2 |
|---|---|---|---|
| current (two-sided Wilson at ≥ 60, early kill, no Deff) | 0.3 / 1.8 | 0.2/1.7, 0.9/3.0, 1.7/4.2, 3.3/**6.6** | 0.3/1.8, 1.4/3.6, 2.7/4.8, 4.2/**7.9** |
| (a) one-sided Wilson | 0.0 / **5.06** | 0.0/1.8, 0.0/3.1, 0.2/4.3, 1.5/**5.7** | 0.0/1.2, 0.1/2.3, 0.6/3.2, 3.7/**5.1** |
| (a) one-sided exact (Clopper–Pearson) | 0.0 / 3.19 | 0.0/1.0, 0.0/1.9, 0.3/2.9, 2.1/4.6 | 0.0/1.2, 0.1/2.3, 0.8/3.1, 4.5/4.8 |
| (b) SPRT, LLR / Deff after each parent | 2.91 / 4.99 | 0.9/1.1, 2.0/2.1, 2.9/3.6, **5.3/7.1** | 0.9/0.7, 2.5/1.7, 4.2/2.7, **7.1/5.9** |
| (c) plan 181 / 4 in effective units | 3.63 / 4.92 | 2.2/1.2, 3.5/2.3, 4.6/3.3, **7.5/5.3** | 3.7/0.7, **6.0**/1.5, **8.3**/2.2, **14.2**/4.1 |

The mean number of decisions read at p = 0.01 is 576 for (a), about 180–210 for (b) and 277–335 for (c). L4 scores every
offer offline (memoised across arms), so the SPRT's early stop saves nothing there.

**4. Decision under the section's rule.** The procedure is `decide` in the simulator:
- *Binding cells:* every L4-scale parent-clustered cell at ρ ≤ 0.1 meets the criterion (equal and unequal sizes), and
  the independent limit meets it exactly.
- *Tie-break:* the most robustness cells met, then the lowest worst false kill. The robustness cells are L4 scale at
  ρ 0.2, the by-entry sensitivity and the 180-decision scenario.

Results:
- (a)-Wilson fails the binding cells by 0.06 points: its exact miss is 5.06% in the independent limit. A one-sided 95%
  bound misses about 5% at p = 0.05 by construction, and Wilson's discreteness lands just above.
- (c) fails with unequal parent sizes (false kill 6.0% at ρ 0.05, 8.3% at ρ 0.1).
- (a)-exact and (b) pass. (a)-exact meets 3 of 10 robustness cells: both L4 cells at ρ 0.2, and by-entry at ρ 0.
  (b) meets 0. Clustered parents arrive in lumps that push the SPRT across its kill boundary, and its truncation
  bites when Deff is large.

**Chosen: (a) with the exact bound.** LIBRARY-TESTS L4 "Decision" is amended to it, as are the "Claim" and "Falsifier"
lines that quote the bound. The replaced text is quoted in place, dated 2026-10-14. L4 drops the early kill.

**5. Small n.** No rule meets the criterion below about 300 admitted decisions:
- At 10 × 6 = 60, nothing ever serves: n_eff = 40 at Deff 1.5.
- At 30 × 6 = 180, the false kill is 11–43% across rules and ρ (100% for (c), which never reaches n_eff 181), and
  28–37% for (a)-exact.
- In parents of 6, (a)-exact first meets the criterion at 50 parents (300) at ρ 0, 60 (360) at ρ 0.1, and 96 (576)
  at ρ 0.2. At ρ 0, (a)-Wilson already meets it at 40 parents (240).

A perfect gate is served from 59 effective decisions (0/59 → 0.0495), which is 60 independent decisions or about 89
in parents of 6. That is K1's title claim. "A good gate is served 95% of the time" needs the larger numbers above.

**6. The current rule is not broken at L4's full scale.** At 576 admitted decisions it meets the criterion for
ρ ≤ 0.1. Its defects are the minimum it names (60, where 0/60 fails) and the missing clustering correction (miss 6.6%
and 7.9% at ρ 0.2).

**7. Deviations and limits.**
- (a)-exact and the `decide` procedure were added after the first grid run, at the design stage, before any L4 data.
  Under the three rules exactly as ATTACK wrote them, only (b) passes the binding cells.
- Two exploratory runs (10,000 draws, scratchpad scripts, not committed):
  - a ρ̂ > 0.2 → no-decision trigger was rejected: false kill 9.9% at ρ 0.1;
  - raising the floor to 0.15–0.2 helps (a) at ρ 0.2 but not (b). It costs false kills at 180 decisions and in the
    by-entry case.
- At ρ 0.2 with unequal sizes, (a)-exact's 4.5% / 4.8% is within 2 Monte Carlo SE of 5%.
- If wrong reuse clusters by library entry (24 × 24), every rule fails at ρ ≥ 0.1, and (a)-exact already at 0.05
  (false kill 5.9%). L4's Deff counts parents only; crossed parent × entry clustering is not modelled.
- LIBRARY §9's live kill (`LIBRARY.md:474`) is not amended. Live use is sequential, so the one-shot bound does not
  transfer.

**Consequences.**
1. A perfect gate can now pass L4.
2. Deciding a good gate needs about 300–360 admitted decisions in parents of ≤ 6. A selective gate admits far fewer
   than the 576 offers (a perfect one admits at most one own-rung solver per task, plus near-misses and other-rung
   entries that happen to pass [I]), so
   L4 as seeded will most likely report a bound and "no decision" for a good gate. More parents is a seed-allocation
   decision for the orchestrator.
3. The reuse ICC is the unknown that sets the rule's validity. L4 should report ρ̂ with a cluster-bootstrap interval
   beside the decision.

**D27. M2, priced verification: the PREREG H1 cost claim against the Haiku agent is withdrawn for kinetics, and for
records with the engine as built. No arm, tier or rate beats the Haiku agent per success over a 24-task stream
($0; ATTACK-20261014 §3 M2, PROOF-LEDGER K2).**

*Development evidence only (dev 201–224, R0 records 225–236, K = 1). No model call was made. Code:
`experiments/jit/verify-economics.mjs`, with tests in `experiments/jit/test/verify-economics.test.mjs` (12/12). Outputs:
`analysis/verify-economics/out/{tables.generated.md,verify-economics.json}`. Inputs: the committed exports
`runs/jit-dev-records-1`, `jit-dev-kinetics-1` and `jit-r0-records`. Archived shadow and adjudicator answers were
re-scored with the bed oracles; 189 of 189 archived answers re-score to identical oracle details.*

**1. Model.** Costs are per post-warmup task (idx ≥ 3), at three levels:
- L0 is compiled runs only (the ATTACK's steady state).
- L1 adds deopt fallbacks to the interpreter. This is the rule's steady state.
- L2 adds the recompiles measured in the window.

Verification is rate × (compiled-ok share) × (shadow $ + P(disagree) × adjudication $). Shadows are drawn only on
compiled-ok deliveries. There are three tiers:
- *interp*: the arm's interpreter, as `stream.mjs` runs it. Its costs and P(disagree) come from the as-run shadows.
- *haiku*: the Haiku agent arm's own answer on the same seed. This tier needs an engine change.
- *witness* (kinetics only): the excluded-sample set checked against the reference. It is a ceiling, because no run-time
  code can derive that set.

Agreement is read from the oracle details, because compiled answers are not archived. On the 346 archived answer pairs
that share a seed, the proxy's "disagree" was always a real disagreement (163 of 163). Its "agree" is right 89 of 93
times; the 4 misses make P(disagree) about 5% low on records, in the JIT's favour.

**2. Results at the 25% floor, L1, $ per task, against the Haiku agent** (records $0.1027, kinetics $0.0876, R0
$0.1039).

The engine as built (interpreter shadows with adjudication):

| arm | records dev | kinetics dev |
|---|---|---|
| S→H | $0.1805 | $0.2508 |
| O→H | $0.2183 | $0.3181 |
| H→H, the negative control | $0.0788 | $0.2442 |

R0 H→H costs $0.0438.

Break-even rates against the Haiku agent on records are 6.0% (S→H) and 7.0% (O→H) with adjudication, and 9.0% and 9.1%
without. The ATTACK's "never at the floor" holds with deopt fallbacks included.

With Haiku-agent shadows on records:
- O→H with Haiku adjudication costs $0.0966 and beats.
- S→H beats only without adjudication: $0.1008.

Kinetics:
- Compiled runs plus fallbacks already cost $0.195–0.250 before verification, so nothing beats.
- That includes the $0 witness ceiling, at $0.24–0.28.

At L2 no records setting beats either; the cheapest costs ≥ $0.1439. The ATTACK's P6 numbers reproduce from the rows:
- S→H: $0.1284, 18.75% and 12.3%, horizons 186 and 458 (the ATTACK has 464);
- O→H: $0.150, 15.5% and 12.2%, horizons 68 and 143 (the ATTACK has 145).

**3. The 24-task stream (H1's unit).** Warmup, compiles and 21 tasks at L1 at the floor give a best cost per success of:
- records: $0.29 (O→H with Haiku shadows and no adjudication) and $0.42–0.45 with the engine as built, against $0.164;
- kinetics: ≥ $0.93, against $0.124.

The records S→H compiles alone cost $4.83, against the Haiku agent's whole stream at $2.46.

Restated against the Sonnet and Opus agents, the engine as built at the floor beats both on records:
- per task: $0.18–0.22, against $0.29 and $0.56;
- per success over 24 tasks: $0.42–0.45, against $0.54 and $0.56.

It does not beat them per success on kinetics. Success parity with Opus fails: 22 and 18 of 24, against 24.

**4. System view (the kill mode).**
- R0's realized floor sampled 5 of 9 deliveries (idx 3, 5, 6, 8 and 11).
  - Its one system "wrong" (s230) was a correct compiled answer, overruled.
  - Its one truly wrong delivery (s231) shipped unresolved.
  - The Wilson upper bound is 62%.
- At 24 tasks and a 25% floor, the bound is 39–62% even with 0 detected. It reaches about 15% near 1,000 tasks.
- It never falls below the measured detectable-wrong rate: 10.5% for S→H, 22–33% for O→H, 50% for dev H→H.
- So a slider bound of B ≤ 10% is infeasible for every arm.

**5. Other findings.**
- R0 shadowed 9 of 9 compiled runs, because every run raised flags under `shadowOnFlags`. Its effective rate was 100%,
  not 25%. At 100%, R0 H→H costs $0.1180 per task, above the Haiku agent.
- On records the exact 'unordered' comparator drives adjudication, because most disagreements are false alarms on
  correct answers: 6 of 7 in R0. Even a comparator with no false alarms leaves S→H with interpreter shadows at $0.153.
- CSP-1 at the measured false-alarm rates on records (φ 42–100%) inspects about 100% of deliveries.
- The kinetics exclusion set differs from the reference in 6 of 6 wrong compiled deliveries, but in only 24 of 28 wrong
  answers overall. The misses are the Haiku agent on s216, the Sonnet agent on s220, and the s212 shadow and adjudicator
  pair. So the witness is not complete for interpreter answers (K3, K4).

**6. Deviations.**
- The rate applies per compiled-ok delivery. The ATTACK applied it per task; its convention is reproduced separately.
- The dev streams' random floor is emulated with `shadowDrawOf(experiment, idx)`. Only R0 logged draws.
- The kinetics JIT arms are truncated at 12, 19 and 13 rows. Compiles in flight at the stop are excluded.
- `sameAnswer` and `shadowDrawOf` are replicated, because `stream.mjs` is under concurrent edit. The test reproduces R0's
  logged draws.

**7. Not done.**
- R0-K: not run.
- Real-comparator replays of compiled answers: this needs `run-compiled.mjs`, which is under concurrent edit.
- A reliability claim at a declared W: K11 is open.

**Consequences.**
1. Withdraw or restate PREREG H1's cost sentence before the freeze. Restate it against the Sonnet and Opus agents, or as
   a long-stream steady-state claim that names its shadow tier and comparator.
2. R0-K's flag-forced shadows make the floor's cost assumption moot.
3. The next $0 lever to price is a records comparator at the oracle's own thresholds plus a Haiku-agent shadow tier. Both
   are engine changes.
