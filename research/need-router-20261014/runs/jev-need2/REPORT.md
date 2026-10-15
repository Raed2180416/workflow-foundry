# J-NEED-2: do Jev's task properties help predict whether one Haiku call solves a task? (2026-10-15, dev, diagnostic)

Design: `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md` §3.1 and §5 row 5; decision 12 (Jev is never the mode picker; this only decides whether Jev property features enter NR-static, NR-knn or neither). Code: `experiments/need-router/jev-need2.mjs`. Development/diagnostic evidence only: 8 family clusters, leave-one-family-out; nothing here is held-out.

## Prediction (quoted verbatim from the spec)

> Prediction recorded 2026-10-14 before any property request (not blind to M1 labels): P-a Jev property answers match family truth on >= 0.75 of cells, misses on S4 and S6; P-b LOFO AUROC on d3 0.40-0.60 code-only, 0.45-0.65 code+Jev, neither reaches 0.70; P-c neither beats the deployable probe by more than noise; P-d with d5 added code-only 0.60-0.75, Jev adds <= 0.03.

## Decision

Rule (pre-registered): LOFO AUROC >= 0.75 and matched accuracy > 0.625 -> NR-static; 0.60-0.75 -> NR-knn only; < 0.60 -> out. Primary: labels `m1`, all tasks (d3+d5), head code + Jev p(yes). Readings where the spec is silent: the head is code + Jev p(yes); "matched threshold" is the base-rate-matched threshold; an AUROC >= 0.75 that does not beat the probe falls to NR-knn; the rule scores the head, not the increment over code-only (reported beside it).

**Branch: NR-knn.** code+Jev LOFO AUROC 0.707 [0.46, 0.98] (family bootstrap); accuracy at the base-rate-matched threshold 0.722 vs deployable probe 0.625 and oracle-checked probe 0.827. Increment over code-only on the same tasks: 0.202 [-0.00, 0.49] (code-only 0.505).

Caveat: the rule as written scores the head, not the increment; the Jev increment over code-only is not above noise (its interval includes 0), so the branch is carried by the code features, not by Jev.

| labels | set | code+Jev AUROC | 95% interval | matched acc | branch | Δ vs code | Δ interval |
|---|---|---|---|---|---|---|---|
| m1 | d3 | 0.673 | [0.26, 0.99] | 0.604 | NR-knn | 0.145 | [-0.20, 0.50] |
| m1 | d3+d5 | 0.707 | [0.46, 0.98] | 0.722 | NR-knn | 0.202 | [-0.00, 0.49] |

## Heads (pooled out-of-fold, leave-one-family-out)

L2 logistic regression (λ = 1, intercept free, IRLS), features standardized on the training families only. Code features: logInputTokens, logSchemaLeaves, itemLists, maxListLength, freeText, multiSource, conventionsInProse, effectVerbs, timeWords, humanWords, verifiable, promptWords (taskFeatures; logInputTokens is the log token count). Jev/Haiku features: p(yes) for S1..S6 (Haiku one-hot). Intervals: 2000 family-cluster bootstrap replicates over the fixed out-of-fold scores (they omit refitting variability). "Matched acc": accuracy when as many tasks are called one-call-solvable as truly are (ties at random).

| labels | set | n (pos) | head | n | AUROC | 95% interval | matched acc | 95% interval | > 0.625 | > 0.827 | Δ vs code | Δ interval |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| m1 | d3 | 96 (47) | size-rule (no fit) | 96 | 0.707 | [0.36, 1.00] | 0.604 | [0.42, 1.00] | no | no | – | – |
| m1 | d3 | 96 (47) | code | 96 | 0.528 | [0.10, 0.95] | 0.479 | [0.25, 0.90] | no | no | – | – |
| m1 | d3 | 96 (47) | code+jev | 96 | 0.673 | [0.26, 0.99] | 0.604 | [0.33, 1.00] | no | no | 0.145 | [-0.20, 0.50] |
| m1 | d3 | 96 (47) | code+haiku | 96 | 0.539 | [0.12, 0.94] | 0.375 | [0.25, 0.90] | no | no | 0.012 | [-0.36, 0.37] |
| m1 | d3 | 96 (47) | jev (diag.) | 96 | 0.461 | [0.08, 0.85] | 0.479 | [0.25, 0.83] | no | no | -0.066 | [-0.61, 0.38] |
| m1 | d3 | 96 (47) | haiku (diag.) | 96 | 0.691 | [0.27, 0.99] | 0.563 | [0.31, 0.96] | no | no | 0.164 | [-0.34, 0.70] |
| m1 | d3+d5 | 144 (61) | size-rule (no fit) | 144 | 0.651 | [0.36, 0.98] | 0.583 | [0.38, 0.94] | no | no | – | – |
| m1 | d3+d5 | 144 (61) | code | 144 | 0.505 | [0.23, 0.89] | 0.417 | [0.27, 0.86] | no | no | – | – |
| m1 | d3+d5 | 144 (61) | code+jev | 144 | 0.707 | [0.46, 0.98] | 0.722 | [0.50, 0.94] | yes | no | 0.202 | [-0.00, 0.49] |
| m1 | d3+d5 | 144 (61) | code+haiku | 144 | 0.573 | [0.31, 0.94] | 0.486 | [0.33, 0.87] | no | no | 0.068 | [-0.06, 0.25] |
| m1 | d3+d5 | 144 (61) | jev (diag.) | 144 | 0.502 | [0.24, 0.84] | 0.458 | [0.27, 0.82] | no | no | -0.003 | [-0.43, 0.38] |
| m1 | d3+d5 | 144 (61) | haiku (diag.) | 144 | 0.736 | [0.44, 0.95] | 0.708 | [0.53, 0.88] | yes | no | 0.231 | [-0.12, 0.57] |

## Property accuracy against the family truth table

Family answer = argmax of the mean distribution over the family's tasks (cannot_tell or a tie is a miss); 48 truth cells.

| question | Jev | Haiku |
|---|---|---|
| S1 | 4/8 | 2/8 |
| S2 | 8/8 | 6/8 |
| S3 | 6/8 | 6/8 |
| S4 | 2/8 | 2/8 |
| S5 | 5/8 | 4/8 |
| S6 | 8/8 | 4/8 |
| pooled cells | 33/48 (0.69) | 24/48 (0.50) |
| task-level answers | 612/864 (0.71) | 474/864 (0.55) |

Jev misses: wbed-r0/S5, wbed-r1/S1, wbed-r1/S4, wbed-r2/S3, wbed-r2/S4, wbed-r3/S1, wbed-r3/S5, wbed-r3p/S4, wbed-r4/S1, wbed-r4/S4, wbed-r4/S5, wbed-r5/S1, wbed-r5/S3, wbed-r5/S4, wbed-r6/S4. Haiku misses: wbed-r0/S1, wbed-r0/S2, wbed-r0/S4, wbed-r0/S5, wbed-r0/S6, wbed-r1/S1, wbed-r1/S4, wbed-r2/S4, wbed-r2/S5, wbed-r2/S6, wbed-r3/S1, wbed-r3/S4, wbed-r3/S5, wbed-r3/S6, wbed-r3p/S1, wbed-r3p/S2, wbed-r3p/S3, wbed-r4/S1, wbed-r4/S4, wbed-r4/S5, wbed-r4/S6, wbed-r5/S1, wbed-r5/S3, wbed-r5/S4.

Sensitivity (not the truth; P-a uses the labeller's table): with the reviewer's readings in truth.json reviewerDisagreements applied (wbed-r3/S5: no -> yes; not applied, mixed reading: wbed-r2/S5: yes at d5, no at d3 (the family label is mixed)), pooled cells Jev 33/48 (0.69), Haiku 24/48 (0.50).

## Kotte's abstention floor (F22)

Share of Jev answers whose max probability is below 0.6: 0.25 of 864 order-averaged answers, 0.21 of 5184 single-order answers (per question: S1 0.33, S2 0.14, S3 0.50, S4 0.33, S5 0.08, S6 0.14). At the task-level property accuracy 0.71, the floor at α = 0.05 is (1 − acc − α)/(1 − α) = 0.25.

## Order effects (N7)

| question | mean spread of p(yes) over the 6 orders | mean p by shown position (1st, 2nd, 3rd) |
|---|---|---|
| S1 | 0.099 | 0.3221, 0.3498, 0.3282 |
| S2 | 0.066 | 0.333, 0.3409, 0.3261 |
| S3 | 0.131 | 0.3328, 0.3669, 0.3003 |
| S4 | 0.103 | 0.3192, 0.3554, 0.3254 |
| S5 | 0.017 | 0.3395, 0.3412, 0.3193 |
| S6 | 0.081 | 0.3291, 0.3477, 0.3232 |

## Predictions checked

Under labels `m1`.

- **P-a**: did not hold. {"accuracyAtLeast075":false,"missesOnlyOnS4S6":false,"missOnS4":true,"missOnS6":false,"pooled":0.6875,"misses":["wbed-r0/S5","wbed-r1/S1","wbed-r1/S4","wbed-r2/S3","wbed-r2/S4","wbed-r3/S1","wbed-r3/S5","wbed-r3p/S4","wbed-r4/S1","wbed-r4/S4","wbed-r4/S5","wbed-r5/S1","wbed-r5/S3","wbed-r5/S4","wbed-r6/S4"]}
- **P-b**: did not hold. {"code":0.5275727312201476,"codeJev":0.6730351715154147}
- **P-c**: held. {"code":{"lo":0.2692307692307692,"hi":0.8571428571428571,"n":2000,"reps":2000},"codeJev":{"lo":0.5,"hi":0.9444444444444444,"n":2000,"reps":2000}}
- **P-d**: did not hold. {"code":0.505036539601027,"delta":0.20165909539798543}

## Provenance

Jev: 144 task rows; requested jev-1.13.0; served jev-1.13.0 x864; usage 1172766 input / 200722 output tokens. Haiku arm: 144 rows, $0.0731, engines claude-code 2.1.299.
Labels: m1 61/144 one-call solvable (54 timed-out trials); m1r absent.

Caveats: families stand in for clusters, but the rungs nest: R4 packs are complete R1 and R3 tasks and R5 is R4 plus a legacy dump, so a fold that holds out R4 or R5 still trains on its parts (the folds are optimistic); Jev and Haiku see only the prompt and size facts (stateOf), while the code features and the truth table read the inputs, notes and bed source, so a cannot_tell can be the correct reading of what was shown; the outcome is mostly constant within a family, so a head is close to a family classifier fitted on 7 points; the bootstrap holds the out-of-fold scores fixed; the truth table is authored per family, not per task or difficulty.
