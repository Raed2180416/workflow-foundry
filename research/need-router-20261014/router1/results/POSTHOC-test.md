# ROUTER-1 post-hoc analyses (test split; NOT preregistered; diagnostic only)

Written after the preregistered test evaluation was read. Every threshold below is chosen on dev only, but the designs were chosen after seeing the test results, so none of this is held-out evidence.

## (a) Haiku percent as the slider score

Never-trigger rule on dev: max dev-negative Haiku p = 0.9, so t = 0.92. On test: FP 0/132 (95% upper 0.0276), recall 0.5574, precision 1, F1 0.7158.

| Haiku p threshold | dev FP | dev recall | test FP | test recall | test F1 |
|---|---|---|---|---|---|
| 0.5 | 2/84 | 0.9762 | 5/132 | 0.9672 | 0.944 |
| 0.6 | 2/84 | 0.9762 | 5/132 | 0.9672 | 0.944 |
| 0.7 | 2/84 | 0.9524 | 4/132 | 0.9508 | 0.9431 |
| 0.8 | 1/84 | 0.9286 | 1/132 | 0.9344 | 0.958 |
| 0.9 | 1/84 | 0.7143 | 1/132 | 0.7541 | 0.8519 |
| 0.95 | 0/84 | 0.5476 | 0/132 | 0.5246 | 0.6882 |
| 1 | 0/84 | 0.0476 | 0/132 | 0.0492 | 0.0938 |

## (b) Cascade: code router clears p < L, Haiku decides the rest

Rule (dev): L = lowest out-of-fold (5-fold dev CV) router p among dev positives - 0.02 (v1.1 detectors); L = 0.3187. On test (v1.1): Haiku asked on 61/193 (0.3161); FP 2/132 (95% upper 0.0537), recall 0.7705, precision 0.9592, F1 0.8545; $9.45e-5 per decision. Haiku alone: FP 5/132 (95% upper 0.0862), recall 0.9672, precision 0.9219, F1 0.944; $2.60e-4 per decision.

| L | v1: Haiku share | v1: FP | v1: recall | v1.1: Haiku share | v1.1: FP | v1.1: recall |
|---|---|---|---|---|---|---|
| 0.02 | 0.9896 | 5 | 0.9672 | 0.9896 | 5 | 0.9672 |
| 0.05 | 0.7668 | 5 | 0.9672 | 0.7668 | 5 | 0.9672 |
| 0.1 | 0.5751 | 3 | 0.9016 | 0.5855 | 4 | 0.918 |
| 0.15 | 0.4715 | 3 | 0.8852 | 0.4819 | 4 | 0.9016 |
| 0.2 | 0.3938 | 3 | 0.8197 | 0.4041 | 3 | 0.8361 |
| 0.3 | 0.3057 | 2 | 0.7049 | 0.3316 | 2 | 0.7705 |
