# J1 Jev dev-select tables (generated 2026-10-09T09:56:53.165Z)

DEVELOPMENT EVIDENCE, DIAGNOSTIC ONLY: dev-select (in-family), one read (K = 1), stock hosted Jev with raw probabilities (no calib-OOD fit exists); no comparative claim before a J2 pre-registration

Bootstrap B = 4000. kinetics: two-way form x world (verified rebuilt sidecar); interactive, runbook: one-way over records (no trustworthy sidecar), so their intervals are form-unclustered and likely too narrow. differences with |estimate| < 0.03 on acc, bacc, macroF1 are flagged noise.

### interactive (fallback: port = question id, record clusters, CIs likely too narrow)

| port | n | Jev acc | Jev bacc | Jev macro-F1 | Jev Brier | BSS vs uniform | chance bacc | best non-leaky baseline (bacc) | dev-majority acc (LEAKY) | Haiku correct |
|---|---|---|---|---|---|---|---|---|---|---|
| Q1~east | 25 | 0.720 [0.520, 0.880] | 0.733 [0.544, 0.900] | 0.718 | 0.439 [0.198, 0.703] | 0.122 | 0.500 | none (no trustworthy train) | 0.600 | 2/2 (Jev 2/2) |
| Q1~north | 25 | 0.800 [0.640, 0.960] | 0.795 [0.615, 0.950] | 0.788 | 0.250 [0.093, 0.440] | 0.499 | 0.500 | none (no trustworthy train) | 0.640 | 2/2 (Jev 1/2) |
| Q1~south | 25 | 0.880 [0.760, 1.000] | 0.883 [0.733, 1.000] | 0.877 | 0.109 [0.022, 0.221] | 0.781 | 0.500 | none (no trustworthy train) | 0.600 | 2/2 (Jev 2/2) |
| Q1~west | 25 | 0.880 [0.720, 1.000] | 0.864 [0.714, 1.000] | 0.873 | 0.164 [0.065, 0.286] | 0.672 | 0.500 | none (no trustworthy train) | 0.560 | 2/2 (Jev 2/2) |
| Q2 | 100 | 0.910 [0.850, 0.960] | 0.885 [0.816, 0.947] | 0.900 | 0.179 [0.097, 0.270] | 0.642 | 0.500 | none (no trustworthy train) | 0.610 | 2/2 (Jev 1/2) |
| Q4 | 102 | 0.951 [0.902, 0.990] | 0.950 [0.903, 0.990] | 0.951 | 0.079 [0.026, 0.146] | 0.841 | 0.500 | none (no trustworthy train) | 0.510 | 2/2 (Jev 2/2) |
| Q5 | 52 | 0.692 [0.558, 0.808] | 0.761 [0.685, 0.830] | 0.685 | 0.425 [0.271, 0.589] | 0.528 | 0.100 | none (no trustworthy train) | 0.192 | 2/2 (Jev 0/2) |
| Q6 | 76 | 0.947 [0.895, 0.987] | 0.920 [0.840, 0.982] | 0.938 | 0.079 [0.037, 0.132] | 0.841 | 0.500 | none (no trustworthy train) | 0.671 | 2/2 (Jev 2/2) |
| X1 | 32 | 0.750 [0.594, 0.875] | 0.762 [0.607, 0.901] | 0.750 | 0.330 [0.144, 0.539] | 0.341 | 0.500 | none (no trustworthy train) | 0.563 | 2/2 (Jev 2/2) |
| X6 | 100 | 0.480 [0.380, 0.580] | 0.592 [0.481, 0.643] | 0.540 | 0.852 [0.690, 1.017] | -0.022 | 0.167 | none (no trustworthy train) | 0.290 | 0/2 (Jev 0/2) |

Jev minus baseline, paired over the same rows (interactive); "(noise)" = |difference| under 3 points. Brier: negative favours Jev.

| port | arm | Δacc | Δbacc | ΔBrier |
|---|---|---|---|---|
| Q1~east | devMajority (LEAKY) | +0.120 [-0.160, 0.400] | +0.233 [0.036, 0.400] | – |
| Q1~east | devPrior (LEAKY) | +0.120 [-0.160, 0.400] | +0.233 [0.036, 0.400] | -0.041 [-0.297, 0.239] |
| Q1~north | devMajority (LEAKY) | +0.160 [-0.080, 0.400] | +0.295 [0.103, 0.447] | – |
| Q1~north | devPrior (LEAKY) | +0.160 [-0.080, 0.400] | +0.295 [0.103, 0.447] | -0.210 [-0.388, -0.009] |
| Q1~south | devMajority (LEAKY) | +0.280 [0.040, 0.520] | +0.383 [0.233, 0.500] | – |
| Q1~south | devPrior (LEAKY) | +0.280 [0.040, 0.520] | +0.383 [0.233, 0.500] | -0.371 [-0.489, -0.242] |
| Q1~west | devMajority (LEAKY) | +0.320 [0.160, 0.520] | +0.364 [0.214, 0.500] | – |
| Q1~west | devPrior (LEAKY) | +0.320 [0.160, 0.520] | +0.364 [0.214, 0.500] | -0.329 [-0.426, -0.219] |
| Q2 | devMajority (LEAKY) | +0.300 [0.210, 0.390] | +0.385 [0.314, 0.447] | – |
| Q2 | devPrior (LEAKY) | +0.300 [0.210, 0.390] | +0.385 [0.314, 0.447] | -0.297 [-0.369, -0.213] |
| Q4 | devMajority (LEAKY) | +0.441 [0.343, 0.539] | +0.450 [0.405, 0.490] | – |
| Q4 | devPrior (LEAKY) | +0.441 [0.343, 0.539] | +0.450 [0.405, 0.490] | -0.420 [-0.473, -0.357] |
| Q5 | devMajority (LEAKY) | +0.500 [0.365, 0.635] | +0.661 [0.568, 0.733] | – |
| Q5 | devPrior (LEAKY) | +0.500 [0.365, 0.635] | +0.661 [0.568, 0.733] | -0.449 [-0.604, -0.281] |
| Q6 | devMajority (LEAKY) | +0.276 [0.171, 0.382] | +0.420 [0.342, 0.481] | – |
| Q6 | devPrior (LEAKY) | +0.276 [0.171, 0.382] | +0.420 [0.342, 0.481] | -0.362 [-0.435, -0.291] |
| X1 | devMajority (LEAKY) | +0.188 [-0.063, 0.438] | +0.262 [0.109, 0.400] | – |
| X1 | devPrior (LEAKY) | +0.188 [-0.063, 0.438] | +0.262 [0.109, 0.400] | -0.163 [-0.360, 0.052] |
| X6 | devMajority (LEAKY) | +0.190 [0.020, 0.360] | +0.425 [0.280, 0.477] | – |
| X6 | devPrior (LEAKY) | +0.190 [0.020, 0.360] | +0.425 [0.280, 0.477] | +0.058 [-0.126, 0.236] |

### kinetics (verified sidecar: form x world clusters, port = question:family)

| port | n | Jev acc | Jev bacc | Jev macro-F1 | Jev Brier | BSS vs uniform | chance bacc | best non-leaky baseline (bacc) | dev-majority acc (LEAKY) | Haiku correct |
|---|---|---|---|---|---|---|---|---|---|---|
| K1:kinetics | 97 | 0.856 [0.708, 0.958] | 0.914 [0.744, 0.983] | 0.852 | 0.236 [0.096, 0.444] | 0.705 | 0.200 | probe 0.773 [0.605, 0.971] | 0.577 | 2/2 (Jev 2/2) |
| K2:kinetics | 10 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 | 0.000 [0.000, 0.000] | 1.000 | 0.147 | probe 0.042 [0.000, 0.300] | 0.400 | 2/2 (Jev 2/2) |
| K3:kinetics | 12 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 | 0.003 [0.000, 0.011] | 0.997 | 0.143 | probe 0.247 [0.000, 0.750] | 0.417 | 2/2 (Jev 2/2) |
| X3:kinetics | 200 | 0.570 [0.432, 0.703] | 0.609 [0.475, 0.737] | 0.634 | 0.559 [0.399, 0.732] | 0.301 | 0.200 | probe 0.930 [0.841, 0.986] | 0.285 | 1/2 (Jev 1/2) |
| X4:kinetics | 42 | 0.714 [0.438, 0.920] | 0.742 [0.550, 0.907] | 0.736 | 0.403 [0.173, 0.699] | 0.463 | 0.250 | probe 0.979 [0.875, 1.000] | 0.286 | 0/2 (Jev 0/2) |
| X8:kinetics | 100 | 0.780 [0.661, 0.895] | 0.774 [0.645, 0.891] | 0.776 | 0.280 [0.194, 0.373] | 0.440 | 0.500 | probe 0.553 [0.393, 0.702] | 0.550 | 2/2 (Jev 0/2) |

Jev minus baseline, paired over the same rows (kinetics); "(noise)" = |difference| under 3 points. Brier: negative favours Jev.

| port | arm | Δacc | Δbacc | ΔBrier |
|---|---|---|---|---|
| K1:kinetics | trainMajority | +0.278 [0.033, 0.533] | +0.714 [0.539, 0.783] | – |
| K1:kinetics | trainPrior | +0.278 [0.033, 0.533] | +0.714 [0.539, 0.783] | -0.369 [-0.601, -0.102] |
| K1:kinetics | probe | -0.010 [-0.179, 0.154] (noise) | +0.141 [-0.102, 0.321] | +0.038 [-0.196, 0.269] |
| K1:kinetics | devMajority (LEAKY) | +0.278 [0.033, 0.533] | +0.714 [0.539, 0.783] | – |
| K1:kinetics | devPrior (LEAKY) | +0.278 [0.033, 0.533] | +0.714 [0.539, 0.783] | -0.366 [-0.615, -0.090] |
| K2:kinetics | trainMajority | +1.000 [1.000, 1.000] | +1.000 [1.000, 1.000] | – |
| K2:kinetics | trainPrior | +1.000 [1.000, 1.000] | +1.000 [1.000, 1.000] | -0.906 [-1.030, -0.801] |
| K2:kinetics | probe | +0.900 [0.600, 1.000] | +0.958 [0.700, 1.000] | -1.032 [-1.193, -0.847] |
| K2:kinetics | devMajority (LEAKY) | +0.600 [0.000, 1.000] | +0.833 [0.000, 1.000] | – |
| K2:kinetics | devPrior (LEAKY) | +0.600 [0.000, 1.000] | +0.833 [0.000, 1.000] | -0.770 [-1.064, -0.440] |
| K3:kinetics | trainMajority | +0.833 [0.400, 1.000] | +0.800 [0.500, 1.000] | – |
| K3:kinetics | trainPrior | +0.833 [0.400, 1.000] | +0.800 [0.500, 1.000] | -0.844 [-0.975, -0.650] |
| K3:kinetics | probe | +0.667 [0.200, 1.000] | +0.753 [0.229, 1.000] | -0.666 [-0.996, -0.321] |
| K3:kinetics | devMajority (LEAKY) | +0.583 [0.111, 1.000] | +0.800 [0.500, 1.000] | – |
| K3:kinetics | devPrior (LEAKY) | +0.583 [0.111, 1.000] | +0.800 [0.500, 1.000] | -0.720 [-0.972, -0.489] |
| X3:kinetics | trainMajority | +0.285 [0.062, 0.479] | +0.408 [0.274, 0.540] | – |
| X3:kinetics | trainPrior | +0.285 [0.062, 0.479] | +0.408 [0.274, 0.540] | -0.230 [-0.407, -0.038] |
| X3:kinetics | calibInPrior | +0.285 [0.062, 0.479] | +0.408 [0.274, 0.540] | -0.226 [-0.396, -0.038] |
| X3:kinetics | probe | -0.365 [-0.510, -0.223] | -0.322 [-0.464, -0.166] | +0.454 [0.282, 0.629] |
| X3:kinetics | devMajority (LEAKY) | +0.285 [0.062, 0.479] | +0.408 [0.274, 0.540] | – |
| X3:kinetics | devPrior (LEAKY) | +0.285 [0.062, 0.479] | +0.408 [0.274, 0.540] | -0.217 [-0.394, -0.020] |
| X4:kinetics | trainMajority | +0.429 [0.167, 0.698] | +0.492 [0.286, 0.661] | – |
| X4:kinetics | trainPrior | +0.429 [0.167, 0.698] | +0.492 [0.286, 0.661] | -0.339 [-0.570, -0.024] |
| X4:kinetics | probe | -0.262 [-0.552, -0.038] | -0.237 [-0.443, -0.037] | +0.358 [0.091, 0.681] |
| X4:kinetics | devMajority (LEAKY) | +0.429 [0.167, 0.698] | +0.492 [0.286, 0.661] | – |
| X4:kinetics | devPrior (LEAKY) | +0.429 [0.167, 0.698] | +0.492 [0.286, 0.661] | -0.337 [-0.583, -0.009] |
| X8:kinetics | trainMajority | +0.230 [0.048, 0.436] | +0.274 [0.143, 0.392] | – |
| X8:kinetics | trainPrior | +0.350 [0.149, 0.538] | +0.346 [0.126, 0.537] | -0.220 [-0.311, -0.124] |
| X8:kinetics | calibInPrior | +0.230 [0.048, 0.436] | +0.274 [0.143, 0.392] | -0.215 [-0.309, -0.116] |
| X8:kinetics | probe | +0.220 [0.054, 0.406] | +0.220 [0.035, 0.405] | -0.230 [-0.346, -0.115] |
| X8:kinetics | devMajority (LEAKY) | +0.230 [0.048, 0.436] | +0.274 [0.143, 0.392] | – |
| X8:kinetics | devPrior (LEAKY) | +0.230 [0.048, 0.436] | +0.274 [0.143, 0.392] | -0.215 [-0.314, -0.111] |

### runbook (fallback: port = question id, record clusters, CIs likely too narrow)

| port | n | Jev acc | Jev bacc | Jev macro-F1 | Jev Brier | BSS vs uniform | chance bacc | best non-leaky baseline (bacc) | dev-majority acc (LEAKY) | Haiku correct |
|---|---|---|---|---|---|---|---|---|---|---|
| Q4 | 100 | 0.970 [0.930, 1.000] | 0.969 [0.930, 1.000] | 0.970 | 0.043 [0.005, 0.095] | 0.913 | 0.500 | none (no trustworthy train) | 0.520 | 1/2 (Jev 2/2) |
| X1 | 27 | 0.889 [0.741, 1.000] | 0.891 [0.750, 1.000] | 0.883 | 0.179 [0.004, 0.390] | 0.641 | 0.500 | none (no trustworthy train) | 0.630 | 2/2 (Jev 2/2) |
| X4 | 31 | 0.516 [0.355, 0.677] | 0.675 [0.563, 0.750] | 0.472 | 0.819 [0.565, 1.063] | -0.092 | 0.250 | none (no trustworthy train) | 0.387 | 0/2 (Jev 0/2) |

Jev minus baseline, paired over the same rows (runbook); "(noise)" = |difference| under 3 points. Brier: negative favours Jev.

| port | arm | Δacc | Δbacc | ΔBrier |
|---|---|---|---|---|
| Q4 | devMajority (LEAKY) | +0.450 [0.350, 0.550] | +0.469 [0.431, 0.500] | – |
| Q4 | devPrior (LEAKY) | +0.450 [0.350, 0.550] | +0.469 [0.431, 0.500] | -0.456 [-0.495, -0.404] |
| X1 | devMajority (LEAKY) | +0.259 [0.037, 0.481] | +0.391 [0.253, 0.500] | – |
| X1 | devPrior (LEAKY) | +0.259 [0.037, 0.481] | +0.391 [0.253, 0.500] | -0.287 [-0.487, -0.057] |
| X4 | devMajority (LEAKY) | +0.129 [-0.226, 0.452] | +0.425 [0.233, 0.500] | – |
| X4 | devPrior (LEAKY) | +0.129 [-0.226, 0.452] | +0.425 [0.233, 0.500] | +0.120 [-0.180, 0.436] |

### Jev vs Haiku, pooled

n = 38 items (2 per port), 0 faults. Jev acc 0.6579 / 0.5 / 0.8108; Haiku acc 0.7895 / 0.65 / 0.9189 (est / lo / hi). Jev − Haiku Δacc -0.132 [-0.270, 0.000], ΔBrier +0.095 [-0.058, 0.249].

### Re-read stability (20 records per group, same version)

| group | n | argmax flips | max |Δp| | mean max |Δp| | identical | ≥ 0.01 | run valid |
|---|---|---|---|---|---|---|---|
| interactive | 20 | 0 | 0.06 | 0.0145 | 9 | 11 | false |
| kinetics | 20 | 0 | 0.07 | 0.021 | 6 | 14 | false |
| runbook | 20 | 0 | 0.03 | 0.0065 | 14 | 6 | false |
| smoke vs J1 (runbook) | 10 | 0 | 0.01 | 0.001 | 9 | – | – |
