### Correct-correct: spread and false-disagreement

| pair (answer A = SOP fitter A) | n | median / max spread (|Δ|/max, worst number per pair) | max |Δvmax|/vmax | max |Δkm|/km | FD@0.001 | FD@0.002 | FD@0.005 | FD@0.01 | FD@0.02 | FD@0.05 |
|---|---|---|---|---|---|---|---|---|---|---|
| sop:A-vs-B | 24 | 3.6e-9 / 7.3e-9 | 2.0e-9 | 7.3e-9 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| sop:A-vs-bedfit | 24 | 5.9e-9 / 1.0e-8 | 2.3e-9 | 1.0e-8 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| sop:B-vs-bedfit | 24 | 6.4e-9 / 9.9e-9 | 2.9e-9 | 9.9e-9 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| nonsop:A-vs-means | 24 | 8.6e-3 / 3.9e-2 | 8.4e-3 | 3.9e-2 | 100.0% | 100.0% | 95.8% | 37.5% | 4.2% | 0.0% |
| nonsop:A-vs-wls | 17 | 5.4e-2 / 1.1e-1 | 3.5e-2 | 1.2e-1 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 70.6% |
| nonsop:A-vs-hanes | 23 | 4.3e-2 / 8.2e-2 | 2.4e-2 | 8.2e-2 | 100.0% | 100.0% | 100.0% | 100.0% | 95.7% | 34.8% |
| nonsop:A-vs-eadie | 12 | 3.9e-2 / 9.0e-2 | 2.9e-2 | 9.0e-2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 25.0% |
| round:A-vs-2sf | 24 | 2.7e-2 / 3.7e-2 | 3.6e-2 | 3.8e-2 | 100.0% | 100.0% | 100.0% | 100.0% | 83.3% | 0.0% |
| round:A-vs-3sf | 24 | 2.9e-3 / 4.8e-3 | 4.8e-3 | 4.7e-3 | 100.0% | 83.3% | 0.0% | 0.0% | 0.0% | 0.0% |
| round:A-vs-4sf | 24 | 2.6e-4 / 4.8e-4 | 3.6e-4 | 4.8e-4 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| nonsop:A-vs-lb | 5 | 7.7e-2 / 8.0e-2 | 6.0e-2 | 8.6e-2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 80.0% |

### Fine relTol (fitter noise floor)

| pair | 1e-9 | 1e-8 | 1e-7 | 0.000001 | 0.00001 | 0.0001 |
|---|---|---|---|---|---|---|
| sop:A-vs-B | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| sop:A-vs-bedfit | 100.0% | 4.2% | 0.0% | 0.0% | 0.0% | 0.0% |
| sop:B-vs-bedfit | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

### Variant oracle pass counts (of 24)

{"A":24,"B":24,"ref":24,"var:means":24,"var:wls":17,"var:hanes":23,"var:lb":5,"var:eadie":12,"var:round2sf":24,"var:round3sf":24,"var:round4sf":24}

### Controls

| control | n | oracle pass | exclusion set differs | same-set: min / median / max distance (|Δ|/max) | FA@0.001 | FA@0.002 | FA@0.005 | FA@0.01 | FA@0.02 | FA@0.05 |
|---|---|---|---|---|---|---|---|---|---|---|
| empty | 24 | 0 | 24/24 | (set differs) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| shuffled-or-corrupted | 24 | 0 | 0/24 | 0.678 / 0.850 / 0.947 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| pbw:keep-outliers | 24 | 0 | 24/24 | (set differs) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| pbw:over-exclude-decoys | 24 | 0 | 24/24 | (set differs) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| pbw:ignore-units | 24 | 0 | 0/24 | 1.000 / 1.000 / 1.086 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| pbw:ignore-corrections | 24 | 0 | 0/24 | 0.952 / 0.999 / 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| pbw:one-exclusion-missed | 24 | 0 | 24/24 | (set differs) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| pbw:apply-rejected-claims | 24 | 0 | 0/24 | 0.134 / 0.423 / 1.000 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| pbw:ignore-dose | 24 | 0 | 0/24 | 0.500 / 0.500 / 0.762 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| pbw:exclude-by-residual | 24 | 0 | 24/24 | (set differs) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| near-miss:km-12pct | 24 | 0 | 0/24 | 0.068 / 0.119 / 0.151 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

all-controls-distance (incl. set-differing):
empty: q0/.1/.5/.9/1 = – – – – –; vmax med(sameSet)=– km med=–
shuffled-or-corrupted: q0/.1/.5/.9/1 = 0.678 0.701 0.850 0.923 0.947; vmax med(sameSet)=1.130 km med=3.736
plausible-but-wrong:keep-outliers: q0/.1/.5/.9/1 = 0.030 0.052 0.099 0.267 0.326; vmax med(sameSet)=– km med=–
plausible-but-wrong:over-exclude-decoys: q0/.1/.5/.9/1 = 0.000 0.000 0.000 0.000 0.000; vmax med(sameSet)=– km med=–
plausible-but-wrong:ignore-units: q0/.1/.5/.9/1 = 1.000 1.000 1.000 1.035 1.086; vmax med(sameSet)=13450.598 km med=3122.570
plausible-but-wrong:ignore-corrections: q0/.1/.5/.9/1 = 0.952 0.970 0.999 1.000 1.000; vmax med(sameSet)=28.018 km med=42.557
plausible-but-wrong:one-exclusion-missed: q0/.1/.5/.9/1 = 0.000 0.000 0.006 0.125 0.223; vmax med(sameSet)=– km med=–
plausible-but-wrong:apply-rejected-claims: q0/.1/.5/.9/1 = 0.134 0.196 0.423 0.995 1.000; vmax med(sameSet)=0.203 km med=0.433
plausible-but-wrong:ignore-dose: q0/.1/.5/.9/1 = 0.500 0.500 0.500 0.752 0.762; vmax med(sameSet)=1.000 km med=0.000
plausible-but-wrong:exclude-by-residual: q0/.1/.5/.9/1 = 0.008 0.014 0.020 0.042 0.051; vmax med(sameSet)=– km med=–
near-miss:km-12pct: q0/.1/.5/.9/1 = 0.068 0.086 0.119 0.150 0.151; vmax med(sameSet)=0.000 km med=0.135

claim {"pbwPairs":192,"setDiffers":96,"sameSetPairs":96,"sameSetAnd_ge15":94,"sameSetAnd_lt15":2,"sameSetAnd_lt05":0,"sameSetAnd_lt02":0,"setDiffersOr_ge15":190}
FA pbw {"0.001":0,"0.002":0,"0.005":0,"0.01":0,"0.02":0,"0.05":0} numbersOnly {"0.001":0.15104166666666666,"0.002":0.16145833333333334,"0.005":0.1875,"0.01":0.21354166666666666,"0.02":0.28125,"0.05":0.3697916666666667}

loose {"0.05":{"falseDisagree_sopFitters":0,"falseDisagree_nonSop_passers":0.17647058823529413,"falseAgree_pbw":0,"falseAgree_nearMiss12":0,"falseAgree_pbw_numbersOnly":0.3697916666666667},"0.08":{"falseDisagree_sopFitters":0,"falseDisagree_nonSop_passers":0.032679738562091505,"falseAgree_pbw":0,"falseAgree_nearMiss12":0.08333333333333333,"falseAgree_pbw_numbersOnly":0.4010416666666667},"0.1":{"falseDisagree_sopFitters":0,"falseDisagree_nonSop_passers":0.006535947712418301,"falseAgree_pbw":0,"falseAgree_nearMiss12":0.25,"falseAgree_pbw_numbersOnly":0.421875},"0.15":{"falseDisagree_sopFitters":0,"falseDisagree_nonSop_passers":0,"falseAgree_pbw":0.010416666666666666,"falseAgree_nearMiss12":0.875,"falseAgree_pbw_numbersOnly":0.4479166666666667},"0.2":{"falseDisagree_sopFitters":0,"falseDisagree_nonSop_passers":0,"falseAgree_pbw":0.015625,"falseAgree_nearMiss12":1,"falseAgree_pbw_numbersOnly":0.4895833333333333}}
minDist {"empty":null,"shuffled-or-corrupted":0.6779230623702035,"plausible-but-wrong:keep-outliers":null,"plausible-but-wrong:over-exclude-decoys":null,"plausible-but-wrong:ignore-units":0.9995215750835075,"plausible-but-wrong:ignore-corrections":0.9515987317461416,"plausible-but-wrong:one-exclusion-missed":null,"plausible-but-wrong:apply-rejected-claims":0.1341993334461556,"plausible-but-wrong:ignore-dose":0.49999999882554425,"plausible-but-wrong:exclude-by-residual":null,"near-miss:km-12pct":0.06775950970153266}

row37 {"0.001":{"correctCorrect_nonSop":{"pairs":153,"disagree":129,"vanishAfterSharedRefit":129},"correctWrong_pbw":{"pairs":192,"disagree":192,"vanishAfterSharedRefit":96}},"0.005":{"correctCorrect_nonSop":{"pairs":153,"disagree":104,"vanishAfterSharedRefit":104},"correctWrong_pbw":{"pairs":192,"disagree":192,"vanishAfterSharedRefit":96}},"0.01":{"correctCorrect_nonSop":{"pairs":153,"disagree":90,"vanishAfterSharedRefit":90},"correctWrong_pbw":{"pairs":192,"disagree":192,"vanishAfterSharedRefit":96}},"0.02":{"correctCorrect_nonSop":{"pairs":153,"disagree":77,"vanishAfterSharedRefit":77},"correctWrong_pbw":{"pairs":192,"disagree":192,"vanishAfterSharedRefit":96}},"0.05":{"correctCorrect_nonSop":{"pairs":153,"disagree":27,"vanishAfterSharedRefit":27},"correctWrong_pbw":{"pairs":192,"disagree":192,"vanishAfterSharedRefit":96}}}

truth rel err (reference-quality fit vs generating truth): max 0.0493 median of per-task max 0.0453
conds 7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8 excl 9,9,9,10,9,9,10,10,9,10,10,10,10,9,10,10,12,11,11,12,12,10,12,10 dose 24
