window W=6, durable needs one version for W rows with >= 0.8 of them delivered by compiled code and passing (oracle view) or compiled ok with no shadow disagreement (system view, which also needs >= 1 answered shadow(s) in the window; "unchecked" drops that)

| arm | n | versions (changes) | rows per version | deopt rate (guard) | silent-miss rate (n) | overruled (caught) | disagree rate | $/task (last window) | durable: oracle from / confirmed / holds | durable: system from / confirmed / holds | system, unchecked |
|---|---|---|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 0 (0) | – | – (–) | – (0/0) | 0 (0) | – (0/0) | $0.087 ($0.147) | never | never | never |
| jit:claude-opus-5-5/claude-haiku-5-5 | 14 | 6 (5) | 2, 3, 1, 1, 3, 1 | 55% (45%) | 33% (1/3) | 2 (0) | 60% (3/5) | $2.370 ($3.270) | never | never | never |
