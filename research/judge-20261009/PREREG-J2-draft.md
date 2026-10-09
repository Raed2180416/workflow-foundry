# PREREG J2 (DRAFT, NOT FROZEN): hosted Jev as a per-port judge, on test-in and test-OOD

> **Status: DRAFT.** Nothing in this file is frozen.
> - No J2 read runs until two things are true: every prerequisite in §2 is met, and the owner has frozen this file (its
>   sha256 is recorded in §11).
> - This draft rescopes the JUDGE-PROGRAM §9 skeleton (`research/kev-20261007/JUDGE-PROGRAM.md`) for the owner's
>   2026-10-09 direction: hosted Jev replaces Kev.
> - J1 ([J1-JEV-DEV.md](J1-JEV-DEV.md)) is development evidence. It shapes this design, not the expected result.

## 0. What changes from §9 (Kev → Jev)

- **No training.** The "tuned candidate" becomes **Jev plus a transform fitted on calib-OOD**: §7.5 vector scaling,
  with T and per-option biases b. Stock Jev stays as its own arm.
- **No forgetting battery (§6.4).** No weights change, so there is nothing to forget. Instead, a version change of the
  hosted model is treated as a new model (§2 P6).
- **No bf16/fp32 scoring-path question (§7.5).** Every read goes through `score-served.mjs --jev` (System One HTTP), the
  same path a workflow would use.
- **COST** uses TypeSafe's price per token, verified from the owner's account. The policy's $0.042/M input is second-hand
  and unverified. **LAT** is measured on the hosted API.
- **Haiku becomes a full arm**, no longer a 2-per-port anecdote. Stock Kev and the local-logit arm are dropped.

## 1. Claim (draft)

For each J2 port p, Jev with a calib-OOD-fitted transform (arm B) must satisfy all of the following on **every
available test-OOD axis**:
- it beats the best of {calib-OOD prior, partial-input battery, rules, embedding-logistic, embedding-kNN, BoW probe,
  stock Jev (A), Haiku (C)} in balanced accuracy **and** Brier skill;
- it holds its risk at the calibrated threshold (§6.1 ACC, BSS, RISK; §8.1 items 1, 3, 4, 5, 7).

Two outcomes apply when it does not:
- A port that fails stays **advisory**: it may rank, never accept, reject or skip.
- A port whose every gating axis is diagnostic (below the §6.0 minimums) reports **"no power"**, not "no skill".

**Secondary (§8.1 item 2).** At the port's ε, compare the expected cost per decision of the cascade
`Jev(B) → Haiku → Sonnet` against `Haiku → Sonnet` and against Sonnet alone, at no higher realised risk. If a
Haiku-first chain is cheaper at equal risk, Haiku wins the port.

**Not supported:**
- T3 claim-bearing evidence (§8.5);
- sealed-family generalisation;
- commercial parity;
- anything about Kev.

## 2. Prerequisites (each blocks the freeze)

| id | prerequisite | owner of the step | status 2026-10-09 |
|---|---|---|---|
| P1 | **Held-out material regenerated** (wordings, templates/skeletons, families; §3.2–3.4). Then calib-OOD, dev-OOD and test-OOD are rebuilt from it. The originals are lost, so these are **new sets**: new hashes, re-registered here, and no comparison with the lost hashes. | the held-out author only (§9 `heldout-author only`); never a development agent | lost; not started |
| P2 | **test-in rebuilt and verified** by sha256 against `experiments/kev-data/out/wave-a-manifest.json`. Where the rebuild does not reproduce, the set is registered as new. Kinetics reproduced dev-select and calib-in byte for byte, so its test-in may reproduce. Interactive and runbook did not reproduce. Hashes only; no test content is read. | development agent (hash check only) | not built (the stub build emits no test slice) |
| P3 | **Form and world sidecars for interactive and runbook.** Two routes: regenerate `pools/train/X1.jsonl` (a new build, re-registered), or keep those groups at port = question id with record clustering. Under the second route they are diagnostic only and not promotable (§6.0 needs forms). | owner decision | unresolved |
| P4 | **The three groups with no surviving data** (records-notes, failures-code, construction-crossfamily) are either rebuilt (same verification as P2) or dropped from the J2 port list, with the reason. | owner decision | unresolved |
| P5 | **Validity rule for a 2-decimal hosted model.** J1 failed "every re-read \|Δp\| < 0.01" on all three groups (max 0.03–0.07, 0 flips). The rule is not relaxed after the fact (ROADMAP §6 rule 4). Before any test read, the owner picks one of: (a) keep the 0.01 rule and accept that every J2 run is flagged; (b) K = 3 reads per item, scoring the mean and applying the rule to the K-mean against a fourth read; (c) a tolerance derived from Jev's documented output grid, argued independently of the J1 numbers. | owner decision | unresolved |
| P6 | **Version pin.** `jev-latest` is a moving alias; J1 saw `jev-1.13.0` throughout. J2 uses a pinned version id if TypeSafe offers one. Otherwise every row records `model`, and a version change during the calib fit or the test read **voids** the arm: refit, then re-read. The calib-OOD fit and the test read must share one version. | development agent; TypeSafe docs | J1 scorer records it per row (commit 38f74fd) |
| P7 | **Heal-kit drift.** The Jev policy entry makes `experiments/heal/kit.mjs` policyDrift report blocking drift. The owner must re-freeze the kit policy, approve an exemption, or move Jev out of `policy/models.json`. | owner decision | open |
| P8 | **Missing baselines built and frozen:** the §5 partial-input battery, rules (§5.3), embedding-logistic and embedding-kNN. Without the battery, the PART and EVID gates cannot be read. Any baseline still missing is dropped by name, and the claim narrows to match. | development agent | not built |
| P9 | **Budget and request cap approved** (§9). | owner | proposed below |
| P10 | **Workflow rule.** The §8.3 end-to-end checks need workflow runs, and the owner's standing rule is "no new Workflow fan-outs". Either the owner lifts it for J2, or the §8.3 checks run as sequential scripts without fan-out, or they are deferred. | owner decision | unresolved |

## 3. Arms

| arm | what | fitted on |
|---|---|---|
| A | stock Jev (pinned version), raw probabilities, argmax; ties go to Jev's `choice` | nothing |
| B | Jev plus vector scaling: `log p'_k = log p_k / T + b_k`, renormalised. Probabilities are floored at 5e-5, which matters because Jev returns many exact 0s and 1s. Global T by default. Per-port T and per-option b are kept only if their 5-fold out-of-fold NLL beats T-only by ≥ 1% on ≥ 300 calib questions. Thresholds τ(5%) and τ(10%) come from `calibrationReport`. | calib-OOD at the deployment rate (§7.5); importance weights for rare-positive ports |
| C | Haiku (`claude-haiku-5-5`), zero-shot typed (`JudgmentPort` engine `model`, `maxTokens` 128, reasoning `none`). The same items as A and B: all of them, or a nested sha-order sample of at least 300 per port per axis, fixed here before the read. It gets the same T-only calib-OOD fit as B, for fairness. | calib-OOD (T only) |
| D | $0 baselines: calib-OOD prior (§5.1); BoW probe (§5.2) fitted on train; the P8 baselines | train / calib-OOD |
| E (cascade only) | Sonnet (`claude-sonnet-5-5`) as the terminal step of the §8.1 item 2 cost comparison | – |

## 4. Primary metrics and gates (unchanged from §6.1)

**Metrics**, per port and per available OOD axis:
- **ACC:** balanced accuracy. Paired difference against the best baseline: the 95% lower bound must be > 0.
- **BSS:** Brier skill against the **calib-OOD prior**. Paired Brier difference against the best baseline: the 95% upper
  bound must be ≤ 0.
- **RISK:** τ fitted on calib-OOD; the one-sided Clopper–Pearson upper bound of realised test risk must be ≤ ε + 0.03.
  Here ε = 5%, or 2% for X5.

**Inference rules:**
- **Bootstrap:** a paired two-way form × world cluster bootstrap with 10,000 resamples (§6.0).
- **Minimums:** ≥ 30 forms per label. A port below that reports "diagnostic: n_forms = k", with no verdict.
- **Best baseline:** the best arm of D for ACC and BSS. Arm B must also beat A and C, which makes the comparison against
  stock Jev and Haiku explicit.
- **Multiplicity:** Holm–Bonferroni over the J2 ports for any "k of N ports" sentence. Within a port, the conjunction is
  an intersection-union test.

## 5. Secondary readouts

| id | J2 form | note from J1 |
|---|---|---|
| ECE | 15 equal-mass bins (primary), 10 equal-width; gated only on axes with ≥ 500 items; for A, B and C | J1 dev ECE 0.07–0.10 per group, 0.00–0.39 per port (raw A) |
| GAP | bacc on test-in minus each OOD axis; > 10 pp labels a port "memorising" | – |
| LONG, UNK, PARA, INJ | as in §6.2, on the variant sets the rebuilt factory emits | not readable on J1 dev |
| ORDER | there is no hosted `/permute` route. In-client permutation of criteria order, n_perm = 6, 200 items per port (about 1,200 requests per port; counted in §9) | – |
| EVID, PART | need the P8 partial-input battery | – |
| HARD | the probe-hard stratum (test items the train-fitted probe gets wrong): B must beat every baseline there | J1: in-family, the probe beats stock Jev on kinetics X3 and X4. HARD is the read that matters. |
| PAIR, FLIP, INV, SLOT | where the rebuilt sets have twins | – |
| Stability | two reads of 300 dev-select rows per port: mean max-p within 0.01 and ≤ 0.5% argmax flips (§7.5), plus whatever P5 decides | J1 (20 per group): 0 flips, mean max-p within 0.0055 |
| LAT | p50 and p90 per request on the hosted API at concurrency 2 | J1 median 278–295 ms |
| COST | $ per 1,000 decisions, using the verified TypeSafe price and list prices for Haiku and Sonnet | J1: about 500 input and 50 output tokens per record |

**Always reported (§6.6):**
- per-port confusion matrices;
- label-position accuracy;
- the 20 most confident errors, kept raw;
- unit counts next to every number.

**Why the per-option analysis is pre-registered.** J1 showed option-semantics confusions (X6 `designed → lead`, X4
`out_of_scope` never chosen, X3 adjacent-option confusions). So J2 reports, per port, whether B's fitted biases recover
them on test-OOD. This is descriptive and not gated.

## 6. Judge in a workflow (§8.2, §8.3): only if P10 allows it

- **W0.** A `systemone` provider route for single-enum `agent` nodes, pointed at hosted Jev (provider
  `typesafe-systemone` in `policy/models.json`). Test: a scripted low-p answer escalates once to Haiku, and both steps
  are journaled.
- **X8 cascade on weak-model extraction** (§8.3). Records d3–d5 on the real-reserve worlds, with ≥ 100 tasks per arm and
  three arms:
  1. Haiku alone;
  2. Haiku plus the Jev X8 gate (arm B at τ(5%)), sending flagged rows to Sonnet;
  3. Sonnet alone.

  Metrics: oracle pass rate and $ per task, with CIs. Below 100 tasks per arm the report gives the CI and no verdict.
- **X5 reuse gate.** ≥ 150 non-matching e2e-reserve tasks. Metric: the wrong-reuse rate, with its one-sided bound.
- **Seed hygiene.** The judge program reserves test seeds 7000–7039 (real reserve) and 7040–7199 (e2e reserve). Those
  overlap numerically with the JIT program's held-out seeds (≥ 7001, never inspected).
  - Nothing generated from those seeds is read before the freeze.
  - The owner confirms that the two programs' seed spaces are separate beds, or J2 moves its reserves.
  - Seeds 5001–5006 and 6001–6004 are burned (HANDOFF §0). If a J2 test set draws on them, those records are excluded and
    counted.

## 7. Selection and order of reads

1. Every design choice is made on dev-select and dev-OOD only: which transform terms survive, which baseline is
   "best", and the Haiku sample size.
2. Calib-OOD is used for fitting, and for nothing else.
3. Then freeze this file, the analysis script hash, and the build hashes.
4. Read test-in and test-OOD **once** per arm. No test-OOD hash appears in any selection or calibration log.

## 8. Kill rules

- **No port passes ACC for arm B on any gating OOD axis:** stop, and record the negative result in `docs/RESEARCH.md`.
- **The Jev version changes during a read:** that arm's read is void; start again from the fit.
- **The fit and the test read are on different versions:** that arm is invalid.
- **A planted-shortcut control passes, or an acceptance test fails after the freeze** (§6.3): the build is invalid, and
  no claims are made from it.
- **INJ target-flip upper bound > 10% on 3 or more ports:** no promotion, and an injection-hardening review follows.
- **Request cap reached:** stop. Report coverage as incomplete; a partial read is never extrapolated.

## 9. Budget (proposal for P9)

**Record counts.** The wave-A manifest gives these counts for the three J1 groups. P1 and P3 may change them.

| group | calib-OOD | test-in | test-OOD |
|---|---|---|---|
| interactive | 350 | 333 | 2,154 |
| kinetics | 750 | 750 | 3,915 |
| runbook | 342 | 333 | 2,141 |

**Requests:**
- **Base:** 11,068 records, one request each. All questions of a record go in one request.
- **Total for one K = 1 pass:** about 13,000 requests, adding the dev-select stability reads (300 per port) and ORDER
  (about 1,200 per port, for the ports that run it). This multiplies by K if P5 picks K = 3.
- **Tokens:** about 0.5k input per request, so about 6.5M input tokens per pass.
- **Hard cap:** proposed at 1.15 × the planned count, with the request ledger as in J1.

**Haiku:**
- At J1's mean list cost of $0.00031 per call, a full pass over 11,068 items costs about $3.4.
- It runs on the owner's login, subject to its rate limits. Rate-limit faults are recorded as faults and retried.
- Cap: $10 per pass.

**Sonnet:** the §6 cascade only, about 300 tasks; cap set after the W0 pilot.

## 10. Draft skeleton (to be completed at the freeze)

```yaml
id: jev-judge-j2
status: DRAFT (not frozen). DEVELOPMENT T1 on generator labels; T2 for §6 if run; claim-bearing only at T3
claim: see §1 (per port; Jev + calib-OOD transform vs best baseline, stock Jev and Haiku, every available test-OOD axis)
supports: per-port gating vs advisory status of hosted Jev for the J2 ports
does_not_support: sealed-family generalisation, commercial parity, anything about Kev, T3 claims
frozen_inputs:
  ports_contract: experiments/kev-data/spec/ports.json            sha256: <...>
  heldout: regenerated by the held-out author (P1)               sha256: <...>   # new sets, re-registered
  builds: {train, calib-in, calib-ood, dev-select, dev-ood, test-in, test-ood-*} per group: sha256 each (P2-P4)
  wave_a_manifest: experiments/kev-data/out/wave-a-manifest.json  # reproducing builds are checked against it
  seeds: as JUDGE-PROGRAM §9; burned 5001-5006, 6001-6004 excluded; 7000-7199 reserve unread (§6)
models:
  judge: jev (provider typesafe-systemone, judgmentModels in policy/models.json); version pinned or recorded per row (P6)
  weak: claude-haiku-5-5
  strong: claude-sonnet-5-5
  policy_hash: <owner policy hash at freeze>   # cfe79728f185334b at commit 38f74fd
scoring_path: experiments/kev-data/score-served.mjs --jev (request ledger, hard cap, faults recorded)
validity_rule: <P5 decision>
units: masked surface form; two-way form x world paired bootstrap, 10,000 resamples; >= 30 forms per label to gate
primary_metrics: ACC, BSS (vs calib-OOD prior), RISK; per port and axis, with n, units and false-fail probability
secondary: ECE (>= 500), GAP, LONG, UNK, PARA, ORDER (in-client), INJ, FLIP, INV, SLOT, EVID, HARD, PART, PAIR, stability, LAT, COST
multiplicity: Holm-Bonferroni over the J2 ports; per-port intersection-union
selection: dev-select / dev-OOD only; calib-OOD for fitting only; test read once per frozen arm
budget: §9 (request cap, Haiku cap $10 per pass)
kill_rules: §8
analysis_script: experiments/kev-data/out/j1/analyze-j1.mjs successor for J2   sha256: <...>
exclusions: records dropped by budget, dedup, decidability, burned seeds or version voids, counted per port
```

## 11. Freeze record

Empty until the owner freezes the file: date, file sha256, analysis-script sha256, build hashes, Jev version, and the
P5, P6, P7 and P10 decisions.
