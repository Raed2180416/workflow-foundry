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
