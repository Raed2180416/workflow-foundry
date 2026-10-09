### haiku: Jev-wrong x haiku-wrong (n = 120, cost $0.0370)

| | haiku wrong | haiku right | total |
|---|---|---|---|
| Jev wrong | 40 | 25 | 65 |
| Jev right | 2 | 53 | 55 |
| total | 42 | 78 | 120 |

| statistic | value |
|---|---|
| accuracy on the sample: haiku / Jev | 0.650 / 0.458 |
| accuracy, design-weighted to the 1,181-item population: haiku / Jev | 0.864 / 0.774 |
| phi (sample, inflated by the oversampling of errors) | 0.605 |
| Yule's Q | 0.954 |
| odds ratio [95% CI] | 42.400 [9.483, 189.580] |
| Fisher exact p (two-sided) | <0.001 |
| P(haiku wrong \| Jev wrong) / P(haiku wrong \| Jev right), sample | 0.615 / 0.036 |
| same, design-weighted | 0.525 / 0.023 |
| P(haiku wrong), population-weighted | 0.136 |
| P(both wrong) weighted vs the product P(J wrong) P(M wrong) | 0.119 vs 0.031 |
| phi, design-weighted [bootstrap 95%] | 0.612 [0.505, 0.713] |
| Mantel-Haenszel OR across 16 ports [95% CI], CMH p | 32.062 [8.093, 127.025], <0.001 |
| when both wrong: same wrong option (expected by chance, uniform over the other options) | 36 of 40 (12.7) |

| subset | n | both wrong | Jev wrong only | haiku wrong only | both right | P(M wrong \| J wrong) | P(M wrong \| J right) | OR | Fisher p |
|---|---|---|---|---|---|---|---|---|---|
| negative-result ports (interactive X6, runbook X4, kinetics X3) | 72 | 34 | 9 | 2 | 27 | 0.791 | 0.069 | 51.000 | <0.001 |
| other ports | 48 | 6 | 16 | 0 | 26 | 0.273 | 0.000 | 20.879 | 0.006 |

Per port (a = both wrong, b = Jev wrong only, c = haiku wrong only, d = both right):

| port | n | a | b | c | d | haiku wrong | Jev wrong |
|---|---|---|---|---|---|---|---|
| kinetics:X3 | 28 | 10 | 7 | 2 | 9 | 12 | 17 |
| interactive:X6 | 24 | 13 | 1 | 0 | 10 | 13 | 14 |
| runbook:X4 | 20 | 11 | 1 | 0 | 8 | 11 | 12 |
| interactive:Q1 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| interactive:Q2 | 4 | 1 | 1 | 0 | 2 | 1 | 2 |
| interactive:Q4 | 4 | 1 | 1 | 0 | 2 | 1 | 2 |
| interactive:Q5 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| interactive:Q6 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| interactive:X1 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| kinetics:K1 | 4 | 1 | 1 | 0 | 2 | 1 | 2 |
| kinetics:X4 | 4 | 2 | 0 | 0 | 2 | 2 | 2 |
| kinetics:X8 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| runbook:Q4 | 4 | 1 | 1 | 0 | 2 | 1 | 2 |
| runbook:X1 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| kinetics:K2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| kinetics:K3 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

### sonnet: Jev-wrong x sonnet-wrong (n = 120, cost $0.6490)

| | sonnet wrong | sonnet right | total |
|---|---|---|---|
| Jev wrong | 35 | 30 | 65 |
| Jev right | 3 | 52 | 55 |
| total | 38 | 82 | 120 |

| statistic | value |
|---|---|
| accuracy on the sample: sonnet / Jev | 0.683 / 0.458 |
| accuracy, design-weighted to the 1,181-item population: sonnet / Jev | 0.882 / 0.774 |
| phi (sample, inflated by the oversampling of errors) | 0.518 |
| Yule's Q | 0.906 |
| odds ratio [95% CI] | 20.222 [5.726, 71.423] |
| Fisher exact p (two-sided) | <0.001 |
| P(sonnet wrong \| Jev wrong) / P(sonnet wrong \| Jev right), sample | 0.538 / 0.055 |
| same, design-weighted | 0.466 / 0.016 |
| P(sonnet wrong), population-weighted | 0.118 |
| P(both wrong) weighted vs the product P(J wrong) P(M wrong) | 0.105 vs 0.027 |
| phi, design-weighted [bootstrap 95%] | 0.585 [0.478, 0.677] |
| Mantel-Haenszel OR across 16 ports [95% CI], CMH p | 24.433 [6.303, 94.705], <0.001 |
| when both wrong: same wrong option (expected by chance, uniform over the other options) | 32 of 35 (11.4) |

| subset | n | both wrong | Jev wrong only | sonnet wrong only | both right | P(M wrong \| J wrong) | P(M wrong \| J right) | OR | Fisher p |
|---|---|---|---|---|---|---|---|---|---|
| negative-result ports (interactive X6, runbook X4, kinetics X3) | 72 | 29 | 14 | 3 | 26 | 0.674 | 0.103 | 17.952 | <0.001 |
| other ports | 48 | 6 | 16 | 0 | 26 | 0.273 | 0.000 | 20.879 | 0.006 |

Per port (a = both wrong, b = Jev wrong only, c = sonnet wrong only, d = both right):

| port | n | a | b | c | d | sonnet wrong | Jev wrong |
|---|---|---|---|---|---|---|---|
| kinetics:X3 | 28 | 10 | 7 | 1 | 10 | 11 | 17 |
| interactive:X6 | 24 | 10 | 4 | 0 | 10 | 10 | 14 |
| runbook:X4 | 20 | 9 | 3 | 2 | 6 | 11 | 12 |
| interactive:Q1 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| interactive:Q2 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| interactive:Q4 | 4 | 2 | 0 | 0 | 2 | 2 | 2 |
| interactive:Q5 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| interactive:Q6 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| interactive:X1 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| kinetics:K1 | 4 | 1 | 1 | 0 | 2 | 1 | 2 |
| kinetics:X4 | 4 | 2 | 0 | 0 | 2 | 2 | 2 |
| kinetics:X8 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| runbook:Q4 | 4 | 1 | 1 | 0 | 2 | 1 | 2 |
| runbook:X1 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| kinetics:K2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| kinetics:K3 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

### three-way consensus and sensitivity

```json
{"n":120,"threeWaySameWrongOption":28,"byPort":{"interactive:Q4":1,"interactive:X6":10,"kinetics:K1":1,"kinetics:X3":9,"kinetics:X4":1,"runbook:Q4":1,"runbook:X4":5},"jevWrongTotal":65,"jevWrongNoClaudeWrong":22,"jevWrongNoClaudeWrong_negPorts":7,"jevWrongNoClaudeWrong_otherPorts":15,"sensitivityWithoutThreeWayConsensusItems":{"n":92,"haiku":{"a":12,"b":25,"c":2,"d":53,"n":92,"yuleQ":0.854,"or":12.72,"orLo":2.644,"orHi":61.183,"fisherP":0.00023437673374893632,"pMgivenJwrong":0.324,"pMgivenJright":0.036},"sonnet":{"a":7,"b":30,"c":3,"d":52,"n":92,"yuleQ":0.604,"or":4.044,"orLo":0.973,"orHi":16.82,"fisherP":0.08309005951751776,"pMgivenJwrong":0.189,"pMgivenJright":0.055}}}
```

### haiku~sonnet

```json
{"n":120,"table2x2":{"a":33,"b":9,"c":5,"d":73,"n":120},"phiSample":0.74,"yuleQ":0.963,"oddsRatio":53.533,"fisherP":3.561935446218658e-16,"pM2wrongGivenM1wrong":0.786,"pM2wrongGivenM1right":0.064,"weightedPhi":0.821,"weightedPhiBootstrap95":[0.711,0.913],"weightedPWrongFirst":0.136,"weightedPWrongSecond":0.118,"mantelHaenszelOR":29.42,"mhCI":[8.03,107.786]}
```

### haiku&sonnet-on-Jev-wrong

```json
{"n":65,"bothClaudeWrong":32,"anyClaudeWrong":43,"neitherClaudeWrong":22}
```

### majority3

```json
{"n":120,"jevHaikuSonnetMajorityWrong":44,"claudePairBothWrong":33,"rescuedByJev":1}
```

