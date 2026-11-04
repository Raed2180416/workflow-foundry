# RESULT-ROUTER-1: does this request need a workflow? (2026-10-21)

Owner ask B1/C2 ([REQUIREMENTS-COVERAGE-20261021.md](../REQUIREMENTS-COVERAGE-20261021.md)): detect whether a task needs a
workflow, from explicit primitives, a formula and a threshold, tuned so that requests pre-classified as not needing one never
trigger; a sensitivity slider; Jev for it. Preregistration: [router1/PREREG-ROUTER-1.md](router1/PREREG-ROUTER-1.md) (frozen in
`04db31b` before any router code or paid call; deviations D1-D4 recorded there before the outputs they could touch).
Data: [router1/SET.jsonl](router1/SET.jsonl), 319 requests with gold labels written before any router code (`72785e5`),
split by a hash rule into dev 126 / test 193. Rubric: [router1/RUBRIC.md](router1/RUBRIC.md).

*Amended 2026-11-04 after an adversarial review: the freeze-ordering record was wrong (v1.1 is development evidence on every
slice), test wording had leaked into the rubric, and several shipped statements were not held-out claims. Corrections are marked
in place and collected in [Review addendum](#review-addendum-2026-11-04); the preregistered v1 numbers did not change.*

## Verdict

1. **The preregistered code router fails the owner's never-trigger requirement on held-out requests.** At the default slider it
   wrongly suggested a workflow for 9 of 132 test requests that do not need one (6.8%; 95% upper bound 12.6%). It caught 41 of
   61 that do (recall 0.67). On dev, where it was tuned, it had 0 false triggers and caught every positive: the fit did not
   transfer. Claim C1 is **not met**.
2. **Asking Haiku directly is far better and costs almost nothing, but it fails the never-trigger requirement too.** 5 false
   triggers out of 132 at its default (95% upper bound 8.6%), recall 0.97, F1 0.944, AUROC 0.996, at $0.00026 and 4.3 s per
   decision. Its 7 errors are all on requests the labeller had marked as ambiguous; on the 160 unambiguous test requests it makes
   none (also on the 145 left after removing the leaked items, addendum §B). That agreement is with a rubric it was shown, written
   by the author of the labels. The code router does not match it: ΔF1 −0.205 [−0.306, −0.121], McNemar 4 vs 26, p < 0.001
   (the F1s are at two different operating points; threshold-free, AUROC 0.915 vs 0.996, and at Haiku's 5 false triggers the
   router would catch 0.62). Claim C2 is **not met**.
3. **Mercury 3 as a system: F1 0.900** (13 of 193 test calls gave no answer, counted as "no"; 5/132 false triggers, recall 0.885).
   On its 180 answers alone F1 is 0.947. Root cause of the faults (addendum §C): 11 calls spent the whole 1,000-token output cap
   on hidden reasoning; re-asked at 4,000 tokens on 2026-11-04 all 13 answered (largest 1,275 tokens), and the content-filter
   and non-JSON faults did not recur. With those answers Mercury is at 6/132, recall 0.934 (diagnostic: two caps, two dates).
4. **Jev was not measured.** This session has no Jev credential, and the documented launch path was refused by the sandbox
   (deviation D1). So Jev is not wired. Claim C3: "not measured".
5. **What the code is good for (post-hoc, diagnostic):** as a free pre-filter in front of the model judge. Clearing code p < 0.05
   skipped Haiku on 23% of test requests with identical decisions. The code's primitives are also the explanation shown to the
   user. The product does this when the host plugs in a judge; without one it answers with the code alone, labelled a hint with
   its measured operating point.
6. **A $0 learned baseline ranks as well as the hand-written lexicon** (post-hoc, frozen on dev before its test read): character
   n-gram logistic regression trained on the same 126 dev items has test AUROC 0.918 against the router's 0.915. At its
   out-of-fold never-trigger threshold it makes 1/132 false triggers but catches only 0.30. Neither $0 classifier reaches the
   bar at this data size; the lexicon's 8 detectors buy explanations, not accuracy.

The router is a negative result on the preregistered question and is preserved as such. No system tested meets "never
trigger" at its default. The capability that exists today is "ask a cheap model the typed question, with a free code
pre-filter and a slider on the model's percent", post-hoc and awaiting a sealed check by another labeller.

## Capability table (test split, n = 193: 132 do not need a workflow, 61 do)

| system | false triggers / 132 (95% upper) | recall | precision | F1 | AUROC | mode accuracy (4-class) | $ per decision | median / p95 latency |
|---|---|---|---|---|---|---|---|---|
| never (baseline) | 0 (0.028) | 0 | n/a | 0 | n/a | 0.653 | 0 | 0 |
| always (baseline) | 132 (1) | 1 | 0.316 | 0.480 | n/a | 0.130 | 0 | 0 |
| length (baseline, dev-tuned at 131 chars) | 57 (0.521) | 0.885 | 0.486 | 0.628 | 0.757 | 0.492 | 0 | 0 |
| keyword (baseline, 15 words) | 27 (0.283) | 0.705 | 0.614 | 0.656 | 0.750 | 0.580 | 0 | 0 |
| **router v1 (preregistered, frozen `f9641ff9`)** | **9 (0.126)** | **0.672** | 0.820 | **0.739** | **0.915** | 0.808 | **0** | **0.43 ms / 9.9 ms** |
| router v1.1 (D4, ships in `src/need/`; **development evidence**: frozen after test judge rows existed) | 8 (0.116) | 0.705 | 0.843 | 0.768 | 0.928 | 0.829 | 0 | 0.34 ms / 5.1 ms |
| n-gram logistic regression ($0 learned baseline; post-hoc, frozen on dev before its test read) | 1 (0.042) | 0.295 | 0.947 | 0.450 | 0.918 | n/a | 0 | 381 ms fit + score, all 193 |
| **ask Haiku 5.5 directly** | **5 (0.086)** | **0.967** | 0.922 | **0.944** | **0.996** | 0.953 | **$2.6e-4** | **4.3 s / 5.7 s** |
| **ask Mercury 3 directly (system: 13 faults counted as "no")** | **5 (0.086)** | **0.885** | 0.915 | **0.900** | 0.914 | n/a | $0 listed (1,140 tokens) | 1.3 s / 2.8 s |
| ask Mercury 3, the 180 answered only | 5/125 (0.091) | 0.982 | 0.915 | 0.947 | 0.974 | 0.950 | same | same |
| ask Mercury 3, the 13 faults re-asked at a 4,000-token cap (2026-11-04, diagnostic) | 6 (0.096) | 0.934 | 0.905 | 0.919 | 0.968 | n/a | same | |
| ask Jev directly | not run (D1) | | | | | | | |
| router + judge in the middle band (prereg step 4) | = router v1: the dev rule chose δ = 0, code only (below) | | | | | | | |

Per-item rows: `router1/runs/`. Full tables, slices, mode confusions and every miss: `router1/results/RESULTS-test-v1.md`
(primary) and `RESULTS-test-v1.1.md`. AUROC of the router on the same items as each judge: 0.915 (all 193), 0.920 (Mercury's 180).

**Slider (code router v1, test).** The sensitivity s ∈ [0, 1] maps to the threshold t(0) = 1, t(0.5) = t_default, t(1) = 0.

| s | threshold | false triggers | recall |
|---|---|---|---|
| 0 | 1 | 0 | 0 |
| 0.25 | 0.696 | 0 | 0.426 |
| 0.5 (default) | 0.393 | 9 | 0.672 |
| 0.75 | 0.196 | 25 | 0.869 |
| 1 | 0 | 132 | 1 |

The code router meets "never trigger" on test only at s ≤ 0.25, where it catches 43% of positives.

## Endpoints and claims

- **E1 never-trigger (primary): 9/132 (v1).** The requirement was 0, so it fails. Each false trigger is root-caused below.
- **E2:** recall 0.672, precision 0.820, F1 0.739 (v1).
- **E3 router vs Haiku:** ΔF1 −0.205 [−0.306, −0.121] (2,000-replicate paired bootstrap). McNemar: router-only correct 4,
  Haiku-only correct 26, p < 0.001. Cost per decision: $0 vs $0.00026. The router is far below 1/10 of the cost, but nowhere
  near Haiku's quality.
- **E4 ROC:** AUROC router 0.915, Haiku 0.996, Mercury 0.974, keyword 0.750, length 0.757. The slider table is above.
- **E5 mode accuracy:** router 0.808, Haiku 0.953, Mercury 0.950. The router's typical mode error is a "workflow" or
  "recurring" request read as "none" (20 of 61 positives).
- **E6 cost and latency:** the table above. Judge totals: Haiku $0.1455 for 638 calls (both splits, 2 samples each), Mercury
  368,553 metered tokens for 319 calls, router $0.
- **E7 breakdowns (v1):**
  - **Text by other authors.** On the Mercury-written requests the router has recall 0.41 and F1 0.48. On requests from the
    router's own author it has F1 0.86. Haiku scores 0.97 and 0.93 on the same two slices.
  - **High-confidence labels only:** router 7/112 false triggers, recall 0.77. Haiku 0/112, recall 1.0. Mercury 0/109, recall 1.0.
  - **Anchor beds** (shortcut breakers, 14 negatives): router 2 false triggers, keyword 8, Haiku 0.
  - **Haiku samples 0 vs 1:** 3 mode flips and 2 needsWorkflow flips out of 193.
- **C1:** not met. **C2:** not met. **C3:** Jev not measured, so not wired.

**Predictions (prereg §5) vs outcome.**

| system | predicted | outcome |
|---|---|---|
| router | false triggers 0-3, recall 0.70, F1 0.80, AUROC 0.92 | 9, 0.672, 0.739, 0.915 (false triggers worse than predicted) |
| Haiku | false triggers 3-10, recall 0.85, F1 0.82, AUROC 0.90, flips 3-8% | 5, 0.967, 0.944, 0.996, flips 1% (better than predicted) |
| Mercury | F1 0.75-0.85, false triggers 3-12 | 0.947 on answers, 5 |
| hybrid | the dev rule picks δ 0.1-0.2 | it picked δ = 0 (below) |
| keyword | false triggers ≥ 15, recall ≈ 0.8 | 27, 0.705 |
| length | AUROC ≈ 0.65 | 0.757 |

## Why the middle-band judge was never used (step 4)

The preregistered rule picks the (judge, δ) with the highest dev recall among choices with 0 dev false triggers. Because the
router was tuned on dev, it already had dev recall 42/42. Every band could therefore only add dev false triggers: Haiku added
1-2 and Mercury 1-5. So the rule chose code only. This is a design flaw in the protocol rather than evidence about the judges:
a band chosen on the same data the router was fitted to cannot show its value. A future version should set the band on
out-of-fold dev scores.

## Root cause of every router miss (v1, 29 misses; the per-item list is in `RESULTS-test-v1.md`)

**False triggers (9). Each one is content, not intent.**
- *A question about a policy that contains approval words.* "Our policy says refunds over $500 need two approvals. Is the refund
  in this email compliant?" Waits fired at 0.90 on "need two approvals" and rules at 0.81. The question dampener (0.58) was
  weaker. The detectors cannot tell that the sentence quotes a rule rather than asking for an approval.
- *A description of a current process plus a request for advice.* me-m-devops-7: "deployments to prod still require the CTO
  ... waiting for approval". Waits fired on the description.
- *One record with several fields updated.* me-m-bizauto-6 and me-m-bizone-2 (ATS and Salesforce updates). The several-effects
  cue counts distinct verbs ("update, mark, schedule, sync"), so it reads one record edit as a multi-system process.
- *An artifact named after a period, in a writing request.* "a short paragraph ... why we moved the weekly status call".
  Recurrence 0.55 and reuse 0.45 fired. The writing dampener only looks at the first words of the request.
- *A schedule inside the given material.* The anchors need-constraint-s603 (a staff rota whose rules say "Every evening ...")
  and need-stage-s603 (a step of a research synthesis). Recurrence or volume fired on the material itself. The question
  dampener (0.86) could not outweigh recurrence 0.95 plus rules 0.81.
- *A policy-guided one-off.* me-m-bizauto-2 ("Can you handle that for me": the take-over cue read "you handle" as a standing
  duty) and ab-sales.dependency_chain (policy plus create plus email, labelled none with medium confidence).

**Missed workflows (20). The detectors' word lists do not cover how other people phrase a process.**
- *Waits phrased with verbs outside the lexicon* (4): au-biz04 ("countersign once legal approves ... check in with their
  admin after 30 days"), me-m2-process-1 ("send it to legal for review, then loop in Sarah for approval"), me-m2-process-8
  ("push it through the risk team, then get the PO signed"), me-m2-program-2 ("pause and confirm with me before each stage").
- *A rule-bound program weighted too low* (2): au-rp02 (a preregistered evaluation; rules 0.59 alone is not enough) and
  me-m2-program-5 (a red-team test under rules of engagement, where the configure dampener fired on "Set up ... staging
  environment").
- *Triggers and standing duties phrased differently* (8):
  - "You're now responsible for tracking ... Every time we get a new order" (wrongly scoped as descriptive by v1's "every time
    we" rule).
  - "When a candidate has been in status X for more than 5 days, send ...".
  - "at the end of each study session".
  - "Set me up a weekly review".
  - "keep an eye on X and tell me when" (0.70 alone is not enough).
  - "this month's ..., same format as last month" (wrongly scoped as retrospective by v1).
  - "Set up a recurring reminder every Monday to check the sales pipeline and flag any stalled deals" (the bare-reminder
    dampener fired, but this reminder carries work; gold recurring, medium confidence).
  - "audit our AWS billing for the last quarter ..." (gold recurring, medium confidence).
- *A business process over items with no word for its effects* (6):
  - au-oss11 ("go through all 1,200 issues, label each, close duplicates": "1,200 open issues" missed the noun list).
  - The AutomationBench prompts competitive_displacement_outreach ("Run the competitive displacement campaign for Q1"),
    commission_calculation (the leading "Calculate" fired the question dampener at 0.73), utm_audit_and_fix,
    contract_renewal_pipeline and helpscout_customer_merge.
- *A dampener that over-fires:* `one-effect` (singleAction 0.45) fired on most of the misses above, because their other actions
  use verbs outside the effect lexicon.

**The common root cause.** The detectors are lexical, written by one author, and tuned on 126 dev requests. On text by other
authors (Mercury-written requests, AutomationBench prompts, anchor beds) recall drops from 0.80 to 0.61. On authored text it is
0.80. A cheap model reads intent, such as "a quoted rule is not a request" and "a process with unnamed effects is still a
process", which a lexicon of this size does not reach. **Testing found this, and dev did not:** 5-fold dev cross-validation
predicted 1 false trigger in 84 and recall 0.95.

## v1.1 (deviation D4): what changed and why it is development evidence

A product test written for the integration exposed a v1 defect: "Every Monday at 9, pull last week's signups ..." was routed to
none, because the retrospective scope ("last week") switched off the schedule. Thirty-six synthetic probes found 6 such defects.
v1.1 fixed them and was refitted on dev. On test it improves slightly: 8 false triggers (from 9), recall 0.705, F1 0.768, AUROC
0.928. **It is development evidence on every slice.** *[Corrected 2026-11-04: this section said v1.1 "was frozen before any test
output existed". It was not: when v1.1 was committed (21:43:37Z) all 193 Mercury test rows and 342 of 386 Haiku test rows
existed (PREREG §9 C1).]* The probes were written by the same model that authored the set's items, and five of them closely
paraphrase authored test items (token Jaccard 0.30-0.41, above the dev-to-test p90 of 0.33; one is au-rp02); the new cues
`program-stages` and `w3-program` fire on no dev item and on exactly one test item, au-rp02. On the independent-text slice, v1.1
has 7/72 false triggers and recall 0.66, against v1's 8/72 and 0.61.

## Post-hoc analyses (after the test was read; rules chosen on dev; diagnostic only): `router1/results/POSTHOC-test.md`

- **Haiku's percent as the slider score.** The dev never-trigger rule (t = 0.92) gives 0/132 false triggers on test, but recall
  only 0.557. At t = 0.8 the result is 1 false trigger with recall 0.934 on test, and the same pattern on dev (1/84, 0.929).
  Haiku's percent is a usable, monotone slider. The code router's p is not good enough to carry one.
- **Cascade: the code clears p < L and Haiku decides the rest.**
  - L = 0.05: Haiku is asked on 77% of requests, and decisions are identical to Haiku alone (5 false triggers, recall 0.967).
  - L = 0.1: 58% asked, 3 false triggers, recall 0.90.
  - The dev-chosen L (out-of-fold, 0.319) was too aggressive: 2 false triggers but recall 0.77.
  - The product uses L = 0.05. That value was chosen after seeing this frontier, so it needs a sealed confirmation.

## What ships

- `src/need/primitives.mjs` holds the eight primitive detectors: recurrence/schedule, waits/long horizon, irreversible or
  external effects, multiple systems/actors, exactness/compliance rules, volume/fan-out, audit, reuse. It also holds the five
  dampeners (question/writing/analysis, mention, hypothetical, single action, coding/configuration). Each detector returns a
  score in [0, 1] with the words that fired it. Optional structured context (a known schedule, the systems, the volume,
  irreversibility) can only raise a primitive.
- `src/need/router.mjs` provides the calibrated score and four entry points:
  - `needCheck(text, {sensitivity, context})`: code only, $0, under 1 ms. It returns the slider threshold, the mode (none,
    checklist, workflow, recurring), the reasons and the paramsSha.
  - `needDecide`: the preregistered middle-band design.
  - `needCascade` (post-hoc): code clears p < 0.05, and a judge decides the rest with the slider on the judge's percent.
  - `modelJudge(port, modelId)`: the typed question over a ModelPort, for Haiku or Mercury.

  `params.json` is fitted on dev only and carries a detector-version guard.
- `src/need/advice.mjs` (re-exported by `app/core/need.mjs`) gives a plain-words answer plus the **measured operating point of
  the decider that produced it, at the sensitivity it was asked with**, from `src/need/reliability.json` (generated by
  `router1/addendum.mjs` from the committed rows), with its evidence grade: code only (v1.1, development evidence), the Haiku
  cascade and the Mercury cascade (post-hoc), each at s = 0, 0.25, 0.5, 0.75 and 1; any other sensitivity says "uncalibrated".
  A code-only answer starts "Code-only hint" and ends "Treat it as a hint". Every answer carries `score` (the deciding score and
  its bar: the judge's percent and bar when a judge decided) beside the code's p. *[Changed 2026-11-04: the first version gave
  one statement for every decider, Haiku's numbers to a Mercury judge, the code's label to requests the cascade cleared, mixed
  v1 and v1.1, and called post-hoc numbers held-out (review M4).]*
- **The slider ends are hard in every path** (s = 0 never, s = 1 always, no judge call), and raising s never removes a trigger.
  *[Fixed 2026-11-04: in the cascade a 100% judge answer triggered at s = 0 and the 0.05 clearing bar blocked triggers at s = 1
  (review M2).]*
- **Surfaces:**
  - app MCP tool `need_check`: read-only. Without a host judge it is a $0 code-only hint and its description says so with the
    preregistered operating point (67% caught, 7% false triggers). With `node app/cli.mjs mcp --need-judge haiku|mercury
    [--need-cap-usd 0.5]` it runs the cascade with a capped judge (`cappedJudge`: $0.05 per call, the cap per server process;
    past it the judge refuses with JUDGE_BUDGET and the answer is the code's, recorded as a judge fault).
  - Every `propose_flow` result carries a `need` field. Its reply adds "No workflow needed" only when a judged (cascade) decision
    says so. *[Changed 2026-11-04: it was added on the code-only answer, which misses a third of the requests that need a
    workflow (review M3).]*
  - engine MCP tool `foundry_need_check`: code-only hint, same description; a host-judge hook there is left until after the
    engine v2 merge (patch 0011 edits the same lines of `src/mcp.mjs`).
  - CLI `node app/cli.mjs need "REQUEST" [--sensitivity s] [--judge haiku|mercury]`. With `--judge`, the model is asked unless
    the code clears the request, through the repo's ModelPort ($0.05 per call; Mercury with a 4,000-token output cap).
- The frozen v1 router stays runnable in `experiments/need-router/router1/frozen-v1/`.

## Budget

| item | cap | spent |
|---|---|---|
| Haiku | $3 | **$0.146** (638 judge calls $0.1455, plus a smoke call and 2 CLI checks) |
| Mercury | 0.5M tokens | **≈ 402K** (author pass ≈ 15K, smoke 0.7K, dev 148.6K, test 220.0K; meter totals; plus 17.7K on 2026-11-04 to re-ask the 13 faulted test calls at a 4,000-token cap) |
| Jev | policy budget | 0 (not run, D1) |

## Evidence grade and caveats

- **The test split is held out from tuning, but the labels come from the same author.** One author (the ROUTER-1 author, Claude
  Opus 5.5) wrote the rubric, every gold label, 133 items, the router, and the judge prompt that condenses the rubric. Haiku's
  high agreement is therefore agreement with a rubric it was shown. It is not independent evidence that these requests "need a
  workflow" in the counterfactual sense (whether a workflow raises success or lowers cost: DESIGN.md §2, not measured here).
- **Each judge read each item once** (Haiku twice; flips 1%). This is classification agreement, not a K=1 claim about task
  success.
- **v1.1 is development evidence on every slice** (above; PREREG §9 C1). The cascade and Haiku-slider numbers are post-hoc.
- **Test wording leaked into the rubric, the judge prompt and the detectors** (PREREG §9 C2; addendum §B). Re-scored without the
  6 quoted test items, the 2 that share their pattern and the 18 hit by v1 cues that fire on no dev item, no system's false
  triggers change and recall moves by at most 0.03; the shared author of rubric, labels and prompt remains.
- **Mercury-written requests are not cluster-held-out:** all 14 generation calls put requests on both sides of the split
  (addendum §F). On the cluster-clean slice (AutomationBench prompts, anchor beds, policies, specs; 46 items) router v1 has
  3/22 false triggers and recall 0.75, Haiku 2/22 and 0.96.
- **What the router author saw before step 5.**
  - All 126 dev items were read, with long texts truncated.
  - From the test split, only one item was seen: au-q02, in the first 1,500 bytes of SET.jsonl, read while orienting.
  - No test item was scored before step 5.
  - The anchor bed definitions were deliberately not read during tuning.
  - The prior session's author, the same model, wrote the authored and Mercury-prompted items. That shared phrasing is the
    risk the authored-vs-independent slices expose.
- **Integration slips** in `f13864a5`, a commit labelled FROZEN: a wrong `execute` index in `app/mcp/server.mjs`, and a missing
  comma in `src/mcp.mjs` that made the engine tool list throw. Both were caught by the new tests and fixed in `297a303e`; the
  tests had not been run before the freeze commit (PREREG §9 C4). The position-based patch is now a lookup by name.

## Next

1. **Sealed confirmation with an independent labeller:** [router2/PROTOCOL-ROUTER-2.md](router2/PROTOCOL-ROUTER-2.md) (draft).
   Rubric and prompt frozen first, then the owner writes and labels the requests; primary system Haiku-direct at a percent bar
   of 0.80 chosen on all 319 ROUTER-1 requests (pooled 2/216 false triggers, recall 0.93); "never trigger" read as a target
   false-trigger rate with a Clopper-Pearson bound, which needs at least 72 negatives for 5%.
2. **Jev:** run `judges.mjs --judge jev --split dev|test` (1,116 requests, under the 1,200 cap) once the owner maps the key.
   Then compare Jev against Haiku on the same items, and against the cascade cost.
3. **If a code-only path is still wanted** (offline, $0), stop extending the lexicon.
   - Option A: train a small classifier on Haiku-labelled requests (distillation).
   - Option B: give the router out-of-fold calibration and a two-sided band.
   - Either way, measure on the sealed set.
4. **The counterfactual question** (does the workflow actually help on these requests) is still open. It is the label factory in
   DESIGN.md.

## Review addendum (2026-11-04)

An adversarial review (verdict: the negative result stands; the record and the product surface did not) raised 1 blocker, 6 major and 12 minor findings. The $0 re-analyses are in
[router1/results/ADDENDUM-REVIEW.md](router1/results/ADDENDUM-REVIEW.md) (generated by `router1/addendum.mjs`; everything except
its §A is post-hoc and diagnostic). One paid diagnostic ran: the 13 faulted Mercury test calls re-asked at a 4,000-token cap
(17.7K Mercury tokens, $0 listed). Haiku: $0.

| finding | disposition |
|---|---|
| **B1** freeze-ordering record false | **Fixed in the record**: PREREG §8 annotated in place and §9 C1 added; the commit/row timeline is addendum §A. Confirmed exactly: 68 dev rows (28 Haiku, 40 Mercury) existed at the D1/D2 commit; 193/193 Mercury and 342/386 Haiku test rows at the v1.1 commit; D3's and D4's times were wrong. v1.1 is development evidence on every slice. |
| **M1** test wording leaked into rubric, prompt, detectors | **Disclosed and re-scored** (PREREG §9 C2; addendum §B). 6 quoted test items, 2 with the same pattern, 6 v1 cues firing on 18 test items and no dev item. **Partly disagree on size:** excluding all of them changes no system's false-trigger count and moves recall by at most 0.03; Haiku's 0 errors on high-confidence labels holds on the 145 that remain. The indirect dependence (one author for rubric, labels and prompt) cannot be re-scored away; ROUTER-2 freezes rubric and prompt before another person writes the items. |
| **M2** slider broken at the ends in the judge path | **Fixed** (`src/need/router.mjs`) with tests that fail on the old code: hard ends in `needCascade` and `needDecide`, clearing bar only for 0 < s < 1, monotone in s. |
| **M3** product ships the failed router by default, described falsely | **Fixed**: code-only answers are labelled hints with the preregistered operating point; the tool description no longer claims "tuned so ... do not trigger"; the `propose_flow` note needs a judged decision; the host can plug in a capped Haiku or Mercury judge (`mcp --need-judge`). The default stays code-only because no model may be called without the host choosing one. |
| **M4** reliability statements not held-out claims | **Fixed**: one measured statement per (decider, sensitivity) from `reliability.json`, graded "development evidence" or "post-hoc, sealed confirmation pending"; unmeasured sensitivities say "uncalibrated" (as ROADMAP §2.8 asks); Mercury has its own numbers; a test replays the Haiku rows through the shipped cascade and must reproduce the file. |
| **M5** protocol could not test the requirement or the band | **Agreed and examined post-hoc** (PREREG §9 C3; addendum §E). The E1 = 0 rule passes with probability ≈ 84/216 = 0.39 for any exchangeable score. Out-of-fold, v1 makes 1/84 dev false triggers (recall 0.95), so a band can now be chosen; the post-hoc OOF rule picks Mercury, one-sided, δ = 0.1, which on test gives 10/132 and recall 0.72: **a one-sided band (the judge may only raise) cannot remove the code's false triggers**, which sit above the threshold. A two-sided band (the judge decides near the threshold) reaches 3/132 and recall 0.85-0.90 with Haiku at δ 0.2-0.3 on test, but 84 dev negatives cannot tell it apart from the one-sided choice. "Never trigger" is restated as a target rate with a Clopper-Pearson bound in ROUTER-2: zero false triggers in 72 / 183 / 368 negatives bound the rate at 5% / 2% / 1%. |
| **M6** ask not closed at its core | **Agreed; kept visible** (README, coverage matrix ⚠). Not done: launching a workflow from the decision, the counterfactual value of a workflow on these requests, Jev, and requests that are "the most realistic hardest" (median 167 characters; most written by the label author or from rubric-like prompts). |
| m1 Mercury generation calls straddle the split | **Disclosed** (all 14 of 14; addendum §F, cluster-clean slice reported); `build-set.mjs` has `generationCluster` for future sets; the frozen split is unchanged. |
| m2 generic key wrapper used before it was recorded | **Fixed**: `with-inception.sh` runs only the Mercury judge pass; PREREG D2 annotated. |
| m3 FROZEN commit with broken wiring | **Recorded** (PREREG §9 C4); rule: run the touched tests before a FROZEN commit. |
| m4 judged answers reported the code's p | **Fixed**: `score {by, p, threshold}` of the decider; the CLI prints both. |
| m5 `defs[0]` patched by position | **Fixed**: by name. |
| m6 tests without teeth | **Fixed**: `router1-stats.test.mjs` checks the statistics against independent closed forms; params shas pinned; context-never-lowers on every feature; CLI `need`; host-judge MCP path. |
| m7 Mercury headline on survivors | **Fixed**: the table leads with the system number (F1 0.900). |
| m8 `closeCall` never fires | **Removed.** |
| m9 unrecorded conflict with ROADMAP §2.8 | **Recorded here.** ROADMAP §2.8: code guards only add structure, typed judgments do not pick the mode, and a router is built only after the RX1 headroom sweep. ROUTER-1 follows the owner's later ask [74] (primitives, a formula, a threshold, a slider) instead: the cascade's judge decides the side, can overrule a code trigger, and its mode is used; RX1 was not run. Keeping the code as must-trigger guards (review "cheaper" #2) was not adopted: the lexical recurrence and wait cues fire on quoted material (the rota anchor, the approval-policy question), so as guards they would force false triggers. **This needs the owner's decision.** |
| m10 efficiency | **Partly fixed**: Mercury's product cap is 4,000 (the re-ask answered 13 of 13). Not changed: the rubric stays in the user turn of the measured prompt (moving it changes the measured system; allowed in ROUTER-2 before its freeze); the 4.3 s median is the Claude CLI's per-call overhead. |
| m11 no $0 learned baseline | **Added** (`baseline-ngram.mjs`, frozen on dev in `1f8e27c0` before its test read): AUROC 0.918 vs the router's 0.915; 1/132 false triggers and recall 0.30 at its out-of-fold never-trigger threshold. |
| m12 "nearly meets the bar" | **Fixed**: Haiku fails never-trigger at its default too (Verdict 2). |

## Reproduce

```
node experiments/need-router/router1/fit.mjs --diag            # dev features and p (v1.1)
node experiments/need-router/router1/eval-router1.mjs --split test --router v1      # preregistered primary
node experiments/need-router/router1/eval-router1.mjs --split test --router v1.1
node experiments/need-router/router1/posthoc.mjs               # post-hoc (a) and (b)
node experiments/need-router/router1/baseline-ngram.mjs --split dev|test            # $0 learned baseline (review m11)
node experiments/need-router/router1/addendum.mjs              # review addendum A-H, writes src/need/reliability.json
set -a; . /root/.config/foundry/inception.env; set +a; node experiments/need-router/router1/mercury-refault.mjs   # paid: Mercury tokens
node --test --test-concurrency=1 tests/need-router.test.mjs     # then app/test/need.test.mjs, experiments/need-router/test/router1-judges.test.mjs,
                                                                #  experiments/need-router/test/router1-stats.test.mjs, one at a time
```
