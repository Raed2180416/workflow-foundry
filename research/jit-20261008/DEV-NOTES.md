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

**D9. A heal can remove the ability to refuse, which turns deopts into silent failures on drift.**
- Observation: Opus-arm v2 was recompiled to fix the over-strict `vendex-entries` check (D3). In the N-version probe it never deopted (24/24 answered, 15 correct). On the d4 drift tasks it answered and failed 5 of 7. Its predecessor v1 and the other solvers refused most d4 tasks. In the live stream, v2's first d4 task was wrong and a shadow caught it (adjudicated, regression recorded).
- Mechanism: reject-if-worse compares only old labelled cases, so it cannot see a guard that has been widened.
- Consequence: a recompile also has to replay every input on which the previous version deopted, and every guard-triggering input in the trace pool. Each must either still deopt or now match the interpreter's answer. Otherwise the version is rejected. A recompile must not silently widen the input domain.

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

**D12. The Opus-interpreter / Haiku-compiler records arm is complete: 18/24 (d3 12/16, d4 6/8), $7.53, $0.418/success.**
- Delivered by: compiled 18 (12 pass), interpreter 5 (5 pass), adjudicated 1 (1 pass).
- Cost: interpreter $2.31, compiles $2.07, shadows $2.20, adjudicator $0.64, compiled runs $0.31 (about $0.017 per run).
- It did worse than the Sonnet-interpreter arm (22/24), even though Opus is the stronger demonstrator. Two causes: its v1 judge check was over-strict (D3), and its v2 heal widened a guard (D9), which led to 5 silent compiled misses on d4 and under-merging misses on d3 (D1).
- Reading: with one compile lineage per arm (K = 1), compile variance and what each heal does dominate interpreter strength. Three things follow:
  - the held-out round needs K ≥ 2 streams per arm;
  - the v2.2 domain-preservation check (D9) is required;
  - compile ensembles (several Haiku compiles, voting or disagreement-triggered shadows, D8) are a direct way to reduce lineage variance.
