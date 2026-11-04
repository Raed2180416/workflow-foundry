# SOP-Bench phase 2 result: build-once workflows on sealed rows, read by DESIGN §7

> **DRAFT, not yet adversarially verified (2026-11-04).** Written by one agent on 2026-10-28; the two independent verifiers and the fix pass stopped on a usage limit. Numbers were recomputed by the writer from aggregates only; treat them as unverified until the verification pass lands.

*2026-10-28. Design and preregistration: `DESIGN.md` (§7 decision rule, §8 ablation, §13 as built). Frozen in
`FREEZE-p2.json` (sha256 `14effe18…`), committed in 5a8c6603 at 2026-10-21 13:32Z, before any sealed row was prepared.
The split is `SPLIT.json` (`1d957beb…`), and phase 1 with its dev baseline is in `NOTES.md`. **The primary run is sealed,
claim-bearing evidence, read by the frozen rule.** It covers 12 SOPs and 1,693 sealed rows, with k = 3 and both arms
interleaved per row. **The three cells (V1-minimal, V2-bloated, patient_intake) ran on sealed rows with frozen
workflows, but no rule decides them.** They are reported against their stated purpose, and every comparison of a cell
with the primary is read post hoc. The build numbers are development evidence: dev rows are training data. Every number
is recomputed by a $0 script from the committed aggregates (`runs/*/summary.json`, `runs/*/failures.json`,
`runs/*/build-summary.json`) and the freeze. The one exception is the bootstrap intervals, which need row-level records;
those are quoted from the summaries, where `analyse()` (`experiments/sopbench/sealed.mjs:64`) computed them. No per-row
record was opened for this file.*

## 1. Summary

1. **By the frozen rule, the build-once workflows beat the per-row agent and are cheaper, but the 90% reliability claim
   is not met.** W-H, the frozen Haiku-built workflows, reaches a macro strict pass^3 of 87.6% [85.6, 89.5]. A-H, the
   Haiku agent working per row, reaches 67.1% [64.8, 69.4]. W − A is +20.5 points, with a paired 95% interval of
   [+18.1, +23.0].
   - The reliability clause fails on its point estimates: 87.6% < 90%, and 88.0% < 90% without the orchestration-only
     SOP. Both 95% lower bounds clear 85%.
   - By §7.4 the "90%+ reliable" claim is therefore not supported. This is a negative result for that clause.
2. **W is almost deterministic, and its failures are all wrong labels.** Only 1 of its 1,693 rows changed outcome
   across the three runs; the agent had 169 such rows.
   - W's pass@1 (87.7%) is close to its pass^3. The agent's pass@1 of 72.5% falls to 67.1% at pass^3.
   - All 536 failing W runs are wrong values. There was no deopt, crash, timeout, malformed answer or missing column.
3. **The macro hides a split by SOP.** W reaches 90% on 6 of the 12 SOPs and loses to the agent on two:
   order_fulfillment (−8.7 points) and traffic_spoofing_detection (−8.3). On warehouse_package_inspection both arms
   score about 50%.
   - Three of the six SOPs below 90% are the three workflows that had already missed dev rows before the freeze.
   - Dev rows overstated the workflows: 96.3% macro on dev rows against 87.6% sealed.
4. **Cost.** W cost $2.67 to build the 12 primary workflows, plus $0.10 of judge calls in the sealed run. That is
   $0.00055 per run amortised, against $8.62 for the agent, or $0.0017 per run: 3.1× cheaper per run.
   - The "$0.10 vs $8.62" in commit e801255f's message are the two arms' totals over 5,079 runs each. They are not
     costs per row.
   - Phase 2 recorded $14.02 in all, against a $100 cap.
5. **The cells show large W − A gaps but do not show a distractor effect.**
   - **V1-minimal** gives video_annotation only its 6 real tools. W scores 98.1% and A 38.1%. Against the primary's
     26-tool video_annotation, bloated − minimal is +1.0 point for W (1 row) and −4.8 points for A (5 rows). A's
     direction matches upstream's, but the difference is well within noise.
   - **V2-bloated** adds 20 distractor tools to each of three SOPs. W scores 89.2% and A 65.0%, so W − A is +24.2
     [+15.8, +32.5]. The preregistered comparison with the primary on the same 120 rows is in no aggregate, so the V2
     distractor effect is unknown here.
   - **patient_intake** scores 100% for W and 48.0% for A. It is an orchestration-only SOP.
6. **The run history.** There were 11 stops on environment faults (9 in the primary, 2 in V2-bloated; 26 fault
   records), 3 process kills and 16 resumes.
   - V2-bloated stood still for 6 d 10 h because the account hit its weekly usage limit (D31).
   - No frozen file changed.
   - The CLI binary is not frozen, and no summary records its version. Other records put three patch versions inside the
     run window (§7).

## 2. What ran

| run | cell | SOPs | sealed rows | runs (W + A) | ran (UTC) | env-fault records | spend (cap) |
|---|---|---|---|---|---|---|---|
| `p2-sealed` | primary | the 12 of §6 | 1,693 | 10,158 | 2026-10-21, after the freeze commit, to 10-22 03:59Z | 23 | $8.7294 ($40) |
| `p2-abl-v1-sealed` | V1-minimal | video_annotation, 6-tool catalog | 105 | 630 | 10-22 03:59–04:23Z | 0 | $0.7421 ($5) |
| `p2-abl-v2-sealed` | V2-bloated | dangerous_goods, customer_service, know_your_business, +20 distractors each | 120 (40 each, seeded subsample) | 720 | 10-22 04:23Z to 10-28 18:06Z | 3 | $0.7484 ($5) |
| `p2-pi-sealed` | patient_intake | patient_intake | 50 | 300 | 10-28 18:06–18:29Z | 0 | $0.2659 ($5) |

**The arms** (DESIGN §1, the freeze's `arms`):

- **W-H** runs the frozen `solve.mjs` of the SOP in `runSandboxed` with the network off. It reaches the tools through
  the bridge mailbox, makes at most 40 tool requests and has $0.05 of judge budget and 180 s per run. It calls a
  `claude-haiku-5-5` judge only where the code chose `flow.judge`.
- **A-H** is the phase-1 agent, unchanged: one `claude -p` session of `claude-haiku-5-5` per run, with Bash only, 10
  tool steps, $0.25 per session and 10 minutes.

Within each run the arms are interleaved per row and fork, W first on even forks and A first on odd ones.

**The workflows and their builds** are development evidence: dev pass counts are on training rows. One Haiku 5.5 builder
session per SOP was followed by at most two repair sessions. Build cost covers the sessions, the builder's judge calls
and the host checks.

| SOP | build run | dev pass (build + repair rows) | kept round | sessions | build $ |
|---|---|---|---|---|---|
| aircraft_inspection | p2-main | 20/20 (5 + 15) | 1 | 2 | 0.2038 |
| customer_service | p2-pilot | 20/20 (5 + 15) | 1 | 2 | 0.2469 |
| dangerous_goods | p2-pilot | 20/20 (5 + 15) | 0 | 1 | 0.0280 |
| email_intent | p2-pilot | 20/20 (5 + 15) | 1 | 2 | 0.0862 |
| know_your_business | p2-main | 20/20 (5 + 15) | 2 | 3 | 0.6672 |
| order_fulfillment | p2-main | 7/7 (5 + 2) | 1 | 2 | 0.0581 |
| referral_abuse_detection_v1 | p2-main | 20/20 (5 + 15) | 0 | 1 | 0.0582 |
| referral_abuse_detection_v2 | p2-main | 20/20 (5 + 15) | 0 | 1 | 0.0824 |
| traffic_spoofing_detection | p2-main | 15/20 (5 + 10) | 0 (both repairs rejected) | 3 | 0.4804 |
| video_annotation | p2-main | 20/20 (5 + 15) | 1 | 2 | 0.1865 |
| video_classification | p2-main | 19/20 (5 + 14) | 1 | 3 | 0.1964 |
| warehouse_package_inspection | p2-main | 17/20 (5 + 12) | 1 | 3 | 0.3727 |
| **12 primary workflows** | | macro 96.3% of dev rows | | 25 | **2.6666** |
| V1-minimal video_annotation | p2-abl-v1 | 20/20 | 0 | 1 | 0.1920 |
| V2-bloated dangerous_goods / customer_service / know_your_business | p2-abl-v2 | 20/20 each | 0 / 0 / 1 | 4 | 0.0370 / 0.1886 / 0.2608 |
| patient_intake | p2-pi | 16/16 (5 + 11) | 0 | 1 | 0.1889 |

No build failed and no session had an error. The builder made a judge-call path in three primary workflows (a static
check of `experiments/sopbench/frozen/p2/`):

- email_intent calls the judge on every row: `5.2-intent`, plus a description match.
- aircraft_inspection calls it only for free-text conditions that its code does not match (`solve.mjs:70`).
- video_classification calls it only for moderator-note categories that its code does not cover (`solve.mjs:71`).

On dev rows only email_intent called the judge (1.2 calls per run). The sealed summaries do not split judge calls or W
cost by SOP. No cell workflow has a judge path, and every cell's W cost is $0.

## 3. The primary, read by the frozen rule

*Evidence: sealed rows, frozen split, frozen workflows and code, and the preregistered rule.*

### 3.1 The rule and its evaluation

DESIGN §7, verbatim:

> Primary metric: **strict pass^3**, per row 1 if all 3 runs pass strictly; per SOP the mean over its sealed rows; headline
> the **macro mean over the valid SOPs**. Uncertainty: a bootstrap over rows within SOPs (10,000 resamples, seed fixed), and
> for W − A a paired bootstrap on the same rows.
>
> 1. **Reliability claim** ("build-once Haiku workflows are 90%+ reliable on SOP-Bench's recurring procedures"): W-H macro
>    strict pass^3 ≥ 0.90 **and** its 95% lower bound ≥ 0.85, and the same holds with the orchestration-only SOPs removed.
> 2. **Versus the agent**: W-H − A-H ≥ +0.05 macro strict pass^3, paired 95% interval excluding 0.
> 3. **Cost**: amortised cost per sealed run of W-H, (build + repair + sealed runs) / runs, below A-H's mean cost per run.
> 4. Otherwise the claim is not supported, and the numbers, the per-SOP table and the failure anatomy go to NOTES and
>    docs/RESEARCH.md as a negative result. […]

The frozen code of the rule, `experiments/sopbench/sealed.mjs:107–113`, verbatim:

```js
export function decide(an, anNoOrch, w) {
  const W = an.arms.W, A = an.arms.A;
  const rel = W && W.macroPassK >= 0.9 && W.ci95[0] >= 0.85 && anNoOrch?.arms.W?.macroPassK >= 0.9 && anNoOrch?.arms.W?.ci95[0] >= 0.85;
  const vsAgent = W && A && an.wMinusA.macro >= 0.05 && an.wMinusA.ci95[0] > 0;
  const cost = W && A && w?.amortisedPerRunUsd !== undefined ? w.amortisedPerRunUsd < A.costUsd / Math.max(1, A.runs) : null;
  return { reliabilityClaim: Boolean(rel), beatsAgent: Boolean(vsAgent), cheaperThanAgent: cost };
}
```

Applied to `runs/p2-sealed/summary.json`. The orchestration-only set is the freeze's `orchestrationOnly`, which is
aircraft_inspection.

| clause | condition | value | holds |
|---|---|---|---|
| reliability | `W.macroPassK >= 0.9` | 0.8764 | **no** |
| | `W.ci95[0] >= 0.85` | 0.8560 | yes |
| | without orchestration-only: `macroPassK >= 0.9` | 0.8800 | **no** |
| | without orchestration-only: `ci95[0] >= 0.85` | 0.8584 | yes |
| | → `reliabilityClaim` (all four) | | **false** |
| versus the agent | `wMinusA.macro >= 0.05` | 0.2049 | yes |
| | `wMinusA.ci95[0] > 0` | 0.1805 | yes |
| | → `beatsAgent` | | **true** |
| cost | `amortisedPerRunUsd < A.costUsd / max(1, A.runs)` | 0.000545 < 0.001698 | yes |
| | → `cheaperThanAgent` | | **true** |

**How the values were obtained:**

- The macros are the means of the per-SOP pass^3: 12 SOPs, or 11 without aircraft_inspection.
- The amortised cost is $2.6666 of primary builds (`p2-pilot` $0.3611 + `p2-main` $2.3055, equal to the freeze's
  `arms.W.buildCostUsd`) plus $0.1019 of W judge spend, divided by 5,079 W runs.
- The agent's cost per run is $8.6226 / 5,079.

The summary's own `decision` is `{"reliabilityClaim":false,"beatsAgent":true,"cheaperThanAgent":true}`, the same.

**Reading:** W beats the agent and is cheaper. The 90% reliability claim is **not supported**, and §7.4 makes it a
negative result for that clause. It fails on the point estimates, not on the intervals.

### 3.2 Per SOP

Pass^3 shows the share of rows, with the number of rows passing all three runs in parentheses. Upstream@1 is upstream's
lenient metric, reported beside the strict one as §7.4 asks.

| SOP | sealed rows | dev pass (training) | W pass^3 | A pass^3 | W − A | W pass@1 | A pass@1 | A upstream@1 |
|---|---|---|---|---|---|---|---|---|
| aircraft_inspection (orchestration-only) | 92 | 20/20 | 83.7% (77) | 45.7% (42) | +38.0 | 83.7% | 46.4% | 46.4% |
| customer_service | 136 | 20/20 | 94.1% (128) | 60.3% (82) | +33.8 | 94.1% | 78.9% | 78.9% |
| dangerous_goods | 254 | 20/20 | 97.6% (248) | 89.4% (227) | +8.3 | 97.6% | 95.0% | 95.0% |
| email_intent | 166 | 20/20 | 100.0% (166) | 81.3% (135) | +18.7 | 100.0% | 88.0% | 88.0% |
| know_your_business | 70 | 20/20 | 88.6% (62) | 25.7% (18) | +62.9 | 88.6% | 31.4% | 31.4% |
| order_fulfillment | 23 | 7/7 | 78.3% (18) | 87.0% (20) | −8.7 | 78.3% | 87.0% | 87.0% |
| referral_abuse_detection_v1 | 180 | 20/20 | 100.0% (180) | 99.4% (179) | +0.6 | 100.0% | 99.8% | 99.8% |
| referral_abuse_detection_v2 | 180 | 20/20 | 100.0% (180) | 87.8% (158) | +12.2 | 100.0% | 94.1% | 94.1% |
| traffic_spoofing_detection | 180 | 15/20 | 72.8% (131) | 81.1% (146) | −8.3 | 72.8% | 81.5% | 81.5% |
| video_annotation | 105 | 20/20 | 99.0% (104) | 33.3% (35) | +65.7 | 99.0% | 42.5% | 43.8% |
| video_classification | 177 | 19/20 | 87.6% (155) | 65.5% (116) | +22.0 | 87.8% | 76.1% | 76.1% |
| warehouse_package_inspection | 130 | 17/20 | 50.0% (65) | 49.2% (64) | +0.8 | 50.0% | 49.2% | 49.2% |
| **macro, 12 SOPs** | 1,693 | 96.3% | **87.6%** [85.6, 89.5] | **67.1%** [64.8, 69.4] | **+20.5** [+18.1, +23.0] | 87.7% | 72.5% | 72.6% |
| macro without aircraft_inspection | 1,601 | | 88.0% [85.8, 90.0] | 69.1% [66.7, 71.5] | +18.9 [+16.5, +21.3] | 88.0% | 74.9% | 75.0% |

- **Row counts.** Over rows rather than SOPs, W passes 1,514 of 1,693 rows on all three runs (89.4%) and A passes
  1,222 (72.2%). W's upstream@1 equals its strict pass@1 on every SOP.
- **Where W falls short of 90%.** Six SOPs are below 90%: warehouse 50.0, traffic 72.8, order_fulfillment 78.3,
  aircraft 83.7, video_classification 87.6 and know_your_business 88.6.
  - Three of them are the only workflows that missed dev rows before the freeze: traffic 15/20, video_classification
    19/20 and warehouse 17/20.
  - The other three passed every dev row. Order_fulfillment's workflow saw only 2 repair rows.
- **Where A beats W.** These are order_fulfillment (20 against 18 rows, of 23) and traffic_spoofing_detection (146
  against 131, of 180).
  - The rule has no per-SOP test, and none is made here.
  - On the 23 rows of order_fulfillment the difference is 2 rows.
- **The agent arm matches phase 1.** A's sealed pass@1 is 72.5% macro, against 73.8% for the same agent on dev rows in
  phase 1 (K = 1, the same 12 SOPs; NOTES §8). As DESIGN §0 expected, its pass^3 (67.1%) is lower than its pass@1.

### 3.3 Robustness of the agent's score to the L5 audit

The frozen fault clause counts an L5 audit violation of an agent session as a fail. 50 of A's 5,079 runs (1.0%) failed
that way rather than by the grader.

- 49 of the 50 flag a Bash command matching `SOP_REF`, `/sop[-_ ]?bench|amazon[-_]sop|huggingface\.co|\bhf_hub\b|
  \bsnapshot_download\b/i` (`experiments/sopbench/run.mjs:41`), in 1 to 10 responses of the session.
- 1 has no host transcript.
- Which string each command matched is not in the aggregates. Phase 1 had none in 247 sessions.

The bound: suppose every violating run had passed and fell in a row whose other two runs passed. A's macro pass^3 would
then rise by at most 2.9 points, from Σ over SOPs of min(violations, rows) / rows, divided by 12. Customer_service carries
24 of the 50. W − A would stay above +17 points, so no clause of the rule depends on the audit.

### 3.4 What the primary shows and what it does not

**What it shows:**

- On SOP-Bench's sealed rows of these 12 SOPs, Haiku 5.5 wrote code once per SOP from the SOP text, the tool specs and
  5 build rows, and repaired it on at most 15 dev rows. That code answers more rows correctly on all three runs than the
  Haiku 5.5 agent working through the SOP on every row: +20.5 points macro, with a paired interval excluding 0.
- It does so almost without run-to-run variation.
- It costs about a third as much per run once its build cost is spread over the run.

**What it does not show:**

- 90% reliability.
- Superiority on every SOP.
- Anything about a frontier agent. The A-S Sonnet reference of DESIGN §9 was not run.
- That model loops are being compared. Per DESIGN §13, 11 of the 12 workflows made no model call on dev rows. The run
  therefore compares code fitted on 20 dev rows with an agent per row.
- Parity with upstream's published numbers, which come from other models, agent loops, rows and scorers (NOTES §6).

## 4. The cells, as preregistered

*Evidence: sealed rows, frozen workflows, catalogs and code, k = 3, both arms interleaved within each cell. No rule
covers the cells: each cell summary carries `decision: null` and a `cellNote` (`sealed.mjs:227–228`). A comparison
of a cell with the primary run sets runs side by side that were made hours (V1) or days (V2) apart, so it is not
interleaved. It is read here post hoc.*

DESIGN §8 states what V1 and V2 are for: "Report Δ strict pass^3 (bloated − minimal) per arm with paired intervals. The
question: does building once filter the distractors (they cost the builder once) where the per-row agent pays for them
every row?" DESIGN §13 states the purpose of patient_intake: "a **separately reported cell**. The primary set stays the
12 SOPs of §6, so the primary comparison stays matched to the phase-1 dev baseline, and the decision rule (§7) covers the
primary run only."

### 4.1 V1-minimal: upstream's own distractor setting

The cell runs video_annotation with the minimal catalog: the 6 real tools, with the 20 stub tools dropped from the
catalog and refused by the bridge. Its comparator is the shipped 26-tool catalog, which is the primary run (the freeze's
`compareWith`). It covers all 105 sealed rows with k = 3.

W was rebuilt under the minimal catalog in `p2-abl-v1`: 20/20 on dev rows at round 0, for $0.192. The bloated W is the
primary's workflow, which reached 20/20 after one repair for $0.186.

| arm | minimal (V1 cell) | bloated (primary) | Δ bloated − minimal | pass@1 minimal / bloated |
|---|---|---|---|---|
| W | 98.1% (103/105) [95.2, 100] | 99.0% (104/105) | +1.0 (1 row) | 98.1% / 99.0% |
| A | 38.1% (40/105) [28.6, 47.6] | 33.3% (35/105) | −4.8 (5 rows) | 46.7% / 42.5% |

In the cell, W − A is +60.0 [+50.5, +69.5].

**What it shows:**

- Under either catalog the build-once workflow gets 98–99% of rows right on all three runs, and the agent gets 33–38%.
  The catalog moves neither arm by more than 5 of 105 rows.
- The agent's direction matches upstream's report: bloated is worse. Upstream had Sonnet 4.5 ReAct at "minimal registry
  37% TSR" against 20.8% bloated, on its lenient metric (NOTES §6). Here the effect is −4.1 points pass@1 and −4.8
  pass^3, about a quarter of upstream's 16 points.
- A rough post-hoc 95% interval for A's Δ is [−17.7, +8.2]. It is unpaired, so it is wider than a paired interval would
  be if the rows correlate positively. This cell therefore does not show a distractor effect on the agent.
- The agent fails the same way in both catalogs, with `final status` wrong:
  - minimal: 158 of 168 failing runs, plus 9 invalid-JSON answers and 1 with no final output;
  - bloated: 172 of 181 failing runs, plus 8 invalid-JSON answers and 1 with no final output.
- The bloated build does not filter every stub (static check).
  - Section 7.3 of the primary video_annotation workflow declares the stub `optimizeTrackingSettings` and calls it through
    `tryCall` when detection reports tracking off (`frozen/p2/video_annotation/solve.mjs:52, 58`). The stub's body is
    `pass`.
  - The minimal build names no stub.
  - Whether that branch ran on any sealed row is not in the aggregates. It cost W at most the 1-row difference above.

**What it does not show:**

- A paired interval for Δ (§8 item 3).
- W's Δ separates the catalog from build-to-build variation. There is one build per catalog, so it cannot.
- Anything beyond one SOP whose agent baseline is low in both catalogs.

### 4.2 V2-bloated: our distractors on three SOPs

Each of dangerous_goods, customer_service and know_your_business gets 20 generated distractors. They are near-duplicate
names and descriptions of real tools that return `null` or a decoy, generated deterministically and committed as
`experiments/sopbench/ablation/*-bloated.json`.

W was rebuilt under each bloated catalog in `p2-abl-v2`. The cell runs 40 sealed rows per SOP, a seeded subsample fixed
in the freeze, with k = 3. Its comparator, by the freeze's `compareWith`, is "primary on the same rows (the original
catalog)".

| SOP | rows | W pass^3, bloated | A pass^3, bloated | W − A | W build $ (bloated / primary) | primary, all sealed rows of the SOP, W / A (other rows) |
|---|---|---|---|---|---|---|
| dangerous_goods | 40 | 97.5% (39) | 90.0% (36) | +7.5 | 0.0370 / 0.0280 | 97.6% / 89.4% (254 rows) |
| customer_service | 40 | 95.0% (38) | 77.5% (31) | +17.5 | 0.1886 / 0.2469 | 94.1% / 60.3% (136) |
| know_your_business | 40 | 75.0% (30) | 27.5% (11) | +47.5 | 0.2608 / 0.6672 | 88.6% / 25.7% (70) |
| **macro** | 120 | **89.2%** [83.3, 94.2] | **65.0%** [58.3, 71.7] | **+24.2** [+15.8, +32.5] | 0.4863 / 0.9421 | 93.4% / 58.5% |

A's pass@1 under the bloated catalogs is 71.4% macro.

**What it shows:**

- With 20 distractors in each catalog, the Haiku builder still produced workflows that pass all 20 dev rows.
- Under the bloated catalogs, W leads the agent by 24.2 points [15.8, 32.5] on 120 sealed rows.
- The distractors are filtered at build time, in code (post-hoc static check, $0). None of the three frozen V2 workflows
  names any of its 20 distractor tools. They name 4 of 4, 9 of 10 and 7 of 8 real tools; customer_service leaves out
  `checkPaymentStatus` and know_your_business leaves out `getBankData`. The agent, by contrast, gets all 20 extra tool
  specs in every row's prompt.
- 6 of A's 360 runs failed by the L5 audit, 5 of them in customer_service.

**What it does not show:**

- The preregistered quantity, Δ (bloated − original catalog) per arm on the same 120 rows. The primary's results on those
  rows exist only as row-level records; no aggregate holds them, and none was opened for this file.
- What the last column of the table can support. It sets this cell against other rows (all of each SOP's sealed rows, of
  which the 40 are a subsample) and, for W, against other builds. For A, the runs were made up to six days apart and,
  going by other records, on a different CLI patch version (§7).
  - Read loosely, W is lower on know_your_business under the bloated catalog (75.0% against 88.6%, from a cheaper build
    that kept round 1 rather than round 2).
  - A is higher on customer_service (77.5% against 60.3%).
  - Neither difference can be attributed to the distractors.
- The V2 answer to §8's question is therefore **unknown** here. Settling it needs the paired comparison on the cell's
  rows.

### 4.3 patient_intake (owner decision D3)

The patient_intake workflow was built in `p2-pi` (16/16 dev rows at round 0, $0.189), frozen and run sealed with both
arms at k = 3. By decision D3 (`research/decisions-20261021.md`) it is reported separately and is not in the primary
set or the rule.

| arm | pass^3 | pass@1 | rows always failing / flaky |
|---|---|---|---|
| W | 100.0% (50/50) [100, 100] | 100.0% (150/150 runs) | 0 / 0 |
| A | 48.0% (24/50) [34.0, 62.0] | 62.7% | 10 / 16 |

W − A is +52.0 [+38.0, +66.0]. All 56 of A's failing runs have `user_registration` wrong; `life_style_risk_level` is
wrong in 46 of them and `overall_risk_level` in 44.

**What it shows:** the frozen intake workflow returned all six expected columns on every run.

**What it does not show:**

- Judgment. Patient_intake's six tools return its six answer columns (NOTES §7.4), so W's 100% measures that the workflow
  calls each tool and copies the result.
- A second analysis. The freeze's `orchestrationOnly` names only aircraft_inspection, so the cell's "without
  orchestration-only" analysis is identical to its main one.
- A different reading of the primary. Folding the cell into the primary macro, which the freeze does not do, would give
  W 88.6% and A 65.7%; no reading changes.

The data is synthetic; no patient, clinician or record was touched (D3).

## 5. Failure anatomy (aggregate counts)

*Evidence: sealed runs, aggregate counts from `experiments/sopbench/failures.mjs`. That script is not a frozen file. It
was committed on 2026-10-21 at 13:44Z, after the freeze and before any sealed grade existed, and has not changed since.*

`failures.mjs` gives each graded run one category and records column names, flaky rows (some but not all of the three
runs pass) and rows that fail all three runs. Causes beyond these counts need the row-level records and are not given
here.

### 5.1 The primary

- **W:** of 5,079 runs, 4,543 pass and 536 are wrong values. There are no deopt, crash, timeout or no-workflow statuses,
  and no missing columns, invalid JSON or missing final outputs. Upstream-only passes: 0.
- **A:** of 5,079 runs, 3,955 pass. The failures are:
  - 1,065 wrong values;
  - 50 L5 violations;
  - 8 invalid JSON;
  - 1 with no final output.

  Upstream-only passes: 4. No session errors were recorded.

| SOP | W rows always failing / flaky | W most-missed columns (column misses) | A rows always failing / flaky | A failing runs: wrong value / L5 / other | A most-missed columns (column misses) |
|---|---|---|---|---|---|
| aircraft_inspection | 15 / 0 | aircraft_ready 33, cross_check_response 24, component_mismatch_response 12 | 49 / 1 | 146 / 2 / – | component_incident_response 135, component_mismatch_response 135, cross_check_reporting_response 115 |
| customer_service | 8 / 0 | final_resolution_status 24 | 10 / 44 | 62 / 24 / – | final_resolution_status 62 |
| dangerous_goods | 6 / 0 | hazard_class 18 | 5 / 22 | 28 / 10 / – | hazard_class 28 |
| email_intent | 0 / 0 | – | 11 / 20 | 58 / 2 / – | action 55, seller_intent 22 |
| know_your_business | 8 / 0 | escalation_status 24 | 43 / 9 | 141 / 3 / – | escalation_status 141 |
| order_fulfillment | 5 / 0 | expected_output 15 | 3 / 0 | 9 / 0 / – | expected_output 9 |
| referral_abuse_detection_v1 | 0 / 0 | – | 0 / 1 | 0 / 1 / – | – |
| referral_abuse_detection_v2 | 0 / 0 | – | 3 / 19 | 31 / 1 / – | final_decision 31 |
| traffic_spoofing_detection | 49 / 0 | enforcement_action 147 | 33 / 1 | 99 / 1 / – | enforcement_action 99 |
| video_annotation | 1 / 0 | final status 3 | 52 / 18 | 172 / 0 / 9 (8 invalid JSON, 1 no final output) | final status 172 |
| video_classification | 21 / 1 | final_decision 65 | 27 / 34 | 121 / 6 / – | final_decision 121 |
| warehouse_package_inspection | 65 / 0 | resolution_status 195 | 66 / 0 | 198 / 0 / – | resolution_status 198 |
| **total** | **178 / 1** | 536 failing runs | **302 / 169** | 1,065 / 50 / 9 | |

A run can miss more than one column, so the column misses can add up to more than the failing runs.

1. **W's failures are stable wrong labels.** 178 of its 179 failing rows fail all three runs.
   - The one flaky W row is in video_classification. That workflow calls a Haiku judge only for moderator-note
     categories its code does not cover (§2).
   - Whether that judge caused the flip is not in the aggregates.
2. **The agent's failures have a stable part and a flaky part.** 302 rows fail every run, and 169 rows (10.0%) flip.
   The flaky rows are the gap between A's pass@1 (72.5%) and its pass^3 (67.1%).
3. **aircraft_inspection.** The agent misses the report-tool columns. That is the pattern phase 1 found on dev rows,
   where the agent skipped report tools and wrote "None" (NOTES §8).
   - W misses other columns, most often `aircraft_ready` and `cross_check_response`, on 15 rows.
   - Each of this SOP's tools returns one answer column (NOTES §7.4), so a workflow that copied each tool's value would
     be expected to pass.
   - Why the frozen workflow misses these columns was not checked here. It may derive some of them in code, or a tool's
     lookup may return a different row on the full world.
4. **warehouse_package_inspection.** Both arms miss `resolution_status` on about half the rows (W 65, A 66), on every
   run, with no flaky row in either arm.
   - Whether they fail the same rows is not in the aggregates.
   - So is whether the cause is the SOP, the ground truth or both builds.
5. **The two SOPs where the agent wins.**
   - On traffic_spoofing_detection, W misses `enforcement_action` on 49 rows against the agent's 33 + 1 flaky. Its
     workflow had missed 5 of 20 dev rows, and `p2-main` rejected both repair rounds.
   - On order_fulfillment, W misses `expected_output` on 5 rows against the agent's 3.
6. **The SOPs where the agent is weakest.**
   - know_your_business: `escalation_status` is wrong on 43 of 70 rows every time (W: 8).
   - video_annotation: `final status` is wrong on 52 of 105 rows (W: 1), plus 9 malformed or missing answers.
   - Phase 1 saw the same two SOPs fail on the final decision on dev rows (NOTES §8).
   - DESIGN §12 names know_your_business's rule as date-relative: "license is not expired for more than 42 days", with no
     reference date. Whether that ambiguity explains the agent's misses is not known here.

### 5.2 The cells

| cell | arm | runs | pass | wrong value | other | rows always failing / flaky / total | most-missed column |
|---|---|---|---|---|---|---|---|
| V1-minimal | W | 315 | 309 | 6 | – | 2 / 0 / 105 | final status 6 |
| | A | 315 | 147 | 158 | 9 invalid JSON, 1 no final output | 45 / 20 / 105 | final status 158 |
| V2-bloated | W | 360 | 321 | 39 | – | 13 / 0 / 120 | escalation_status 30 (know_your_business) |
| | A | 360 | 257 | 97 | 6 L5 violations | 29 / 13 / 120 | escalation_status 82 (know_your_business) |
| patient_intake | W | 150 | 150 | 0 | – | 0 / 0 / 50 | – |
| | A | 150 | 94 | 56 | – | 10 / 16 / 50 | user_registration 56 |

- In every cell, W has no deopt, no status other than `done` and no flaky row.
- In V1, A has 4 upstream-only passes; there are none elsewhere in the cells.
- In V2, W's misses are concentrated in know_your_business: 10 rows, against 1 for dangerous_goods and 2 for
  customer_service.

## 6. Cost

*Evidence: recorded spend in the summaries and the freeze's `spendBeforeSealedUsd`.*

| item | runs or sessions | recorded spend | per run | cap; DESIGN §10 estimate |
|---|---|---|---|---|
| primary builds and repairs (`p2-pilot` $0.3611, `p2-main` $2.3055) | 12 workflows, 25 sessions | $2.6666 | – | $3 per build, $1.50 per repair |
| cell builds (`p2-abl-v1` $0.1920, `p2-abl-v2` $0.4863, `p2-pi` $0.1889) | 5 workflows, 6 sessions | $0.8672 | – | same |
| **all builds** | 17 workflows, 31 sessions | **$3.5338** | | estimate $6–24 builds + $0–26 repairs |
| primary sealed, W (judge calls) | 5,079 | $0.1019 | $0.0000201 run-time; $0.000545 amortised | estimate $0–15 |
| primary sealed, A | 5,079 | $8.6226 | $0.001698 | estimate ≈ $11 at $0.0022 |
| primary sealed, sessions in fault records | 23 | $0.0048 | – | |
| **primary sealed, total** | 10,158 | **$8.7294** | | cap $40 |
| V1-minimal (A; W $0) | 630 | $0.7421 | A $0.002356; W $0.000609 amortised | cap $5; estimate ≤ $5 |
| V2-bloated (A $0.7461, fault records $0.0023; W $0) | 720 | $0.7484 | A $0.002072; W $0.001351 amortised | cap $5; estimate ≤ $4 |
| patient_intake (A; W $0) | 300 | $0.2659 | A $0.001773; W $0.001259 amortised | cap $5 |
| **all sealed runs** | 11,808 | **$10.4858** | | |
| **phase 2, recorded** | | **$14.0196** | | cap $100; estimate $20–85, most likely ≈ $35 |

- **Amortised cost.** "Amortised" is the rule's formula: build plus sealed spend, over the W runs. For a cell, the cell's
  own builds are spread over its own W runs (`sealed.mjs:224–226`).
- **Per row.** At k = 3, a row costs $0.0051 with A and $0.0016 with W amortised.
- **Payback (post hoc).** At the agent's $0.0017 per run, the primary builds' $2.67 is recovered after about 1,590 W
  runs, which is 31% of the 5,079.
- **Spend not recorded.** A killed process leaves no record for the sessions it had in flight. Three kills at
  concurrency 3 leave at most 9 such sessions (§7). The hard bound is the $0.25 session budget each, so at most $2.25.
  At the agent's mean cost per run the expected loss is about 2 cents.
- **What is not included.** Phase-1 spend ($0.54 plus a $0.0019 smoke run) is not in these totals.

## 7. Run history

*Evidence: the sources are:*

- *the `[chain …]` lines of the orchestrator's chain log (kept in the orchestrating session's scratch directory, not
  committed);*
- *the stopped fields of two partial summaries in git (7b344f13, 53d65fdf);*
- *decision D31;*
- *for the container restarts and CLI versions, this machine's OT-0 record (`research/org-20261021/RESULT-OT0.md`).*

*The chain (`chain.sh`) watched the primary process, then resumed any run that stopped with exit 3 (an environment fault)
after 30 minutes. It ran V1, V2 and patient_intake in turn, at concurrency 3. A run whose `launch.json` exists is always
started with `--resume`.*

| when (UTC) | run | event |
|---|---|---|
| 10-21 13:29Z / 13:32Z | – | `FREEZE-p2.json` created, then committed (5a8c6603) |
| before 14:27:58Z | p2-sealed | launched outside the chain (its launch time is not in the chain lines); stopped on an environment fault at `A-video_annotation-20-2: MODEL_RATE_LIMIT` |
| 14:57:58Z, 15:28:03Z, 15:58:15Z | p2-sealed | three resumes, each exiting 3 after 4–12 s |
| 16:28:19–17:35:02Z | p2-sealed | resume; ran 67 min, exit 3 |
| 18:05:02–19:31:57Z | p2-sealed | resume; ran 87 min, exit 3 |
| 20:01:57Z, 20:32:01Z | p2-sealed | two resumes, each exiting 3 after 4 s. At 20:32:05Z, 4,602 of 10,158 runs were done ($4.19), stopped at `A-referral_abuse_detection_v2-74-2: MODEL_RATE_LIMIT` (snapshot in 7b344f13) |
| 21:02:05–23:29:29Z | p2-sealed | resume; ran 147 min, exit 3 at `A-customer_service-135-2: MODEL_RATE_LIMIT`, the minute of the account session limit recorded in RESULT-OT0 §2.1 |
| 23:29Z–02:08Z | – | no chain line. The chain's next retry, due at 23:59:29Z, was never logged, so that chain instance ended before it; why is not recorded |
| 10-22 02:08:45Z | p2-sealed | a new chain instance, after the 02:06Z container restart (RESULT-OT0 §4.1); resume. No exit line: killed, matching the 03:11Z container restart (same source) |
| 03:16:22Z | p2-sealed | a new chain instance; resume. No exit line: killed before 03:42:51Z, cause not recorded |
| 03:42:51–03:59:19Z | p2-sealed | resume; **exit 0**. The summary's `finishedAt` is 03:59:16Z |
| 03:59:19Z | V1-minimal | start. No exit line: killed before 04:18:01Z, cause not recorded |
| 04:18:02–04:23:41Z | V1-minimal | a new chain instance; resume; **exit 0** |
| 04:20:30Z | – | primary summary committed (e801255f) |
| 04:23:41–04:37:10Z | V2-bloated | start; exit 3, reason not in the chain lines. The chain's retry, due at 05:07:10Z, was never logged |
| 07:41:43–07:41:54Z | V1-minimal | a new chain instance; a no-op resume of the finished V1 (exit 0) |
| 07:41:54–07:45:55Z | V2-bloated | resume; exit 3 at `A-know_your_business-50-0: MODEL_RATE_LIMIT`, with 410 of 720 runs done ($0.4399; the partial summary in 53d65fdf) |
| 10-22 07:45Z to 10-28 17:48Z | – | **the pause.** D31: the weekly usage limit "hit on 2026-10-22 at 07:47Z stopped every workflow and agent for six days; the detached runs stopped on environment faults" |
| 10-28 17:48:42–17:48:52Z | V1-minimal | a new chain instance; another no-op resume of V1 (exit 0). It rewrote V1's `finishedAt` |
| 17:48:52–18:06:38Z | V2-bloated | resume; **exit 0** |
| 18:06:38–18:29:09Z | patient_intake | start; **exit 0** |
| 18:29:16Z | – | chain: ALL DONE |

**Counts.**

- The primary was launched once and resumed 11 times. It stopped 9 times on environment faults (once before the chain
  and 8 times with exit 3), was killed twice and completed once. Its `failures.json` counts 23 fault records.
  - With up to 3 or 4 runs in flight, one stop can leave several fault records.
- V1 started once and was resumed 3 times: once after a kill, twice as no-ops. It had no fault.
- V2 started once and was resumed twice. It stopped twice on environment faults, with 3 fault records.
- patient_intake ran once.
- In all there were 16 resumes and 7 chain instances.
- Every stop reason that is recorded (the primary's first, its 20:32Z and 23:29Z stops, and V2's second) is a
  `MODEL_RATE_LIMIT` on an agent session. The other seven of the 11 stop reasons are not in these sources.
- No fault was ever scored. `sealed.mjs:200` writes a fault to `faults.jsonl`, not to the graded file, and stops.

**The six-day pause.**

- V2-bloated started at 2026-10-22 04:23:41Z and finished at 2026-10-28 18:06:38Z, 6 d 13 h 43 min later.
- It stood still from its stop at 07:45:55Z to its resume at 17:48:52Z six days later: 6 d 10 h 3 min.
- It actually ran for about 35 minutes, in legs of 13.5, 4.0 and 17.8 minutes.
- Its stop is within two minutes of the weekly limit D31 records at 07:47Z.
- 410 of its 720 runs were made on 10-22 and 310 on 10-28. By the job order in `sealed.mjs:155–158` (rows round-robin
  over the three SOPs), those are roughly the first 23 of each SOP's 40 rows and the remaining 17.
- Its W arm makes no model call, so the pause touched only the agent. Within each leg the per-row interleaving of W and
  A held.

**CLI versions.**

- The sealed and build summaries do not record the Claude Code CLI version. The freeze does not pin the binary: it
  hashes our code and `policy/models.json`, not the CLI.
- Other records on the same machine give these versions:
  - 2.1.306 in phase 1 (NOTES §8);
  - 2.1.306 until the 2026-10-22 02:06Z container restart (RESULT-OT0 §5 item 2);
  - 2.1.307 after that restart, seen with `claude --version` at 02:11Z and 03:18Z (same source);
  - a move from 2.1.307 to 2.1.312 during the pause (D31).
- If those apply here, which is inference and not observed in these runs:
  - The primary's agent and judge sessions ran on 2.1.306 up to 23:29Z and on 2.1.307 from 02:08Z. At least 4,602 of
    its 10,158 runs were done by 20:32Z; the exact split is not recorded.
  - V1 ran on 2.1.307.
  - V2's first 410 runs ran on 2.1.307 and its last 310 on 2.1.312.
  - patient_intake ran on 2.1.312.
- What changed between these versions is not known here.

## 8. Deviations from the freeze, and disclosures

1. **No frozen file changed.**
   - Every launch and resume ran `verifyFreeze` (`sealed.mjs:47–61`, called at `:119`). It refuses any change to the
     frozen code, SDK, workflow artifacts or sealed row lists. Each cell launch also checks its catalogs and artifacts
     (`sealed.mjs:131–136`).
   - All four summaries carry `freezeSha256` `14effe18…`, which is the file's sha256 today.
   - All four have `dependencyDrift: []`, so the shared host files matched at each summary's last write.
   - On 2026-10-28 every frozen code file, dependency, SDK file, workflow artifact, cell artifact and cell catalog was
     hashed again; none mismatches.
2. **The second bootstrap uses fewer resamples than the text says.** The rule's bootstrap without the orchestration-only
   SOP uses 2,000 resamples in the frozen code (`sealed.mjs:222`), not the 10,000 that DESIGN §7 and the freeze's
   `decisionRule` text state. No outcome changes: that clause fails on its point estimate (88.0%), not on its interval.
3. **The ablation's preregistered output was not produced.** DESIGN §8 asks for Δ per arm with paired intervals. The
   frozen code pairs W with A only within a run.
   - V1's Δ is given here as a point estimate, with a rough unpaired interval.
   - V2's Δ needs the primary's row-level results on the cell's rows and is not computed.
4. **Some secondary metrics of DESIGN §7 are in no aggregate:** judge calls per row on sealed rows, the section-level
   checks and interface violations. Deopts are covered: there are none in any run.
5. **The CLI binary is not frozen.** By other records it changed twice inside the run window (§7).
6. **V1's `finishedAt` is not when its runs ended.**
   - The chain resumes any run with a `launch.json`, so it resumed V1 twice after V1 had finished.
   - Each no-op resume verified the freeze again, ran no row and rewrote `summary.json` with a new `finishedAt`:
     04:23Z, then 07:41:54Z, then 2026-10-28 17:48:52Z.
   - The committed diff between the last two versions changes only that field. V1's runs ended at 2026-10-22 04:23:41Z.
7. **Concurrency.** The chain ran every invocation at concurrency 3; the default in `sealed.mjs` is 4. The original
   primary launch's setting is not in these sources. Concurrency is not a frozen setting.
8. **Killed processes left no records.** They left no fault or cost record for their in-flight sessions. Those runs were
   repeated on resume, because `sealed.mjs:154` skips only runs that have a raw or graded record. The unrecorded cost is
   at most $2.25 (§6).
9. **content_flagging was not built or run in phase 2.** DESIGN §6 says it is "Reported separately", but the freeze
   does not list it. Its phase-1 dev numbers are in NOTES §8.
10. **The freeze lists only aircraft_inspection as orchestration-only**, but patient_intake's tools also return its answer
    columns (NOTES §7.4). This affects only the patient_intake cell's second analysis, which decides nothing.
11. **The graders agreed everywhere.** There were 0 grader disagreements in all 11,808 graded runs, by the summaries'
    `graderDisagreements`: the JS and Python strict graders agree with each other and with the upstream port.
12. **Not run:** the stretch variants of DESIGN §9 (W-H-call, W-H-T, A-S).

## 9. What is unknown

- **Why W fails the rows it fails.** The candidates are rules fitted to 20 dev rows, ambiguous SOP text (DESIGN §12:
  dangerous_goods' cut-offs, the date-relative rules of know_your_business and referral v2) and noisy ground truth.
  Telling them apart needs the row-level records.
- Whether W and A fail the same rows of warehouse_package_inspection.
- The V2 distractor effect (§4.2), and a paired interval for V1.
- What the 49 commands flagged by the L5 audit referenced.
- How often the judge paths of aircraft_inspection and video_classification fired on sealed rows.
- Each run's CLI version, and whether the agent's behaviour changed with it.
- What caused two of the three process kills, and seven of the 11 environment-fault stops.

## 10. Files

- Summaries:
  - `runs/p2-sealed/summary.json`, the primary, with `decision`;
  - `runs/p2-abl-v1-sealed/`, `runs/p2-abl-v2-sealed/` and `runs/p2-pi-sealed/`, each with `summary.json`;
  - `failures.json` in each of the four sealed-run directories;
  - the builds: `runs/{p2-pilot,p2-main,p2-abl-v1,p2-abl-v2,p2-pi}/build-summary.json`.
- The freeze is `FREEZE-p2.json`. The frozen workflows are in `experiments/sopbench/frozen/p2/`: the primary workflows,
  plus `ablation/`, `separate/` and `sdk/`.
- Code:
  - `experiments/sopbench/sealed.mjs` (`analyse()` at line 64, `decide()` at line 107);
  - `failures.mjs`;
  - `report2.mjs`.
- To print the tables of §2–§5: `node experiments/sopbench/report2.mjs --builds p2-pilot,p2-main,p2-abl-v1,p2-abl-v2,p2-pi
  --sealed p2-sealed --cells p2-abl-v1-sealed,p2-abl-v2-sealed,p2-pi-sealed`. Then run `node experiments/sopbench/failures.mjs --run
  <run-id>` for each run; it reads the per-row records and writes only aggregates.
- The per-row records are in `/var/tmp/foundry-work/sopbench-rows/<run-id>/`, outside the repository (CC BY-NC). None
  was opened for this file.
