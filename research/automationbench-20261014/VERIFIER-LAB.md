# Verifier lab: the judge's synthesis, the ceiling, and the next live arm (AutomationBench, 2026-10-22)

**Evidence class: development (diagnostic).** Everything below comes from stored devTrain dev60 runs (`--pool devTrain
--subset 60 --seed 21`, k = 1 per arm), read as developer under PREREG-AB-v1 §5. No devCheck or test task, and no run whose
id contains `devcheck` or `test`, was read. The look-2 task list was read by name only; no look-2 grade or result was read.
The judge's own analysis cost $0 (stored verifier outputs, regrades through the official rubric).

**Keep this file out of every verifier, harness and model context.** It names dev60 tasks and describes, in generic
words, what their graders require. Only the generic conventions of §3.3 may reach a harness, in their generic wording and
listed in its KNOWLEDGE block (H7/H8 as read under D21).

---

## 0. Answers

1. **Best verifier per dollar.** Verifier cost is not what decides this: every verifier here costs 1–10% of the forks it
   chooses between. Accuracy and safety decide it.
   - **Choice:** the requirement ledger (RL2) as an accept gate, then the Haiku world-reading judge to rank. This is rule
     R3 in §1.3. On the m3-a1c + sonnet-a1 pair it scores **34/60 against 29** for m3-a1c alone, and **15/24 against
     13** on RL2's held-out folds.
   - **Cost:** about $0.019 per task for two candidates.
   - **Uncertainty:** honest numbers are about +5 ± 5 tasks on that pair, and about 0 on the stored k = 3 cheap forks.
     RL2 alone (R1: 33, +4/−0, 95% CI [+1, +8]) and the Haiku judge alone (R2: 34) are equally good within noise.
   - **What is robust is the pool, not the verifier.** Every world-reading verifier lands at 33–35 on that pair. On the
     stored k = 3 cheap forks they land at 28–30; the best, 32, comes from the judge stacked on the learned selector,
     with a CI that includes 0.
2. **Ceiling.**
   - Of the 19 never-passed tasks, **7 are hard benchmark defects** that cap every arm, Opus 5.5 xhigh included.
     **4 are soft defects** that only a lucky guess of an unstated convention passes.
   - The realistic dev60 ceiling is **53/60 (88%)**, or 49/60 (82%) without the soft ones.
   - I re-graded two of the hard defects independently at $0, and they reproduce (§2).
   - On m3-a1c's 31 failures, label defects explain at most 4 of its 11 false "all checks pass" verdicts. The other 7
     are real verification misses.
3. **Live arm.** VL-1: m3-a1c (A1-C v1, Mercury ledger and checker, Haiku acting) plus sonnet-a1 (A1 prose harness),
   with rule R3 choosing between them.
   - **Task set:** run it on the **look-2 task list** (`LOOK2-TASKS.json`, sha256 `a8c1ed5c…`), not a fresh seed-22
     draw. A seed-22 draw outside dev60 puts 19 look-2 and 7 look-3 tasks into the run and fills the rest from exposed
     tasks (§4.1).
   - **Paired with Opus:** Opus 5.5 xhigh is already running on those tasks (`a0o-look2-1`). A0 and A1-C v1-M will run
     there in the A1-C v2 chain, which had not started at 02:1x Z. Only the Sonnet fork is new spend.
   - **Expected:** about **50% strict pass (45–55%) at about $0.15 per task** plus about 61K Mercury tokens. For Opus
     5.5 xhigh my prior is 35–50%, at about $0.9–1.5 per task.
   - **Optional repair:** one verifier-driven repair round is pre-declared as a separately scored secondary arm (VL-1R),
     capped at $1.
   - **Labels:** VL-1 is a forked-selection arm with mixed models (A1F, PREREG §12). It is never a headline.
4. **Implementation.** `run.mjs` has no heterogeneous-fork or selection hook: k > 1 is same-model majority voting and is
   refused with a harness. It must not change while look-2 runs resume from it. So nothing in it changes.
   - Forks are ordinary k = 1 runs on the same task list.
   - Five new files under `experiments/autobench/verifier/live/` build a label-free lab from the live directories, run
     the frozen RL2 and the Haiku judge, select, and score (§5).
5. **For A1-C (v2.1, the version after the frozen v2).** A1-C v2 itself is frozen for its look-2 evaluation, so these go
   into the next version:
   - an independent requirement ledger as the acceptance signal;
   - a commit gate that checks planned writes against it;
   - idempotent effects, mandatory if repair returns;
   - verifier-driven repair only after its precision is measured;
   - the code-checkable conventions G4, G7, G9, G10 and G11, plus brief rules G1, G3, G6 and G14.

   For forked modes, use one strong challenger built differently from the default rather than k same-family forks
   (§6).

---

## 1. Results

### 1.1 What each verifier is, and what it costs

| Verifier | Sees | Model calls | Cost |
|---|---|---|---|
| A1-C own checks | the pipeline's ledger and checks | inside the arm | $0 extra |
| code-checks v1 / v1.1 | request, world diff, initial world, Haiku facts | 1 Haiku fact call per request | $0.0005 / task |
| requirement-ledger-v2 (RL2), frozen v1 | request, initial world as tables, candidate diff | 3 Haiku readers per task, plus 1 Haiku judged-check call per candidate with no hard failure | $0.0130 / task + $0.00074 / accepted candidate |
| Haiku judge (dj-v3) | request, initial records, candidate changes | 1 per candidate | $0.0023 / candidate |
| Mercury judge | same | 1 per candidate | ~9.1K tokens / candidate; 9% of calls ended without a verdict |
| Sonnet judge | same | 1 per candidate | $0.030 / candidate |
| learned selector | 160 cheap features: telemetry, diff statistics, own checks | none | $0 |

Forks, from the stored rows (mean USD per task):

| Fork | Cost |
|---|---|
| m3-a1c | $0.0155 + 61.3K Mercury tokens |
| sonnet-a1 | $0.1153 |
| haiku-a1c | $0.0371 |
| haiku-a1 | $0.0157 |
| haiku-a0 | $0.0132 |
| sonnet-a0 | $0.1006 |

### 1.2 Telling right from wrong, per task attempt

**Held-out folds 3–4.** These are the cleanest slice: RL2 and code-checks were designed on folds 0–2, and the judges'
prompt saw 2 pilot tasks of fold 0. The base rate is 0.318.

| Verifier | Rows | P | R | F1 | AUROC |
|---|---|---|---|---|---|
| A1-C own checks | the A1-C rows among the 72 fork rows | – | – | 0.439 | 0.468 |
| code-checks v1, frozen | 217 | 0.354 | 0.739 | 0.479 | 0.581 |
| code-checks v1.1 (post hoc) | 217 | 0.392 | 0.870 | 0.541 | 0.665 |
| learned selector, cheap features | 217 | 0.422 | 0.623 | 0.503 | 0.668 |
| Mercury judge | the fork rows it judged (of 72) | – | – | 0.577 | 0.660 |
| Haiku judge | 72 fork rows | – | – | 0.545 | 0.692 |
| Sonnet judge | 72 fork rows | – | – | 0.596 | 0.760 |
| **RL2, frozen** | 217 | **0.562** | **0.725** | **0.633** | **0.837** |

RL2's held-out fold spread is large: AUROC 0.759 on fold 3 and 0.925 on fold 4.

**On the best arm's own worlds** (m3-a1c, all 60 tasks, base 0.483). The hard case is a silent policy or content error
in a plausible world.

| Verifier | P | R | AUROC | Note |
|---|---|---|---|---|
| own checks ("all checks pass") | 0.607 | 0.586 | – | 17 right, 11 wrong |
| learned selector, cheap | 0.469 | 0.793 | 0.517 | chance |
| code-checks v1.1 | – | – | – | rejects 5 of 31 failing worlds |
| RL2 | 0.538 | 0.724 | 0.664 (held-out 0.825) | rejects 4 of the 11 false "all pass" |
| Haiku judge, p_done ≥ 0.5 | 0.737 | 0.483 | 0.758 | |
| RL2 accept AND Haiku pass | 0.769 | 0.345 | – | |

**Do label defects explain the false "all checks pass" verdicts?** The ceiling analysis left this question open. I
measured it: the 11 false verdicts fall as follows.

| Task class | False verdicts |
|---|---|
| hard-defect | 2 |
| soft-defect | 2 |
| reachable by convention | 1 |
| hard but fair | 1 |
| passed by some other arm | 5 |

So at most 4 of the 11 are label artifacts. Excluding the 7 hard-defect tasks moves own-check precision only from 0.607 to
0.654. **The verification gap is real.**

**Do the verifiers make the same mistakes?** Error overlap over the Haiku-judged rows (6 arms, 360 rows):

| Pair | κ | Both wrong | Both wrong if independent |
|---|---|---|---|
| judge vs judge | 0.61–0.70 | 25–28% | 12% |
| RL2 vs Haiku judge | 0.35 | 13.9% | 9.1% |

So stacking more judges is pointless. A code-checked ledger combined with a world-reading judge is the only pair with
partly independent errors.

### 1.3 Selection: one world per task

I pre-declared rules R0–R6 in the header of `judge-eval.mjs` before its first run, and none was changed afterwards.
Ties go to fork order, with m3-a1c first.

| Rule | Definition |
|---|---|
| R0 | m3-a1c alone |
| R1 | RL2 frozen: (accept, score) |
| R2 | Haiku p_done |
| R3 | RL2 accept, then Haiku p_done, then RL2 score |
| R4 | RL2 accept, then the mean of the RL2 score and p_done |
| R5 | code-checks accept, then p_done |
| R6 | keep m3-a1c unless RL2 rejects it and p_done < 0.5 |

Cells give **all 60 tasks / held-out folds 3–4 (24 tasks)**. "+g/−l" counts gains and losses against R0, and [ ] is a
paired task-bootstrap 95% CI for all 60.

| Pool | Oracle | R0 | R1 | R2 | R3 | R5 | R6 |
|---|---|---|---|---|---|---|---|
| **P2: m3-a1c + sonnet-a1** | 36 / 16 | 29 / 13 | 33 (+4/−0) [+1, +8] / 15 (+2/−0) | 34 (+6/−1) [0, +10] / 14 | **34 (+6/−1) [0, +10] / 15 (+3/−1)** | 34 / 14 | 30 / 14 |
| P3: stored k = 3 cheap (m3-a1c, haiku-a1c, haiku-a1) | 36 / 17 | 29 / 13 | 29 (+4/−4) / 15 | 30 (+5/−4) / 13 | 29 (+5/−5) / 13 | 30 / 13 | 28 / 13 |
| P3s: m3-a1c + sonnet-a1 + haiku-a1 | 38 / 17 | 29 / 13 | 31 / 15 | 34 (+9/−4) / 14 | 34 (+9/−4) [−2, +12] / 15 | 34 / 14 | 30 / 14 |
| P6: the 6 reported arms | 40 / 19 | 29 / 13 | 29 / 15 | 31 / 13 | 30 / 14 | 32 / 14 | 29 / 14 |

R4 equals R3 in every cell.

**Other designs on P2 (all 60):**

| Design | Passes |
|---|---|
| code-checks | 33 |
| learned selector, cheap features | 30 |
| learned selector + Haiku judge feature | 35 (+7/−1), [+1, +11] |
| random pick | 28.5 |
| always sonnet-a1 | 28 |

**Pick accuracy on P2's 15 mixed tasks:**

| Rule | Picks a passing world |
|---|---|
| R1 | 12 / 15 |
| R2, R3 | 13 / 15 |
| always m3-a1c | 8 / 15 |

R1 and R2 disagree on 29 of 60 tasks, but almost only where both candidates pass or both fail.

**Post hoc, other cheap partners for m3-a1c** (pairs, all 60 / held-out). These were not pre-declared. Treat them as
hypotheses.

| Partner | Oracle | R2 | R3 |
|---|---|---|---|
| haiku-a0 ($0.013) | 32 | 32 (+3/−0) [0, +7] / 15 (+2/−0) | 31 / 15 |
| haiku-a1 ($0.016) | 35 | 32 (+6/−3) / 14 | 32 / 15 |
| sonnet-a0 ($0.101) | 35 | 33 (+5/−1) / 14 | 32 / 14 |
| haiku-a1c (same pipeline family) | 33 | 28 / 11 | 26 (+2/−5) / 11 |

**Why two forks beat three, and why the partner must be built differently**

- **The arithmetic.** Selection gain is about q·(tasks the challenger alone passes) − (1 − q)·(tasks only the default
  passes), summed over candidates, where q is the chance of a correct pick on a mixed task. With q ≈ 0.8 that is only
  positive when the challenger is comparably strong.
  - sonnet-a1 alone passes 7 tasks and loses 8 against m3-a1c, so the pair gains +4 to +6.
  - The weak Haiku forks pass few tasks alone but add many chances to switch wrongly: a winner's curse over noisy
    scores.
- **Same pipeline, same mistakes.** haiku-a1c shares m3-a1c's pipeline, and with it its failures and its duplicate
  writes. It is the only partner for which every rule loses.
- **Where the 7-task headroom of the stored k = 3 forks sits.** It is mostly silent failures that no reader extracted,
  or rules that all three Haiku readers misread the same way. Medium reasoning did not fix the misreads, so they are
  systematic.

### 1.4 Selection per dollar (P2 and alternatives, dev60, all 60)

| Setup | Passes | $ / task | Extra passes vs m3-a1c | $ per extra pass |
|---|---|---|---|---|
| m3-a1c alone | 29 | 0.0155 (+61K Mercury tokens) | – | – |
| P3 + best rule (R2) | 30 | 0.075 | +1 (CI includes −5) | ~3.6 |
| P2 + R1 | 33 | 0.145 | +4 | 1.95 |
| P2 + R2 | 34 | 0.135 | +5 | 1.44 |
| **P2 + R3** | **34** | **0.150** | **+5** | **1.61** |
| m3-a1c + haiku-a0 + R2 (post hoc) | 32 | 0.033 | +3 | 0.36 |
| sonnet-a1 alone | 28 | 0.115 | −1 | – |
| Opus 5.5 xhigh, published leaderboard (private set v1.0.6, official loop) | 35.8% | 0.89 | – | – |

The Opus 5.5 xhigh leaderboard row is not our setup. Our own run, `a0o-look2-1`, is in progress on the look-2 tasks
(16 of 60 recorded at 02:1x Z, grades not read).

### 1.5 Repair opportunity: high-precision hard checks

I counted rows with a failing hard RL2 check of the five types with fail precision 0.94–1.00 across all arms: msg_to,
msg_has, created_has, created_in and effect_any.

| Worlds | Failing worlds flagged | Passing worlds flagged | Precision on these worlds |
|---|---|---|---|
| m3-a1c, all 60 | 10 of 31 (3 on hard-defect tasks) | 7 of 29 | 0.59 |
| P2 + R3 picks | 7 of 26 (2 hard-defect, 4 reachable, 1 soft) | 6 of 34 | 0.54 |

**Check precision depends on the arm.** On the best arm's worlds, the "high-precision" checks also fire on many correct
worlds. A blind repair round would therefore touch about 13 tasks: about 5 can be fixed, and about 6 are passing worlds a
repair could break, for example by sending duplicates. The expected net is −1 to +2 tasks. That is why repair is a
measured secondary arm (VL-1R), not part of VL-1.

### 1.6 What each design is good for

| Design | Use it as | Do not use it as |
|---|---|---|
| A1-C own checks | a repair trigger inside the pipeline | a stop or acceptance signal (held-out AUROC 0.47–0.58) |
| code-checks | a free veto: reject precision 0.93 overall (v1.1), 0.75 held-out for the frozen v1. It catches no-op worlds, admitted unfinished work, unwritten named outputs and missing source amounts | a selector: alone it gains nothing on fresh rows |
| RL2 | the acceptance gate and the source of executable requirements; best held-out discrimination | a lone ranker on weak pools |
| Haiku judge | the within-task ranker: 0.79 pass-above-fail pairwise, and the highest precision on the best arm | an accept/reject classifier: recall about 0.5, and half its false rejections are duplicates the grader tolerates |
| Mercury and Sonnet judges | – | anything here: no gain over Haiku, errors coincide, Mercury truncates |
| learned selector | a stacking layer for an arm prior | a verifier: at chance on the best arm |

---

## 2. Ceiling: the 19 dev60 tasks no arm passed

Source: the ceiling analysis (`scratchpad/vlab/ceiling.md`), which holds grader strings and stays out of every model
context. Every claim there has a $0 reproduction through the official rubric.

**Judge's check.** I re-ran the official grader on two stored hard-defect reproductions:
- *support.intercom_zoho_customer_360:* the original world scores 18/19 (fail). The patched world differs in exactly 1
  leaf and scores 19/19.
- *marketing.engagement_optimization:* m3's world scores 6/11. With the rows the negative assertions forbid removed (50
  leaves), it scores 6/6.

Both match the report.

| Class | n | Tasks | Why (generic) |
|---|---|---|---|
| (a) hard defect: an agent that follows the prompt and the world fails | 7 | support.intercom_zoho_customer_360 | an exact cell value differs from the label the world's own rule prescribes |
| | | operations.invoice_shipping_trigger | a field id that nothing in the world or the API discloses |
| | | operations.docusign_contractor_offboard | the list lookup returns a nameless placeholder |
| | | support.intercom_demo_scheduling | the policy's own decline wording breaks a negative assertion |
| | | hr.visa_expiry_tracking | day counts are anchored to a date that exists only in hidden world metadata |
| | | marketing.engagement_optimization | negative assertions forbid platforms the data lists with no exclusion rule, while the prompt says "for each platform" |
| | | hr.monday_onboarding_pipeline | the grader reads a field the simulator drops on create |
| (a′) soft defect: hidden requirement, reachable only by guessing a convention | 4 | sales.vendor_review_prep | an unrequested total |
| | | finance.bad_debt_writeoff | a recipient that appears nowhere |
| | | marketing.customer_story_intake | an unrequested read-state change |
| | | operations.calendar_airtable_maintenance | an unspecified exact title |
| (b) harness defect | 0 | – | the most steps any session used was 43 of 49 |
| (c) reachable with a defensible generic convention | 6 | customer_milestone (G1), win_loss_analysis (G3), parking_allocation (G4), loading_dock (G5, G6), featured_snippet (G7, G8), chatgpt_proposal (G10) | |
| (d) genuinely hard but fair | 2 | quarterly_tax_estimate (G14), partnership_contract (G15) | |

- **Does this cap Opus too?** Yes. The 7 hard defects cap every arm, Opus included; no reasoning recovers a value the
  world does not hold. The 4 soft defects fall only to an arm that happens to follow the hidden convention.
- **Ceilings:**
  - realistic: **53/60 (88%)**;
  - conservative, without the soft defects: **49/60 (82%)**;
  - the union of all arms today: 41/60;
  - best single arm: 29/60;
  - best measured selection: 34/60.
- **Where the best arm's 31 failures sit.**

  | Group | Failures | What could recover them |
  |---|---|---|
  | hard-defect tasks | 7 | nothing |
  | soft-defect tasks | 4 | a guess |
  | reachable by convention | 6 | a generic convention |
  | hard but fair | 2 | reasoning |
  | passed by some other arm | 12 | variance and selection |

  After P2 + R3 selection, only 7 failures remain on tasks some arm passes; 19 sit on never-passed tasks. **Selection
  already takes most of the cheaply reachable headroom. The next levers are generic conventions (up to +8) and better
  requirement discovery, not more forks.**
- **Caveats.**
  - The hard/soft split is a judgment call. engagement_optimization in particular could hide a rule nobody found.
  - Only the 19 never-passed tasks were audited; lucky passes may hide defects among the other 41.
  - Look 2 will have its own defects. Expect a ceiling of about 85–90% there, too.
  - Regrading an exported world can falsely fail a "sheet row updated" check, because in-memory state is lost. Live
    grades are unaffected, but any repair or regrade experiment must control for it (§5, VL-1R).

---

## 3. Decision

### 3.1 Verifier and selector

**Primary: R3.** RL2 frozen v1 decides accept, then the Haiku judge's p_done ranks, then the RL2 score, then fork order
with the default fork first.

- **Why:**
  - It is the only pre-declared rule at the top on both slices of P2 (34/60, 15/24).
  - It joins the two signals whose errors are least correlated (κ 0.35).
  - It costs about $0.019 per task for two candidates.
- **Co-reported, with no claim:** R1 (RL2 alone; 0 losses on dev60) and R2 (Haiku judge alone).
- **Inputs:** RL2 and the judge see only the request, the connected apps, the initial records and the candidate's
  changes: never labels, task names, arms, runs, writes or the pipeline's own checks.
- **Freeze:**
  - RL2's logic files must match `rl2-out/frozen-v1-src/SHA256SUMS`. I verified all 9 files other than `run.mjs` OK
    on 2026-10-22. `run.mjs` differs only by the post-freeze `--fallback-reader` option, which VL-1 does not use.
  - The judge must be JUDGE_VERSION `dj-v3`.
  - Copy both hash lists into the repo (§5 step 0), since the scratchpad is not durable.

### 3.2 Ceiling

As in §2: 53/60 realistic and 49/60 conservative on dev60. Plan on about 85–90% on any fresh draw.

### 3.3 Generic conventions allowed into a harness (H7/H8 under D21: disclosed in KNOWLEDGE; claims only from disjoint looks)

- **Code-checkable from the request and the world diff (preferred):**
  - G4: a summary names every item acted on.
  - G7: list existing destinations unfiltered, and reuse a name match before creating a new one.
  - G9: set the skip-marker (tag, label, status) on the items you process.
  - G10: save a work product as an attached note, never by overwriting a field.
  - G11: explicitly mark processed inbox items read.
- **Brief rules:**
  - G1: copy the source's own labels verbatim, in the body too.
  - G3: back each aggregate with its source values.
  - G6: anchor "now" to the work items' dates; v2's business time partly covers this.
  - G14: tag every amount with its period and check each conversion.
  - Policy-ledger rules:
    - G5: preference fields are soft; fall back before rejecting.
    - G8: exclude records flagged unreliable.
    - G15: prefer the structured field and the newest direct statement, then fix stale fields.
- **Not allowed: G12 and G13.**
  - G12 (route to a guessed role address) invents recipients.
  - G13 (Title Case titles) fits a grader quirk.
- **Optional, low priority: G2** (state the sum of listed amounts). It fits exactly one soft defect.

---

## 4. The live arm

### 4.1 Task set: the look-2 list, not a seed-22 draw

$0 computation with `poolTasks` and `stratifiedSubset` (`scratchpad/judge/pools.mjs`), against the frozen
SEQUENTIAL-PLAN-v1 (plan `3cd586bd…`):

| Candidate set | dev60 | look 2 | look 3 | other |
|---|---|---|---|---|
| devTrain (240) | 60 | 60 | 23 | 97 |
| `--pool devTrain --subset 60 --seed 22` as is | 15 | 14 | 7 | 24 |
| seed 22 over devTrain minus dev60 | 0 | 19 | **7** | 34 |
| seed 22 over devTrain minus dev60 and looks 2–3 | 0 | 0 | 0 | 60 |

- **The leftover pool is exposed.** The 97 devTrain tasks outside looks 1–3 are all exposed or used:
  - the forced exposure set (S1 raw-Haiku subset60, whose transcripts and per-assertion grades shaped the A1 harness;
    S2 family grounding; S3/S4 parity scripts built from hidden assertions);
  - 11 briefed tasks;
  - 8 run before.

  Every arm with A1 knowledge (sonnet-a1, haiku-a1) is in-sample there.
- **A seed-22 draw outside dev60 spends look 3.** It puts 7 of look 3's 23 unspent tasks into a development run (D25
  keeps look 3 unspent).
- **The look-2 list is the right set:**
  - (a) The forks and the selector were all developed on look 1 only, so look 2 is their first look under the plan's
    exposure rule.
  - (b) Opus 5.5 xhigh (`a0o-look2-1`, running), A0 Haiku (`a0-look2`) and A1-C v1-M (`a1c-v1m-look2`, the m3-a1c
    configuration; both in the A1-C v2 chain, not yet started) run there anyway. That gives a paired comparison with
    the frontier arm, and two of the three forks at no new acting cost.
  - (c) VL-1 does not enter the plan's confirmatory test (A1-C v2 against A0). It is a reported exploratory arm, like
    Opus.
- **Fallback.** If the orchestrator wants VL-1 off the plan's tasks, use the seed-22 draw over the 97-task residual
  pool. Label it "exposed dev tasks: A1-family arms in-sample", and expect it to overstate the A1 forks.

### 4.2 Arms (pre-declared; one primary)

| Arm | Forks | Selector | New spend | Role |
|---|---|---|---|---|
| **VL-1** | v1-M (`a1c-v1m-look2`, default) + sonnet-a1 (`a1s-look2`, new) | R3 | Sonnet fork ~$7 (cap $10) + verifier ~$1 | **primary** |
| VL-1/R1, VL-1/R2 | same | R1, R2 | $0 | secondary |
| VL-1h | v1-M + A0 Haiku (`a0-look2`) | R2 | judge ~$0.3 | secondary (cheap pair; post-hoc on dev60) |
| VL-3 | v1-M + sonnet-a1 + A0 Haiku | R3 | $0 | exploratory |
| VL-v2 | v2-M (`a1c-v2m-look2`) + sonnet-a1 | R3 | $0 | exploratory (v2 is unknown) |
| VL-1R | VL-1's pick + one repair round where an HP hard check fails | – | ≤ $1 | secondary, with a regrade control |

**Protocol labels.**
- Every VL arm is **A1F** (PREREG §12: several attempts in copies of the world, choosing among them) and runs three
  models (H4).
- Each is reported in its own table, never pooled with A1 and never a headline.
- **In a real deployment the world cannot be forked**, because a sent email cannot be unsent. VL-1 measures how much a
  prompt-and-world verifier can buy. The deployable form is plan-level forking with a commit gate (§6).

### 4.3 Expected results and the comparison with Opus 5.5 xhigh

| Arm on look 2 | Strict pass, point (range) | $ / task | Basis |
|---|---|---|---|
| A0 Haiku (plan control) | 15% (12–20%) | 0.013 | dev60 15% |
| v1-M alone | 43% (38–48%) | 0.0155 + 61K Mercury tokens | dev60 48%, in-sample. A1-C (Haiku) scored 20/60 on both dev60 and devCheck, so little shrink is expected |
| sonnet-a1 alone | 43% (38–47%) | 0.115 | dev60 47% |
| **VL-1** | **50% (45–55%)** | **≈ 0.15** + 61K Mercury tokens | both-pass + q·mixed, with q 0.70–0.85 and the dev60 overlap |
| VL-1h | 47% (42–52%) | ≈ 0.034 | post-hoc dev60 32/60 |
| Opus 5.5 xhigh, A0 (`a0o-look2-1`) | prior 42% (35–50%) | prior 0.9–1.5 | leaderboard 35.8% at $0.89 (official loop, private set); our CLI setup is unmeasured |

**Statistical power.** With about 15–20 discordant pairs, a 60-task paired test detects only differences of about
8–10 tasks at α 0.05. VL-1 against Opus will most likely be **inconclusive on pass rate and decisive on cost**: about
6–10 times cheaper per task. Cost per verified success: about $0.30 for VL-1 against an expected $2–3.5 for Opus.

**Decision rules, fixed before any look-2 grade is read.**
- **Selection works on fresh tasks** when VL-1 − v1-M ≥ +3 with at most 2 losses. Then default-plus-challenger with an
  RL2/judge selector becomes the A1F mode, and RL2 becomes the commit-gate signal for A1-C v2.1.
- **Selection is not the lever** when VL-1 − v1-M ≤ +1. Then fork selection stops and the verification budget moves to
  the in-pipeline, plan-level gate.
- **Against Opus:** if VL-1 ≥ Opus − 2 tasks at ≤ 20% of Opus's cost per task, record "a cheap mixed system at frontier
  parity on 60 unseen dev tasks (exploratory, A1F)". A claim needs a sealed rerun: testRef after A0 and A1 (§12), or
  a fresh pool. Look 3 is too small (23 tasks).
- **Repair (VL-1R)** is worth carrying into A1-C only if, on the treated tasks, it gains more than it breaks, measured
  against the regrade control, and the HP checks' precision on picks is at least 0.7.

---

## 5. Implementation spec (exact steps)

`run.mjs` is a shared, pinned file. The look-2 runs resume from it, a resume refuses a changed runner, and the A0
identity checks use its hash. **So `run.mjs` is not edited.** Forks are separate k = 1 runs on the same task list.
Selection is a new step over their live directories.

**Step 0: pre-register.** Commit `research/automationbench-20261014/PREREG-VL1.md` before `a1s-look2` finishes, and
before any look-2 grade is read by the verifier lab. It contains:
- §4.2 and §4.3 verbatim: arms, rules, the primary, expected ranges and decision rules;
- the RL2 `SHA256SUMS` (copied to `research/automationbench-20261014/vl1/RL2-FROZEN-SHA256SUMS`) and the dj-v3 prompt
  and schema hash `e7e3ce823b0bb585…`;
- a copy of `LOOK2-TASKS.json` brought into this branch as D25 prescribes
  (`git checkout worktree-wf_630f3979-599-4 -- research/automationbench-20261014/LOOK2-TASKS.json`), with its list hash
  `a8c1ed5c…` checked;
- the caps;
- the analysis: paired exact McNemar and a task bootstrap against v1-M and against Opus, cost per task and per success,
  per-domain rates, and the HP-check precision on picks.

**Step 1: the new fork.** Run it from the a1c-v1 pin worktree (`b1e16e03`; runner sha256 `ea1dca70…`, the same runner
as `m3-a1c-dev60-dn` and `a0o-look2-1`). That is the checkout the v2 chain uses for v1, v1-M and A0, so every fork shares
one bridge and corpus pin. The flags match `a1s-dev60-dn`:

```
cd /home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin
L2=$PWD/research/automationbench-20261014/LOOK2-TASKS.json   # the pin worktree carries it (commit b1e16e03, D25)
node -e 'const c=require("crypto"),t=require(process.argv[1]).tasks; const h=c.createHash("sha256").update(JSON.stringify([...t].sort())).digest("hex"); if (!h.startsWith("a8c1ed5c")) { console.error("look-2 list hash", h); process.exit(1) }' "$L2" || exit 1   # list hash a8c1ed5c… (verified 2026-10-22)
HELD=$(node -e 'process.stdout.write(require(process.argv[1]).tasks.join(","))' "$L2")
node experiments/autobench/run.mjs --harness foundry --model claude-sonnet-5-5 --budget 1.5 --cap 10 --date-note \
  --concurrency 2 --timeout-min 20 --max-steps 50 --det record --k 1 --no-copy --tasks "$HELD" --run-id a1s-look2
```

- Detach it from a script file with the look2-chain resume loop: exit 3 waits 30 min, then `--resume`, at most 6 times.
- Run it at `nice`. Concurrency 2 keeps room for the Opus run.
- Record the A1 manifest hash. Any difference from `a1s-dev60-dn` outside the runner and bridge files is disclosed.
- **Do not read its log or results until step 5.** A non-sealed run prints per-task grades.
- **Reused forks:**
  - `a1c-v1m-look2` and `a0-look2` come from `a1c-v2/look2-chain.sh` (exploratory pools also use `a1c-v2m-look2`). If the
    chain has not produced them when `a1s-look2` ends, wait. Do not duplicate the spend.

**Step 2: label-free lab.** New file `experiments/autobench/verifier/live/build-live.py`, ported from the lab's
`build.py`: diff, compaction and write extraction.

```
python3 -I experiments/autobench/verifier/live/build-live.py \
  --tasks research/automationbench-20261014/LOOK2-TASKS.json \
  --arm v1m=a1c-v1m-look2 --arm sonnet-a1=a1s-look2 --arm haiku-a0=a0-look2 [--arm v2m=a1c-v2m-look2] \
  --out /var/tmp/foundry-work/vl1-look2/lab
```

- **Never opens `grade.json`.** It reads `results.jsonl` through an allowlist only: costUsd, steps, sessionError,
  harnessError, skipped and tokens.
- Writes rows with `label: null`, the worlds, and a `load.mjs` copied from the lab with `ARM_ORDER = [v1m, sonnet-a1,
  haiku-a0, v2m]`.
- Refuses any task outside devTrain or in devCheck/test, any run id containing `devcheck` or `test`, and any task not in
  the given list.
- Does not copy `dump.py`, `pc.py`, `dumps/` or `repro/`.

**Step 3: verifiers** (frozen code; replay-or-live journals; caps):

```
D=experiments/autobench/verifier; L=/var/tmp/foundry-work/vl1-look2
(cd $D/requirement-ledger-v2 && sha256sum -c /home/user/workflow-foundry/research/automationbench-20261014/vl1/RL2-FROZEN-SHA256SUMS --ignore-missing | grep -v ': OK' ; true)   # only run.mjs may differ
node $D/requirement-ledger-v2/run.mjs --vlab $L/lab --out $L/rl2 --phase extract --readers haiku:0,haiku:1,haiku:2 --usd-cap 1.5
node $D/requirement-ledger-v2/run.mjs --vlab $L/lab --out $L/rl2 --phase check   --readers haiku:0,haiku:1,haiku:2 --tag look2
node $D/requirement-ledger-v2/run.mjs --vlab $L/lab --out $L/rl2 --phase judge   --tag look2 --judge-tag look2 --judge-only-accepted --usd-cap 2
node $D/diverse-judges/run.mjs --vlab $L/lab --out $L/dj --judge haiku --arms v1m,sonnet-a1,haiku-a0,v2m --usd-cap 0.75
```

Expected spend: RL2 about $0.8 + $0.1, the judge about $0.4. The RL2 and judge caps are cumulative per journal.

**Step 4: select** (new file `experiments/autobench/verifier/live/select.mjs`):

```
node $D/live/select.mjs --vlab $L/lab --rl2 $L/rl2 --rl2-tag look2 --dj $L/dj \
  --pools 'P2=v1m,sonnet-a1;P2h=v1m,haiku-a0;P3=v1m,sonnet-a1,haiku-a0;P2v2=v2m,sonnet-a1' --rules R0,R1,R2,R3 \
  --out research/automationbench-20261014/vl1/selection.json
```

- `select.mjs` imports `combine` from `requirement-ledger-v2/verify.mjs` with `readers` (support-weighted), as frozen.
- It refuses any row whose label is not null, and reads no file under `host/`.
- It writes `{rule, pool, picks: {task: run}, inputs: sha256 of every file read}`.
- **Commit `selection.json` before step 5.** This is the blind boundary.

**Step 5: score** (new file `experiments/autobench/verifier/live/score.mjs`). Run it after `selection.json` is committed
**and** after the A1-C v2 chain has graded every arm. That chain keeps its per-task grades out of the repo until then.

```
node $D/live/score.mjs --selection research/automationbench-20261014/vl1/selection.json \
  --live-root /var/tmp/foundry-work/autobench --default v1m --ref a0o-look2-1 --rl2 $L/rl2 --rl2-tag look2 \
  --out research/automationbench-20261014/vl1/RESULT.json
```

- **Strict pass** comes from each fork's headline `final`, so H3/L5 overrides apply.
- **Paired statistics:** exact McNemar and a 10,000-sample task bootstrap, against the default and against Opus.
- **Costs:** per task and per success, from `results.jsonl` costUsd plus the verifier journals (`journalSpend`), with
  Mercury tokens reported separately.
- **Diagnostics:** gains and losses per rule; HP-check precision on picks; and, for analysis only, the ceiling classes
  of failures on look 2.

Then write `vl1/RESULT.md`.

**Step 6 (VL-1R, optional; pre-declared in step 0; run after step 4 and before step 5, so it stays blind).** New file
`experiments/autobench/verifier/live/repair.mjs`. It covers each VL-1 pick with at least one failing hard check of type
msg_to, msg_has, created_has, created_in or effect_any.

- **Control:**
  - `startServe` (lib.mjs) with `world = <pick>/final-world.json` and the pick's prep `input.json`.
  - No session (a no-op scripted runner). Grade at stop.
  - This measures how far a regrade of the exported world drifts from the live grade, including the in-memory "sheet
    row updated" loss.
- **Treatment:**
  - The same serve, then one `claude-haiku-5-5` session with:
    - the official system prompt;
    - `adapterText(catalog, …, {dateNote: true})`;
    - a generic brief that lists the failing requirements (statement and evidence from the ledger) and says: "read the
      current state first; do not repeat any effect that already exists; change only what the listed requirements
      need; leave a requirement that the records show is wrong."
  - The official user message.
  - World steps are capped at `min(10, 49 − steps the pick used)` and model responses at `50 − responses used`.
  - `--budget 0.1`, cap $1, and the task's audit applies (auditSession).
- **Scoring:** VL-1R = treatment grade on treated tasks, live grade elsewhere. Report it against the control on the
  treated tasks, with the drift counted.

**Step 7: tests.** New file `experiments/autobench/verifier/live/live.test.mjs`, run with `node --test`:
1. `build-live.py` output contains no grade field. The scan covers the key names `task_completed_correctly`,
   `partial_credit` and `assertion_results`.
2. `select.mjs` refuses a labelled row and reads nothing under `host/`. A file-access spy enforces this.
3. Selection is deterministic, and ties go to `ARM_ORDER`.
4. Hygiene: the new sources contain no task names, grader check names or lab paths. Reuse the RL2 hygiene test's
   pattern.
5. `repair.mjs` with a scripted runner issues no step beyond its cap, and the control path makes no model call.

**Caps** (D22: non-frontier dev arms, $40 total, shared with the A1-C v2 chain's $24 of caps):

| Item | Cap |
|---|---|
| `a1s-look2` | $10 |
| RL2 | $3.5 cumulative |
| Haiku judge | $0.75 |
| VL-1R | $1 |
| **Total** | **≤ $15.25** (expected about $9) |

No Mercury tokens beyond the chain's (D18).

**Order and timing.**
1. Step 0 now.
2. Step 1 now, at concurrency 2 beside the Opus run.
3. Steps 2–4 as soon as `a1s-look2`, `a1c-v1m-look2` and `a0-look2` exist.
4. Step 6.
5. Step 5 after the v2 chain is graded.
6. Write-up in `vl1/RESULT.md`. README and `docs/RESEARCH.md` rows follow once the result is in.

---

## 6. Generic mechanisms for A1-C (v2.1)

A1-C v2 is frozen for its look-2 evaluation (D25). Every item here goes into the next version. That version's first
clean look is look 3 (23 tasks) or the last devCheck look (1 of 3 remains), so spend them carefully. Each item is generic
under H7 and is listed in KNOWLEDGE with its dev60 provenance (D21).

| # | Mechanism | Evidence (dev60) | Protocol | Priority |
|---|---|---|---|---|
| M1 | **Independent requirement ledger as the acceptance signal.** RL2's extraction runs over the request and the rule-bearing world records: K = 3 readers, a 2-of-3 merge for hard checks, code grounding of every literal and recipient. It is separate from the ledger that drives acting | RL2 held-out AUROC 0.837 against 0.47–0.58 for the pipeline's own checks; 53% of requirements cite a world record, not the request | A1, if fed by the inventory. **RL2 read the full initial world from prep, which H2 forbids inside A1.** Re-measure it at $0 with inventory-limited input (replay RL2 extraction on the stored A1-C inventories) before building it in | 1 |
| M2 | **Commit gate (plan-level verification).** The act session's intended writes are checked against M1's high-precision checks before they reach the world (msg_to, msg_has, created_has, created_in; the effect_any veto). v2's pre-send lint is the hook | Those checks have fail precision 0.94–1.00 across arms. The pre-act form avoids the repair hazard of §1.5 | A1 (one world, no forks). Also the deployable form of VL-1: draft or plan-level candidates, verify, commit one | 1 |
| M3 | **Idempotent effects.** Any re-attempt, repair or resend dedupes against the world's current effects and the session's write log: same recipient and subject, same channel and text, same record natural key | A1-C v1 wrote duplicates on 13/60 tasks per arm, against 0–2 for A0 and A1. Half of the judges' false rejections cite duplicates; a real user objects to them. v2 avoids the issue only by turning repair off (single pass) | A1 | 1, if repair returns |
| M4 | **Verifier-driven targeted repair.** Only failing HP hard checks, one round, additive and idempotent | Expected net −1 to +2 tasks: HP precision is 0.54–0.59 on the best arm's worlds | A1 | 2. **Shadow first:** log would-be repairs, and enable once precision on fresh tasks ≥ 0.7 (VL-1R measures it) |
| M5 | **Conventions** G4, G7, G9, G10 and G11 as code checks and brief rules; G1, G3, G6 and G14 as brief rules; G5, G8 and G15 as ledger rules (§3.3) | Up to 6 "reachable" and 2 "hard but fair" dev60 tasks; 4 of the 6 reachable failures of P2 picks fire an HP check | A1 (disclose under D21) | 2 |
| M6 | **Reader diversity.** One ledger reader from another model family | Three Haiku readers share their misreads, and medium reasoning did not help. Swapping in Mercury raised AUROC (0.855) but lowered F1, and 5 of 24 calls were truncated | A1 if the reader is Haiku-priced; mixed-model otherwise | 3 |
| M7 | **Re-read only contested items.** A second extraction pass only where readers disagree on an item's scope | Three of RL2's four design-fold selection losses are shared misreads of one eligibility, exclusion or status rule | A1 | 3 |
| M8 | **For forked modes only:** default plus **one** differently built challenger, chosen by M1 + judge (R3) | P2 +5 against P3 +0. Same-family forks lose (haiku-a1c pair: −1 to −3) | A1F only | VL-1 decides |

**Not recommended:**
- more or larger judges: errors coincide, and Sonnet is no better than Haiku;
- the learned selector as a verifier: it is at chance on the best arm;
- "duplicates do not count" leniency: it encodes the grader's tolerance, not a user's standard;
- G12 and G13.

---

## 7. Negative results and open risks (to `docs/RESEARCH.md`)

**Verifier and selector results:**
- The stored k = 3 cheap forks (m3-a1c, haiku-a1c, haiku-a1) gain nothing reliable with any verifier: 28–30 against 29,
  and 32 (CI [−2, +8]) only with the judge stacked on the learned selector, at 4.4–5.3× the cost.
- Diverse judges do not combine: κ 0.61–0.70 between judges, and no rule beats the best single judge.
- The learned selector on cheap telemetry is at chance on the best arm's worlds (AUROC 0.517).
- A judge that sees only the prompt and diff accepts 2 of 177 worlds.
- RL2 with medium-reasoning readers cost 2.7× more and scored worse.
- Combining RL2 with the Haiku judge (R3, R4) ties the better single signal on each slice. It does not exceed it.

**Open risks:**
- **P2 was found by looking.** It was chosen post hoc from about 60 selection cells. Four verifier families agree on
  it, and the headroom arithmetic explains it. Look 2 is its first honest test.
- **Look 2 is out of sample for v1-M.** The default fork may be weaker there; the selector then switches more, and its
  q is unmeasured off dev60.
- **RL2's advantage may partly come from full-world access.** That access is fine for an A1F selector. Inside A1 it is
  unavailable (M1 caveat).
- **Opus 5.5 xhigh on our CLI setup is unmeasured.** Its look-2 run is in flight.

---

## 8. Reproduce ($0)

`S=/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad`

| Command | What it produces |
|---|---|
| `node $S/judge/judge-eval.mjs > $S/judge/judge-eval.json` | the pre-declared rules R0–R6 on the pools; costs; pair oracles; repair counts; own checks by ceiling class |
| `node $S/judge/posthoc.mjs` | post-hoc pairs (§1.3, last table) |
| `node $S/judge/agree.mjs` | R1/R2 agreement on P2 |
| `node $S/judge/errcorr.mjs` | RL2 vs Haiku error overlap |
| `node $S/judge/pools.mjs $S/LOOK2-TASKS.json` | §4.1 task-set overlaps |
| official-rubric regrades of the two hard-defect reproductions: `$S/judge/regrade/*.json` | the §2 judge's check, via `bridge.py grade --input <prep>/input.json --world <repro world>` |

Inputs:
- the lab: `$S/vlab/dataset.jsonl` and `load.mjs`;
- RL2: `$S/rl2-out/checks-all.jsonl` and `judge-all.jsonl`;
- the Haiku judge: `$S/vlab/dj/judgments-haiku-world.jsonl`;
- code-checks: `$S/cc-out/eval-v1.1/rows.jsonl`;
- ceiling classes: `$S/vlab/dj/strata.json` (scoring only).

Designer reports:
- `$S/vlab/{code-checks,diverse-judges,requirement-ledger-v2,learned-selector,ceiling}.md`;
- code in `experiments/autobench/verifier/{code-checks,diverse-judges,requirement-ledger-v2,learned-selector}/`.
