window W=6, durable needs one version for W rows with >= 0.8 of them delivered by compiled code and passing (oracle view) or compiled ok with no shadow disagreement (system view, which also needs >= 1 answered shadow(s) in the window; "unchecked" drops that)

| arm | n | versions (changes) | rows per version | deopt rate (guard) | silent-miss rate (n) | overruled (caught) | disagree rate | $/task (last window) | durable: oracle from / confirmed / holds | durable: system from / confirmed / holds | system, unchecked |
|---|---|---|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 0 (0) | – | – (–) | – (0/0) | 0 (0) | – (0/0) | $0.103 ($0.185) | never | never | never |
| agent:claude-opus-5-5 | 24 | 0 (0) | – | – (–) | – (0/0) | 0 (0) | – (0/0) | $0.564 ($0.680) | never | never | never |
| agent:claude-sonnet-5-5 | 24 | 0 (0) | – | – (–) | – (0/0) | 0 (0) | – (0/0) | $0.294 ($0.357) | never | never | never |
| jit:claude-haiku-5-5/claude-haiku-5-5 | 24 | 4 (3) | 8, 6, 2, 5 | 19% (5%) | 50% (8/16) | 1 (0) | 100% (4/4) | $0.339 ($0.849) | never | never | never |
| jit:claude-opus-5-5/claude-haiku-5-5 | 24 | 3 (2) | 3, 11, 7 | 10% (0%) | 33% (6/18) | 1 (0) | 25% (1/4) | $0.314 ($0.119) | 18 / 23 ($7.527) / yes | 6 / 11 ($4.641) / yes, 1 relapse(s) | 6 / 11 ($4.641) / yes, 1 relapse(s) |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | 24 | 2 (1) | 15, 6 | 10% (0%) | 11% (2/19) | 0 (0) | 50% (2/4) | $0.374 ($0.799) | 3 / 8 ($2.291) / yes, 1 relapse(s) | 3 / 8 ($2.291) / no | 3 / 8 ($2.291) / yes, 1 relapse(s) |
| static:B1-haiku-records-k1 | 24 | 1 (0) | 24 | 0% (0%) | 33% (8/24) | 0 (0) | – (0/0) | $0.050 ($0.058) | 0 / 5 ($0.301) / no, 1 relapse(s) | never | 0 / 5 ($0.301) / yes |
