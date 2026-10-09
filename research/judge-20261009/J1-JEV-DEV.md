# J1 on hosted Jev: stock reads on the surviving dev-select slices (2026-10-09)

> **Status: DEVELOPMENT EVIDENCE, DIAGNOSTIC ONLY.**
> - The data is dev-select (in-family, generator-labelled).
> - Each item was read once (K = 1), by stock hosted Jev, using raw probabilities.
> - No calibration fit exists: calib-OOD was lost.
> - Nothing here is a comparative claim. Comparative claims need the J2 pre-registration ([PREREG-J2-draft.md](PREREG-J2-draft.md)).
> - Differences under 3 points are noise.
> - For interactive and runbook, the intervals are clustered by record only and are likely too narrow (see §5).

**Owner direction, 2026-10-09:** Jev replaces Kev for the judge program. Jev is TypeSafe's hosted System One model, billed
to the owner's TypeSafe account. J1 is therefore no longer a Kev read; it is "stock Jev against the $0 baselines and a
small Haiku arm". There was no Kev training, no Kev GPU work, and no new Workflow fan-out.

## 1. What ran

| Step | What | Requests / calls | Where the raw output is |
|---|---|---|---|
| Policy | Jev added to `policy/models.json` (`judgmentModels`, provider `typesafe-systemone`, credential env-var name only) | – | commit 38f74fd |
| Scorer | `score-served.mjs --jev`: per-response identity and usage, retry/backoff recorded as faults, a request ledger with a hard cap, `--resume`, re-read through the same path | – | commit 38f74fd |
| Smoke | 10 runbook records | 10 | `data/jev/smoke/` |
| J1 Jev | all 1,106 records (1,181 questions) of the three surviving dev-select files | 1,106 | `data/jev/J1/<group>-dev-select.jsonl` (rows), `.raw.jsonl` (verbatim response bodies), `.report.json` |
| Re-read | 20 records per file, read a second time | 60 | `data/jev/J1/<group>-dev-select.reread.jsonl` |
| Baselines | uniform; dev-majority and dev-prior (LEAKY); kinetics only: train-majority, train-prior, calib-in prior, BoW probe | $0 | `data/baselines/` |
| Haiku arm | `claude-haiku-5-5`, 2 items per port, $0.20 cap (as designed) | 38 | `data/haiku/rows.jsonl`, `journal-model-calls.jsonl` |
| Analysis | per port: metrics with CIs, paired differences, calibration diagnostics, re-read | – | `data/analysis/j1-jev-dev-analysis.json`, `j1-jev-dev-tables.md` |

**Commands.** All were run from the repo root. Jev-calling commands ran as
`bash -ic 'cd … && FOUNDRY_SYSTEMONE_API_KEY="$TYPESAFE_API_KEY" /opt/node24/bin/node <script> <args>'`, so the code
reads only `FOUNDRY_SYSTEMONE_API_KEY`.

```sh
# smoke (shares the request ledger and the 1,400 cap with J1)
node experiments/kev-data/score-served.mjs --data $W/inputs/runbook-dev-select-e431400e7d8b.jsonl \
  --out $W/jev/smoke/runbook-10.jsonl --jev --limit 10 --request-cap 1400 --request-ledger $W/jev/requests.jsonl
# J1, once per group (runbook, kinetics, interactive)
node experiments/kev-data/score-served.mjs --data $W/inputs/<group>-dev-select-<sha12>.jsonl \
  --out $W/jev/J1/<group>-dev-select.jsonl --jev --reread 20 --request-cap 1400 --request-ledger $W/jev/requests.jsonl
# no credential needed from here on
node experiments/kev-data/out/j1/lib-j1.mjs --sources research/judge-20261009/data/rebuild-check.json
node experiments/kev-data/out/j1/baselines-j1.mjs
KEV_J1_HAIKU_CONC=2 node experiments/kev-data/out/j1/haiku-j1.mjs 2 0.2   # concurrency 2 (designed 4) to keep claude -p within RAM
node experiments/kev-data/out/j1/analyze-j1.mjs                            # bootstrap B = 4000 (baselines: 2000)
```

`W = /var/tmp/foundry-work/kev/j1`. The three inputs match the wave-A manifest's dev-select sha256:

| group | sha256 prefix |
|---|---|
| interactive | `9459e2fce448` |
| kinetics | `d1d34f6fa6ad` |
| runbook | `e431400e7d8b` |

## 2. Model version, usage, faults

**Version.**
- `jev-latest` was requested.
- Every response, all 1,116 scoring requests plus all 60 re-reads, reported `model: "jev-1.13.0"`.
- The version did not change during the runs. The scorer would have flagged a change (`model_changed`).

**Requests.**
- 1,176 in total: 10 smoke, 1,106 J1 and 60 re-read. This is under the 1,400 hard cap.
- The ledger lines are written before each send. They carry no headers and no bodies.
- 0 faults, 0 retries, 0 HTTP errors. Coverage was complete: 0 rejected, 0 failed, 0 truncated.

**Tokens (from each response's `usage`).**

| | input | output |
|---|---|---|
| smoke | 4,264 | 352 |
| J1 interactive | 258,284 | 26,138 |
| J1 kinetics | 222,079 | 24,819 |
| J1 runbook | 71,126 | 6,169 |
| re-reads (3 × 20) | 28,846 | 2,916 |
| **total** | **584,599** | **60,394** |

**Smoke extrapolation.** The smoke averaged 426 input tokens per record, which predicts about 471k input tokens for
the 1,106 J1 records. The actual figure was 551k (+17%), because kinetics and interactive states are longer than runbook
states.

**Cost.** The policy price is $0.042 per million input tokens. That price is second-hand and unverified, and the output
price is unknown. At that price, input alone comes to about $0.025. The owner's TypeSafe account shows the billed figure.

**Latency.** Concurrency was 2. Median wall time was 278–295 ms per request, depending on the group.

| group | requests | wall time |
|---|---|---|
| runbook | 158 | 24 s |
| kinetics | 461 | 66 s |
| interactive | 487 | 74 s |

**Smoke checks.**
- Rows are in the served-rows schema, plus `model`, `requested_model`, `usage`, `attempts`, `choice` and `confidence`.
- The label is never sent. A unit test asserts that the request body carries only `model`, `state`, and per question
  `type`, `instructions` and `criteria`. The sent state equals the record's state, and no label, `src` or `target` field
  appears in the questions.
- Probabilities: 1,171 of 1,181 rows sum to exactly 1.00. The other 10 sum to 0.99, an artefact of Jev's 2-decimal
  output. The analysis renormalises them.

**Output shape.**
- Jev's `confidence` is **not** max p: the mean |confidence − max p| is 0.03–0.09 per group, with Pearson 0.95–0.98.
- 2 rows tie at [0.5, 0.5]. The analysis takes Jev's own `choice` for these.

## 3. Coverage and validity

- **Every run is coverage-complete.** All three are nevertheless reported `valid: false`, by the unchanged validity rule:
  every re-read must agree within |Δp| < 0.01.
- **Jev answers in 2-decimal steps.** Its repeat reads move by 0.01–0.07.
- **The rule was not relaxed** (ROADMAP §6 rule 4). The status stands as invalid-by-rule, and the stability numbers are
  given in §6.
- **What the rule means for J2.** A hosted 2-decimal model may never meet a 0.01 tolerance. J2 must pre-register either
  K > 1 reads or a tolerance argued from Jev's output grid, *before* any test read (see the J2 draft, §3).

## 4. Rebuild: what was reproduced

The wave-A builds were lost with the cloud container. They were rebuilt deterministically with `build-wave-a.mjs`,
using an empty held-out stub, into `/var/tmp/foundry-work/kev/builds-rebuild/`. Only hashes and counts were compared, in
`data/rebuild-check.json`; no test slice was built or read.

| group | dev-select | calib-in | train | verdict |
|---|---|---|---|---|
| kinetics | 461/461, **sha256 match**, sidecar match | 450/450, **match** | 4,023 vs 4,026 (+1 X3: the original dropped it as state-in-test-in, and test-in is absent here; −4 K3: misfit at jobMaxState 393, the manifest's being 2,056) | **verified**: sidecar (formId, worldHash, family) and in-distribution slices used |
| interactive | 487/487 rows, 466 identical lines, 21 X1 records differ | 196 vs 198 | 2,480 vs 2,496 | **not reproduced**: needs the lost `pools/train/X1.jsonl` |
| runbook | 164 vs 158, 147 identical lines (X1: 11 only in the input, 17 only in the rebuild) | 197 vs 183 | 1,432 vs 1,349 | **not reproduced**: X1 pools, plus the state-in-test-in dedup (65 X1 originally) |

**What this means for each group.**
- **Kinetics** is analysed as designed: port = `question:family`, with a two-way form × world bootstrap. Its train-fitted
  baselines are fitted on the rebuilt train, with the difference above disclosed.
- **Interactive and runbook** use the stated fallback:
  - port = question id;
  - a one-way bootstrap over records, so the CIs are **form-unclustered and likely too narrow** (JUDGE-PROGRAM §6.0
    shows form-clustering widening a CI from ±4 to ±27 pp);
  - no train-fitted baseline.
- **Unavailable everywhere:** the calib-OOD prior arm (§5.1), BSS against it (§6.1), the calib-OOD threshold (RISK) and
  the calib-OOD fit (§7.5). All of them need the held-out material lost with the container.

## 5. Results (per port; estimate [95% CI])

**Columns.**
- **Chance bacc** = a uniform guesser's expected balanced accuracy.
- **BSS-u** = Brier skill against p = 1/k (fitted on nothing; *not* the §6.1 calib-OOD prior).
- **Dev-maj** = majority class of the port's own dev rows. It is **LEAKY**, an in-sample ceiling for a constant guess.
- **Haiku** = items Haiku got right out of its 2, with Jev's count on the same 2 items in brackets.

### interactive (fallback: record clusters, CIs likely too narrow)

| port | n | Jev acc | Jev bacc | Jev Brier | BSS-u | chance bacc | dev-maj acc (LEAKY) | Haiku (Jev) |
|---|---|---|---|---|---|---|---|---|
| Q1~east | 25 | 0.720 [0.520, 0.880] | 0.733 [0.544, 0.900] | 0.439 [0.198, 0.703] | 0.122 | 0.500 | 0.600 | 2/2 (2/2) |
| Q1~north | 25 | 0.800 [0.640, 0.960] | 0.795 [0.615, 0.950] | 0.250 [0.093, 0.440] | 0.499 | 0.500 | 0.640 | 2/2 (1/2) |
| Q1~south | 25 | 0.880 [0.760, 1.000] | 0.883 [0.733, 1.000] | 0.109 [0.022, 0.221] | 0.781 | 0.500 | 0.600 | 2/2 (2/2) |
| Q1~west | 25 | 0.880 [0.720, 1.000] | 0.864 [0.714, 1.000] | 0.164 [0.065, 0.286] | 0.672 | 0.500 | 0.560 | 2/2 (2/2) |
| Q2 | 100 | 0.910 [0.850, 0.960] | 0.885 [0.816, 0.947] | 0.179 [0.097, 0.270] | 0.642 | 0.500 | 0.610 | 2/2 (1/2) |
| Q4 | 102 | 0.951 [0.902, 0.990] | 0.950 [0.903, 0.990] | 0.079 [0.026, 0.146] | 0.841 | 0.500 | 0.510 | 2/2 (2/2) |
| Q5 | 52 | 0.692 [0.558, 0.808] | 0.761 [0.685, 0.830] | 0.425 [0.271, 0.589] | 0.528 | 0.100 | 0.192 | 2/2 (0/2) |
| Q6 | 76 | 0.947 [0.895, 0.987] | 0.920 [0.840, 0.982] | 0.079 [0.037, 0.132] | 0.841 | 0.500 | 0.671 | 2/2 (2/2) |
| X1 | 32 | 0.750 [0.594, 0.875] | 0.762 [0.607, 0.901] | 0.330 [0.144, 0.539] | 0.341 | 0.500 | 0.563 | 2/2 (2/2) |
| X6 | 100 | 0.480 [0.380, 0.580] | 0.592 [0.481, 0.643] | 0.852 [0.690, 1.017] | −0.022 | 0.167 | 0.290 | 0/2 (0/2) |

### kinetics (verified sidecar: form × world clusters)

| port | n | Jev acc | Jev bacc | Jev Brier | BSS-u | chance bacc | probe bacc (train-fitted) | dev-maj acc (LEAKY) | Haiku (Jev) |
|---|---|---|---|---|---|---|---|---|---|
| K1 | 97 | 0.856 [0.708, 0.958] | 0.914 [0.744, 0.983] | 0.236 [0.096, 0.444] | 0.705 | 0.200 | 0.773 [0.605, 0.971] | 0.577 | 2/2 (2/2) |
| K2 | 10 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.000 | 1.000 | 0.147 | 0.042 [0.000, 0.300] | 0.400 | 2/2 (2/2) |
| K3 | 12 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.003 | 0.997 | 0.143 | 0.247 [0.000, 0.750] | 0.417 | 2/2 (2/2) |
| X3 | 200 | 0.570 [0.432, 0.703] | 0.609 [0.475, 0.737] | 0.559 [0.399, 0.732] | 0.301 | 0.200 | **0.930** [0.841, 0.986] | 0.285 | 1/2 (1/2) |
| X4 | 42 | 0.714 [0.438, 0.920] | 0.742 [0.550, 0.907] | 0.403 [0.173, 0.699] | 0.463 | 0.250 | **0.979** [0.875, 1.000] | 0.286 | 0/2 (0/2) |
| X8 | 100 | 0.780 [0.661, 0.895] | 0.774 [0.645, 0.891] | 0.280 [0.194, 0.373] | 0.440 | 0.500 | 0.553 [0.393, 0.702] | 0.550 | 2/2 (0/2) |

**Jev minus each train-fitted baseline, kinetics** (paired over the same rows, form × world bootstrap; "noise" =
|Δ| < 3 points; a negative ΔBrier favours Jev):

| port | vs | Δacc | Δbacc | ΔBrier |
|---|---|---|---|---|
| K1 | train-majority | +0.278 [0.033, 0.533] | +0.714 [0.539, 0.783] | – |
| K1 | probe | −0.010 [−0.179, 0.154] (noise) | +0.141 [−0.102, 0.321] | +0.038 [−0.196, 0.269] |
| K2 | probe | +0.900 [0.600, 1.000] | +0.958 [0.700, 1.000] | −1.032 [−1.193, −0.847] |
| K3 | probe | +0.667 [0.200, 1.000] | +0.753 [0.229, 1.000] | −0.666 [−0.996, −0.321] |
| X3 | train-prior | +0.285 [0.062, 0.479] | +0.408 [0.274, 0.540] | −0.230 [−0.407, −0.038] |
| X3 | calib-in prior | +0.285 [0.062, 0.479] | +0.408 [0.274, 0.540] | −0.226 [−0.396, −0.038] |
| X3 | **probe** | **−0.365 [−0.510, −0.223]** | **−0.322 [−0.464, −0.166]** | **+0.454 [0.282, 0.629]** |
| X4 | **probe** | **−0.262 [−0.552, −0.038]** | **−0.237 [−0.443, −0.037]** | **+0.358 [0.091, 0.681]** |
| X8 | calib-in prior | +0.230 [0.048, 0.436] | +0.274 [0.143, 0.392] | −0.215 [−0.309, −0.116] |
| X8 | probe | +0.220 [0.054, 0.406] | +0.220 [0.035, 0.405] | −0.230 [−0.346, −0.115] |

### runbook (fallback: record clusters, CIs likely too narrow)

| port | n | Jev acc | Jev bacc | Jev Brier | BSS-u | chance bacc | dev-maj acc (LEAKY) | Haiku (Jev) |
|---|---|---|---|---|---|---|---|---|
| Q4 | 100 | 0.970 [0.930, 1.000] | 0.969 [0.930, 1.000] | 0.043 [0.005, 0.095] | 0.913 | 0.500 | 0.520 | 1/2 (2/2) |
| X1 | 27 | 0.889 [0.741, 1.000] | 0.891 [0.750, 1.000] | 0.179 [0.004, 0.390] | 0.641 | 0.500 | 0.630 | 2/2 (2/2) |
| X4 | 31 | 0.516 [0.355, 0.677] | 0.675 [0.563, 0.750] | 0.819 [0.565, 1.063] | −0.092 | 0.250 | 0.387 | 0/2 (0/2) |

**Where the remaining comparisons are.** Every paired comparison, the LEAKY ones included, is in
`data/analysis/j1-jev-dev-tables.md`. Every interval and diagnostic is in `j1-jev-dev-analysis.json`.

**Group summaries (point estimates).**

| group | macro bacc | chance | pooled acc |
|---|---|---|---|
| interactive | 0.815 | 0.427 | 0.801 |
| kinetics | 0.840 | 0.240 | 0.709 |
| runbook | 0.845 | 0.417 | 0.867 |

**A bootstrap quirk.** On ports with very rare labels, a resample can drop a class, which moves the macro metric, so
the percentile CI of bacc can sit lopsided around the estimate. Examples: X6 "instruction" has n = 2, giving bacc 0.592
[0.481, 0.643]. Read those rows as diagnostic.

## 6. Re-read stability and calibration (§7.5, §6.2: the readouts dev data supports)

### Re-read

| | n | argmax flips | max \|Δp\| | mean max \|Δp\| | identical | \|Δp\| ≥ 0.01 |
|---|---|---|---|---|---|---|
| interactive | 20 | 0 | 0.06 | 0.0145 | 9 | 11 |
| kinetics | 20 | 0 | 0.07 | 0.021 | 6 | 14 |
| runbook | 20 | 0 | 0.03 | 0.0065 | 14 | 6 |
| smoke vs J1 (runbook, two separate runs) | 10 | 0 | 0.01 | 0.001 | 9 | – |

- **Flip rate:** 0/60 (0%). Max |Δp| is 0.07.
- **The §7.5 stability test passes for all three groups:** mean max-p agrees within 0.01 and flips are ≤ 0.5%. The
  scorer reports `stable: true`.
- **The run validity rule (every |Δp| < 0.01) fails for all three groups**, which is why each run is `valid: false`
  (§3).
- §7.5 asks for 300 rows per port; this re-read is 20 per group, a smaller check.

### Calibration (raw stock Jev, T = 1; diagnostic only, since no port reaches 500 items)

| group | mean max-p | overconfidence (mean max-p − acc) | ECE 15 equal-mass | ECE 10 equal-width | share at p = 1.00 | errors at p = 1.00 | coverage at 5% risk, in-sample (optimistic) |
|---|---|---|---|---|---|---|---|
| interactive | 0.896 | +0.095 | 0.097 | 0.095 | 25.6% | **9** (7 in X6) | **0** (the p = 1.00 block alone is 6.3% wrong) |
| kinetics | 0.802 | +0.093 | 0.099 | 0.093 | 14.5% | 0 | 0.356 (τ = 0.94) |
| runbook | 0.931 | +0.064 | 0.071 | 0.078 | 50.0% | 1 | 0.829 (τ = 0.86) |

- **Ports at the extremes.** The per-port ECE (15 equal-mass) ranges from 0.00 (K2) to 0.39 (X6). The worst ports are
  interactive X6 (overconfidence +0.39) and runbook X4 (+0.22).
- **These coverage numbers are not RISK.** RISK needs a threshold fitted on calib-OOD and a realised risk on test.
- **Label position (§6.6).** By the label's index in the option list, accuracy is 0.83/0.87 at positions 0/1 in
  interactive, then 0.42–0.80 at positions 2–9. Those positions belong to the multi-option ports (Q5, X6), so this is
  confounded with port difficulty. It is not an ORDER read.

### What dev cannot support

- **GAP**: needs test-in and the OOD axes.
- **LONG**: every row is the `clean` variant.
- **UNK**: needs held-out-phrasing unknowables. Runbook has 2 `unknowable`-source rows, too few.
- **PARA**: needs test wordings.
- **ORDER**: there is no permute route for hosted Jev. An in-client permutation would cost 6 × 200 requests per port.
- **INJ**: needs injected pairs.
- **§6.1 BSS and RISK**: need calib-OOD.

## 7. Haiku arm

- **Run.** `claude-haiku-5-5` through the `claude-cli` provider (the owner's login, host-side), as designed: 2 items per
  port in sha order, 19 ports, 38 calls.
- **Faults and cost.** 0 faults: no rate limits or errors. List-price cost $0.0118, at a mean of $0.00031 per call.
- **Pooled results** (same 38 items, record bootstrap):

| | acc [95% CI] |
|---|---|
| Jev | 25/38 = 0.658 [0.500, 0.811] |
| Haiku | 30/38 = 0.789 [0.650, 0.919] |
| Jev − Haiku | Δacc −0.132 [−0.270, 0.000]; ΔBrier +0.095 [−0.058, 0.249] |

- **Not a comparison.**
  - n = 38, and the design takes 2 items per port, so small hard ports weigh as much as large easy ones.
  - The CI touches 0.
  - Haiku's probabilities are verbalised.
  - Haiku is a K = 1 read.
- **What it does support:** it is a reason to keep Haiku as a full arm in J2. It is not evidence about either model.

## 8. Negative results (kept)

1. **Interactive X6: one option absorbs two others.**
   - All 29 `designed` items are read as `lead` (0/29), as are 13 of 14 `duplicate` items.
   - 14 of interactive's 20 most confident errors are `designed → lead` at p ≥ 0.98, with 7 at p = 1.00.
   - X6 BSS against uniform is −0.022: worse than knowing nothing.
2. **Runbook X4: `out_of_scope` is never chosen.**
   - 0 of 12 correct: 8 read as `binding`, 4 as `informal`.
   - BSS against uniform is −0.092.
3. **Kinetics X3: systematic adjacent-option confusions.**
   - `proposes → mentions`: 28 of 57.
   - `mentions → changes`: 26 of 48.
   - `confirms → changes`: 12 of 30.
4. **A $0 probe beats stock Jev in-family on kinetics X3 and X4.**
   - The probe is a train-fitted bag-of-words model. Its bacc is 0.930 and 0.979, against Jev's 0.609 and 0.742; the
     paired CIs exclude 0.
   - **Why this happens:** it is the in-family template shortcut the program warned about (§7.5: a probe scores
     0.99–1.00 in-family).
   - **What it does and does not say:** it says nothing about OOD. It does say that J2 must read the probe on test-OOD,
     and that "Jev beats the best baseline" is not given.
5. **Nothing reaches 5% risk at the group level for interactive.** Jev's hard p = 1.00 answers are wrong 6.3% of the
   time there, so no in-sample threshold reaches 5% risk.
6. **The validity rule fails for every run.** The re-read |Δp| of 0.03–0.07 breaks the 0.01 rule (§3), even though no
   argmax ever flips.

Findings 1–3 look like **option-semantics mismatches**: Jev reads the criteria text differently from the generator's
definitions. They are the main thing a calib-OOD-fitted per-option bias (§7.5 vector scaling) would have to fix. Where
p(true option) is about 0.00 at Jev's 2-decimal output (floored at 5e-5), a bias large enough to recover it would distort
the other options. This is a testable J2 question, not a prediction.

## 9. What was lost, and the limits of this read

- **Lost with the cloud container.** In the run itself:
  - the held-out material, and with it calib-OOD, dev-OOD, test-OOD and test-in for every group;
  - `pools/train/X1.jsonl`;
  - the original wave-A build directories.

  Three of the six wave-A groups also lost their dev-select files: construction-crossfamily, failures-code and
  records-notes. J1 covers only interactive, kinetics and runbook.
- **Limits of this read.**
  - It is in-family dev data.
  - It is one read.
  - It uses raw probabilities, and there is no calib-OOD.
  - The interactive and runbook CIs are form-unclustered, so too narrow.
  - The kinetics train differs slightly from the original (§4).
  - Several ports are tiny: K2 has n = 10, K3 has n = 12. Every port is far below the §6.0 gating minimum of 30 forms per
    label.
  - No verdict is emitted for any port.
- **Not run.** The §5 partial-input battery, rules and embedding baselines were never built. ORDER and the other §6.2
  robustness reads were not possible on dev (§6).
- **Owner decision needed (heal kit).**
  - Adding Jev changes the owner policy hash, `8069fa33b93bc0e8 → cfe79728f185334b`, and with it the construction-kit
    hash.
  - As a result, the heal kit's policyDrift gate (`experiments/heal/kit.mjs`) reports **blocking** drift on
    `judgmentModels` and `providers.typesafe-systemone`. `loadKit` would throw `HEAL_POLICY_DRIFT` wherever the frozen
    kit exists; the kit is absent on this laptop.
  - The gate was not weakened (ROADMAP §6 rule 4).
  - Options: re-freeze the kit policy, approve a proved exemption for judgment-only additions, or keep Jev out of the
    owner policy file.

## 10. Files

All raw rows are committed, as irreproducible model outputs.

- `data/jev/`:
  - smoke and J1 rows, verbatim response bodies (`*.raw.jsonl`), re-reads and reports;
  - `requests-ledger.jsonl`: 1,176 lines (commit 4517c4a).
- `data/baselines/baselines-dev-select.json`, `baselines-rows.jsonl` (5,226 per-item predictions).
- `data/haiku/rows.jsonl`, `journal-model-calls.jsonl` (the 38 journaled calls, request and response).
- `data/analysis/j1-jev-dev-analysis.json`, `j1-jev-dev-tables.md`.
- `data/rebuild-check.json` (hashes and counts only).
- Code:
  - `experiments/kev-data/score-served.mjs` (`--jev`);
  - `experiments/kev-data/out/j1/{lib,baselines,haiku,analyze}-j1.mjs`;
  - `src/models/policy.mjs`;
  - `policy/models.json`.
