window W=6, durable needs one version for W rows with >= 0.8 of them delivered by compiled code and passing (oracle view) or compiled ok with no shadow disagreement (system view, which also needs >= 1 answered shadow(s) in the window; "unchecked" drops that)

| arm | n | versions (changes) | rows per version | deopt rate (guard) | silent-miss rate (n) | overruled (caught) | disagree rate | $/task (last window) | durable: oracle from / confirmed / holds | durable: system from / confirmed / holds | system, unchecked |
|---|---|---|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 0 (0) | – | – (–) | – (0/0) | 0 (0) | – (0/0) | $0.088 ($0.128) | never | never | never |
| agent:claude-sonnet-5-5 | 24 | 0 (0) | – | – (–) | – (0/0) | 0 (0) | – (0/0) | $0.308 ($0.342) | never | never | never |
| jit:claude-haiku-5-5/claude-haiku-5-5 | 12 | 1 (0) | 9 | 44% (11%) | 40% (2/5) | 0 (0) | 100% (1/1) | $1.721 ($1.330) | never | never | never |
| jit:claude-opus-5-5/claude-haiku-5-5 | 19 | 3 (2) | 6, 8, 2 | 38% (31%) | 10% (1/10) | 0 (0) | 100% (2/2) | $1.157 ($0.762) | 9 / 14 ($17.232) / no | never | never |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | 13 | 3 (2) | 3, 3, 4 | 60% (60%) | 75% (3/4) | 0 (0) | 100% (1/1) | $1.653 ($0.848) | never | never | never |
