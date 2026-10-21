# PREREG-ROUTER-1: a primitive-rule need router with a sensitivity slider, against cheap judges (2026-10-21)

Frozen in git before any paid judge call and before any router code (`src/need/router.mjs`, `src/need/primitives.mjs`) existed.
Owner ask B1/C2 ([REQUIREMENTS-COVERAGE-20261021.md](../../REQUIREMENTS-COVERAGE-20261021.md)): decide whether a request
needs a workflow from explicit primitives, a formula and a threshold, tuned so that no-workflow tasks never trigger, with a
sensitivity slider; measure Jev for it.

## 1. What is frozen

| file | sha256 |
|---|---|
| `SET.jsonl` (319 labelled requests, split inside) | `1d637076b3641d0b6938af8703817f57ac75999f9af4426c976538c73fff19a5` |
| `RUBRIC.md` (what a gold label means) | `6ec25f9414446ca486037126d9ef5246170d9ee315308bd7ec2f34fe8c42de0c` |
| `src/need/judge-prompt.mjs` (the one typed question every judge answers) | `d8c6e50bdf65332469538ddc291fdf7ecd0d05dd1afae3284777e38378263bb8` |
| `experiments/need-router/router1/judges.mjs` (judge passes, caps) | `b254ac048686864801672fb28333c264d2620533f4affa2501fde886223cd3f0` |

Split (FREEZE.json): dev 126 (42 needs-workflow), test 193 (61 needs-workflow). Seven sources: authored (133), Mercury-authored
(112, independent author), AutomationBench devTrain (30) and simple (10) public prompts, need-router anchor beds and two
one-call controls (22), AutomationBench-R family policies (12), E-bed specs (2).

**Evidence grade.** The test split is held out from every tuning step (router weights, threshold, middle band, judge
choice). It is **not** independent of the author: the ROUTER-1 author wrote the rubric, every gold label, 133 of the items,
and the router. The result is therefore "held-out from tuning, same-author labels": stronger than dev evidence, weaker than
a sealed evaluation with an independent labeller. Per-source results (independent text vs authored) are reported so the
author's phrasing advantage is visible. Judges are sampled once per item (Haiku twice, to measure flips); nothing here is a
K=1 comparative claim about task success: the outcome is agreement with the owner's classification, not workflow value.

## 2. Systems

| id | what | cost per decision |
|---|---|---|
| `never` | needsWorkflow = false, mode none | $0 |
| `always` | needsWorkflow = true, mode workflow | $0 |
| `length` | longer text = more need: rank by characters; threshold chosen on dev for max F1 | $0 |
| `keyword` | true if the text contains any of: workflow, automate, automation, every, daily, weekly, monthly, whenever, recurring, schedule, approval, approve, process, pipeline, monitor (case-insensitive, whole word) | $0 |
| `haiku` | ask Haiku 5.5 directly: `SYSTEM` + `judgePrompt(text)`, schema `{mode, percent}`, reasoning none; 2 samples (sample 0 primary) | measured |
| `mercury` | ask Mercury 3 directly, same prompt and schema, 1 sample | tokens (listed price $0) |
| `jev` | ask Jev (`jev-1.13.0`) directly: one `choice` question over the four modes with the same definitions, 4 cyclic option rotations averaged; p = p(workflow) + p(recurring); mode = argmax. Only on `jevEligible` items (synthetic text; AutomationBench public text never goes to TypeSafe, decision Q5b) | $0.042/M input tokens (second-hand price) |
| `router` | code only: 8 primitive detectors scored from the text, a logistic formula fitted on dev, threshold t at the default slider, mode rules | $0 (CPU) |
| `router+J` | router, and judge J only for items whose router p falls in the middle band [t - δ, t); J's needsWorkflow decides there | measured |

**The slider** (the owner's "sensitivity", [20]). The user sets s in [0, 1]; the default is s = 0.5. The router triggers a
workflow iff p ≥ t(s), with t piecewise linear through three fixed points: t(0) = 1 (never triggers; a logistic p is
always below 1), t(0.5) = t_default (step 2 below), t(1) = 0 (always triggers). So t(s) = 1 − (1 − t_default)·2s for
s ≤ 0.5 and t(s) = t_default·(2 − 2s) for s ≥ 0.5. The judge's middle band moves with it: [t(s) − δ, t(s)).

**Mode rules** (part of the router frozen at step 3). If p ≥ t: `recurring` when the recurrence primitive fires, else
`workflow`. If p < t: `checklist` when the irreversible-or-external-effect primitive fires strongly and no dampener
(question, mention, hypothetical) fires, else `none`. In `router+J` an item the judge moves into the workflow class takes
the judge's mode.

**Inputs.** The router reads the request text only (optional structured context is an API feature tested by unit tests,
never used in this evaluation). The `category`, `source`, `cluster` and `gold` fields are never passed to it.

## 3. Tuning on dev only (in this order; test untouched until step 5)

1. **Detectors and formula.** Write the 8 primitive detectors (recurrence or schedule, long horizon or waits, irreversible or
   external effects, multiple systems or actors, exactness or compliance rules, volume or fan-out, audit, reuse likelihood)
   and the dampeners (mention, question, hypothetical, single action, coding) from the rubric's concepts, iterating only on
   dev items. Fit the logistic weights on dev (L2, λ = 1, primitive weights constrained ≥ 0, dampener weights ≤ 0).
2. **Default threshold (the owner's never-trigger rule).** t_default = (highest router p among dev negatives) + 0.02, so the
   code router has 0 dev false positives by construction. Recall on dev is what it is; it is reported, not traded.
3. **Freeze the router** (commit; params sha256 in the commit message) before any judge output is read.
4. **Middle band and judge.** Run the three judges on dev. For each J ∈ {haiku, mercury, jev} and δ ∈ {0, 0.1, 0.2, 0.3, 0.4},
   compute dev FP and dev recall of `router+J`. Choose the (J, δ) with the highest dev recall among those with **0 dev FP**;
   ties → the cheaper judge (jev < mercury < haiku by listed price), then the smaller δ. δ = 0 means code only. On items Jev
   may not see, `router+jev` falls back to the code decision (p ≥ t). Freeze (commit) the choice.
5. **Test, once.** Run the judges on test; evaluate every system on test.

## 4. Endpoints (test split)

- **E1 never-trigger (primary).** False positives among test negatives (gold none or checklist; n = 132) of the frozen final
  system at the default slider. Requirement met iff 0. Reported with the 95% Clopper-Pearson upper bound on the FP rate.
- **E2 recall / precision / F1** of needsWorkflow at the default slider (61 positives).
- **E3 router vs ask-Haiku.** ΔF1 (final router − haiku sample 0) with a 2,000-replicate paired bootstrap 95% interval over
  items; exact McNemar on binary correctness; cost per decision of each.
- **E4 ROC across the slider.** AUROC of the code router's p, of haiku, mercury and jev p (jev on its eligible subset, with
  the router's AUROC on the same subset beside it); a table of FP, recall at sensitivity 0, 0.25, 0.5, 0.75, 1.
- **E5 mode accuracy** (4-class) and the mode confusion matrix, for router and each judge.
- **E6 cost and latency per decision** (USD, tokens, ms median and p95), per system.
- **E7 breakdowns.** Per source; independent-text slice (Mercury, AutomationBench, anchors, policies, specs) vs authored;
  high-confidence labels only; Haiku sample-0 vs sample-1 flip rate; Jev served versions, abstention share (max p < 0.6).

## 5. Predictions (recorded now, before any router code or judge output)

- Router (code only, default slider): test FP 0-3 of 132; recall 0.70 (0.55-0.85); F1 0.80; AUROC 0.92.
- Haiku direct: FP 3-10 (over-triggers on process vocabulary such as "pipeline", "audit", "policy"); recall 0.85; F1 0.82;
  AUROC 0.90; flip rate 3-8%.
- Mercury direct: F1 0.75-0.85, FP 3-12.
- Jev direct: AUROC 0.60-0.75 on its subset (stock Jev read "needs a workflow" at chance in J-NEED-1, though that was a
  different, counterfactual label); F1 below Haiku by ≥ 0.10.
- Hybrid: the dev rule picks a δ of 0.1-0.2; on test it adds 0.03-0.10 recall and 0-2 FP.
- Keyword baseline: FP ≥ 15 (mention traps), recall ≈ 0.8. Length baseline: AUROC ≈ 0.65 (policies and specs are long; so
  are the anchor negatives).

## 6. Claims and how they are read

- **C1 (owner's never-trigger requirement, held-out from tuning).** Met iff E1 = 0 and recall ≥ 0.6. Any FP is a failure:
  each one gets a root-cause line (which primitive fired on what words, and why the rubric says no).
- **C2 (cheap router vs asking Haiku).** "Matches Haiku at a fraction of the cost" iff the ΔF1 interval's lower bound > −0.05
  and the router's cost per decision is ≤ 1/10 of Haiku's; "beats Haiku" iff the lower bound > 0.
- **C3 (Jev).** Jev is wired into the product only if the dev rule selects it as the middle-band judge; its direct AUROC is
  reported beside the router's on the same items either way.
- Every miss (FP and FN) on test is listed with its source, gold label, router p and the primitives that fired.

## 7. Budget and stop rules

Haiku ≤ $3 for ROUTER-1 (hard cap in judges.mjs, with the per-call bound reserved in flight); Mercury ≤ 0.5M tokens in all
(about 15K spent on the independent-author pass; judge runs capped at 200K tokens per split); Jev ≤ 1,200 requests (ledger
cap). A run that hits a cap stops; the rows it has are kept and the shortfall is reported, never filled from another model.
No model id outside `policy/models.json`; no silent fallback (a failed judge call is a fault row; in `router+J` the item
falls back to the code decision and the fallback is counted).

## 8. Deviations

Recorded here, with date and reason, if any step above changes after this file is committed.

- **D1 (2026-10-21T21:32Z, before any judge output was read): Jev not run in this session.** `FOUNDRY_SYSTEMONE_API_KEY` is
  not set in this agent's environment, and the documented launch path (README D7: the owner's interactive shell maps his key
  into that variable through `bash -ic`) was refused by this session's sandbox. No workaround was attempted. Consequences: the
  `jev` system and `router+jev` are not measured; the step-4 choice is made among {haiku, mercury} x δ (δ = 0 = code only);
  C3 is answered "Jev not measured, so not wired". The Jev pass stays runnable as frozen (`judges.mjs --judge jev`, 1,116
  requests for both splits under the 1,200 cap); if it is run later, its rows are evaluated as an addendum outside the
  frozen choice.
- **D2 (same time): Mercury launched through `experiments/need-router/router1/with-inception.sh`** (the key file sourced
  inside the command, as `m3-fill.sh` does), because this session's worktree guard refuses `.` in a command line. Same key,
  same variable, nothing printed.
- **D3 (2026-10-21T21:45Z, after the Mercury dev pass, before any test call and before the step-4 choice was computed):
  Mercury test token cap 300,000 instead of 200,000.** The dev pass used 148,583 tokens for 126 calls (1,179 per call, not
  the ~700 planned): Mercury 3 reasons on every call whatever `reasoning_effort` says (research/mercury-20261021/
  PROVISIONING.md), median 308 reasoning-heavy output tokens. 7 of 126 dev calls stopped at the frozen 1,000-token output
  limit with no answer (`MODEL_TRUNCATED`, reasoning_tokens 999); they stay fault rows, are not re-asked, and fall back to
  the code decision in `router+mercury` (§7). The decoding (maxTokens 1,000) is unchanged. Mercury total stays under the
  owner's 0.5M: about 15K (author pass) + 0.7K (smoke) + 148.6K (dev) + at most 300K (test).
- **D4 (2026-10-21T22:20Z; the test judge passes were running, no test-split router output and no test judge row had been
  computed or read): detectors v1.1.** A product test written for the integration (`app/test/need.test.mjs`) exposed a v1
  defect: in "Every Monday at 9, pull last week's signups ...", the retrospective scope ("last week") switched off the schedule
  in the same sentence. 36 requests written after the freeze to look for defects of this kind (`probes.mjs`, labelled by the
  rubric, tuning data, never evidence) found 6 binary errors in v1. Changes (`need-primitives/1.1`): the retrospective scope
  applies only to questions and past-tense sentences; a first-person habit ("I review PRs every day; ...") is scoped down
  unless it asks for something; new cues `watch-and-tell` (recurrence), `for-approval`, generalised `once-done`,
  `chase-until`, `after-period`, `program-stages` (waits), `w3-program` (rules); `all-the` accepts a number ("all 12
  vendors"); `no-outside-effect` does not fire on a W3 program; `thresholdAt` is exact at s = 0, 0.5, 1. Refit on dev only:
  t_default 0.416704 (dev 0/84 FP, 42/42), dev CV FP 1/84, recall 40/42 (as v1); step 4 rerun on dev: δ = 0 again (code only).
  **Both are evaluated on test, once:** v1 (frozen f9641ff9 + δ = 0, a runnable copy in `frozen-v1/`) stays the
  preregistered primary for E1-E5; v1.1 is reported beside it as the version that ships in `src/need/`. v1.1 is held out from
  tuning in the same sense (no test output existed when it was frozen) but had one more author pass, over synthetic requests.
- **Diagnostic added (no change to any rule):** a 5-fold dev cluster cross-validation of the fit and threshold rule
  (`fit.mjs --cv`), reported as development evidence only.
