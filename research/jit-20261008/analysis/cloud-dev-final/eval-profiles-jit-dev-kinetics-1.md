# Input-profile replay: experiments/runs/jit/jit-dev-kinetics-1

Evidence: development / diagnostic (dev split; oracle used only to score the profile). Warmup 3 rows build the profile. Recall/false alarms use the oracle (experimenter's view).

| arm | features | policy | novel / checked | novel by difficulty (first idx) | deopts novel | silent misses novel (recall) | compiled passes novel (false alarm) | overruled novel | top reasons |
|---|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | all | frozen | 10/21 | d4 2/13 (3), d5 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | array-length 8, enum-ordinal 8, number-range 4 |
| agent:claude-haiku-5-5 | all | baseline | 15/21 | d4 7/13 (3), d5 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-family 8, array-length 8, enum-ordinal 8 |
| agent:claude-haiku-5-5 | no-size | frozen | 4/21 | d4 2/13 (3), d5 2/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | number-range 4 |
| agent:claude-haiku-5-5 | no-size | baseline | 15/21 | d4 7/13 (3), d5 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-family 8, vocabulary 8, prompt 6 |
| agent:claude-sonnet-5-5 | all | frozen | 10/21 | d4 2/13 (3), d5 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | array-length 8, enum-ordinal 8, number-range 4 |
| agent:claude-sonnet-5-5 | all | baseline | 15/21 | d4 7/13 (3), d5 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-family 8, array-length 8, enum-ordinal 8 |
| agent:claude-sonnet-5-5 | no-size | frozen | 4/21 | d4 2/13 (3), d5 2/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | number-range 4 |
| agent:claude-sonnet-5-5 | no-size | baseline | 15/21 | d4 7/13 (3), d5 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-family 8, vocabulary 8, prompt 6 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | frozen | 1/9 | d4 1/9 (3) | 1/4 | 0/2 (0%) | 0/3 (0%) | 0/0 | number-range 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | baseline | 3/9 | d4 3/9 (3) | 3/4 | 0/2 (0%) | 0/3 (0%) | 0/0 | enum 2, number-range 1, prompt 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | interp | 2/9 | d4 2/9 (3) | 2/4 | 0/2 (0%) | 0/3 (0%) | 0/0 | number-range 1, enum 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | version | 1/9 | d4 1/9 (3) | 1/4 | 0/2 (0%) | 0/3 (0%) | 0/0 | number-range 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | frozen | 1/9 | d4 1/9 (3) | 1/4 | 0/2 (0%) | 0/3 (0%) | 0/0 | number-range 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | baseline | 3/9 | d4 3/9 (3) | 3/4 | 0/2 (0%) | 0/3 (0%) | 0/0 | enum 2, number-range 1, prompt 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | interp | 2/9 | d4 2/9 (3) | 2/4 | 0/2 (0%) | 0/3 (0%) | 0/0 | number-range 1, enum 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | version | 1/9 | d4 1/9 (3) | 1/4 | 0/2 (0%) | 0/3 (0%) | 0/0 | number-range 1 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | frozen | 5/16 | d4 2/13 (3), d5 3/3 (16) | 3/6 | 0/1 (0%) | 2/9 (22%) | 0/0 | number-range 4, array-length 3, enum-ordinal 3 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | baseline | 10/16 | d4 7/13 (3), d5 3/3 (16) | 4/6 | 1/1 (100%) | 5/9 (56%) | 0/0 | enum 5, prompt 5, line-family 3 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | interp | 5/16 | d4 4/13 (3), d5 1/3 (16) | 2/6 | 0/1 (0%) | 3/9 (33%) | 0/0 | enum 3, number-range 1, array-length 1 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | version | 8/16 | d4 7/13 (3), d5 1/3 (16) | 2/6 | 1/1 (100%) | 5/9 (56%) | 0/0 | enum 6, number-range 1, array-length 1 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | frozen | 4/16 | d4 2/13 (3), d5 2/3 (16) | 2/6 | 0/1 (0%) | 2/9 (22%) | 0/0 | number-range 4 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | baseline | 10/16 | d4 7/13 (3), d5 3/3 (16) | 4/6 | 1/1 (100%) | 5/9 (56%) | 0/0 | prompt 6, enum 5, line-family 3 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | interp | 5/16 | d4 4/13 (3), d5 1/3 (16) | 2/6 | 0/1 (0%) | 3/9 (33%) | 0/0 | enum 3, number-range 1, line-family 1 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | version | 8/16 | d4 7/13 (3), d5 1/3 (16) | 2/6 | 1/1 (100%) | 5/9 (56%) | 0/0 | enum 6, number-range 1, line-family 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | frozen | 1/10 | d4 1/10 (3) | 0/6 | 1/3 (33%) | 0/1 (0%) | 0/0 | number-range 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | baseline | 4/10 | d4 4/10 (3) | 2/6 | 2/3 (67%) | 0/1 (0%) | 0/0 | enum 3, prompt 2, number-range 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | interp | 3/10 | d4 3/10 (3) | 2/6 | 1/3 (33%) | 0/1 (0%) | 0/0 | prompt 2, number-range 1, enum 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | version | 4/10 | d4 4/10 (3) | 2/6 | 2/3 (67%) | 0/1 (0%) | 0/0 | enum 3, prompt 3, number-range 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | frozen | 1/10 | d4 1/10 (3) | 0/6 | 1/3 (33%) | 0/1 (0%) | 0/0 | number-range 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | baseline | 4/10 | d4 4/10 (3) | 2/6 | 2/3 (67%) | 0/1 (0%) | 0/0 | enum 3, prompt 2, number-range 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | interp | 3/10 | d4 3/10 (3) | 2/6 | 1/3 (33%) | 0/1 (0%) | 0/0 | prompt 2, number-range 1, enum 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | version | 4/10 | d4 4/10 (3) | 2/6 | 2/3 (67%) | 0/1 (0%) | 0/0 | enum 3, prompt 3, number-range 1 |

## Deopt-on-novelty counterfactual (novel compiled delivery -> interpreter; oracle view)

Price and pass rate per difficulty: the interpreter model's agent arm in this run at that difficulty (else the arm's own interpreter-only rows).

| arm | features | policy | silent misses caught | correct compiled answers turned into deopts | + interpreter $ (net of avoided compiled/shadow $) | expected passes +gained -lost (net) | paired (same task, agent arm): + $ net, passes +gained -lost |
|---|---|---|---|---|---|---|---|
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | frozen | 0/2 | 0/3 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | baseline | 0/2 | 0/3 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | interp | 0/2 | 0/3 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | version | 0/2 | 0/3 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | frozen | 0/2 | 0/3 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | baseline | 0/2 | 0/3 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | interp | 0/2 | 0/3 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | version | 0/2 | 0/3 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | frozen | 0/1 | 2/9 | $0.99 ($-0.09) | +0 -0 (0) | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | baseline | 1/1 | 5/9 | $2.98 ($1.52) | +1 -0 (1) | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | interp | 0/1 | 3/9 | $1.49 ($1.13) | +0 -0 (0) | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | version | 1/1 | 5/9 | $2.98 ($1.52) | +1 -0 (1) | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | frozen | 0/1 | 2/9 | $0.99 ($-0.09) | +0 -0 (0) | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | baseline | 1/1 | 5/9 | $2.98 ($1.52) | +1 -0 (1) | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | interp | 0/1 | 3/9 | $1.49 ($1.13) | +0 -0 (0) | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | version | 1/1 | 5/9 | $2.98 ($1.52) | +1 -0 (1) | – |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | frozen | 1/3 | 0/1 | $0.29 ($0.28) | +0.75 -0 (0.75) | $0.24, +1 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | baseline | 2/3 | 0/1 | $0.59 ($-0.15) | +1.5 -0 (1.5) | $-0.23, +2 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | interp | 1/3 | 0/1 | $0.29 ($0.28) | +0.75 -0 (0.75) | $0.24, +1 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | version | 2/3 | 0/1 | $0.59 ($-0.15) | +1.5 -0 (1.5) | $-0.23, +2 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | frozen | 1/3 | 0/1 | $0.29 ($0.28) | +0.75 -0 (0.75) | $0.24, +1 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | baseline | 2/3 | 0/1 | $0.59 ($-0.15) | +1.5 -0 (1.5) | $-0.23, +2 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | interp | 1/3 | 0/1 | $0.29 ($0.28) | +0.75 -0 (0.75) | $0.24, +1 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | version | 2/3 | 0/1 | $0.59 ($-0.15) | +1.5 -0 (1.5) | $-0.23, +2 -0 |
