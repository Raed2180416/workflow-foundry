# Input-profile replay: experiments/runs/jit/jit-dev-records-1

Evidence: development / diagnostic (dev split; oracle used only to score the profile). Warmup 3 rows build the profile. Recall/false alarms use the oracle (experimenter's view).

| arm | features | policy | novel / checked | novel by difficulty (first idx) | deopts novel | silent misses novel (recall) | compiled passes novel (false alarm) | overruled novel | top reasons |
|---|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | all | frozen | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-count 8, string-length 8 |
| agent:claude-haiku-5-5 | all | baseline | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-count 8, string-length 8 |
| agent:claude-haiku-5-5 | no-size | frozen | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | – |
| agent:claude-haiku-5-5 | no-size | baseline | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | – |
| agent:claude-opus-5-5 | all | frozen | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-count 8, string-length 8 |
| agent:claude-opus-5-5 | all | baseline | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-count 8, string-length 8 |
| agent:claude-opus-5-5 | no-size | frozen | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | – |
| agent:claude-opus-5-5 | no-size | baseline | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | – |
| agent:claude-sonnet-5-5 | all | frozen | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-count 8, string-length 8 |
| agent:claude-sonnet-5-5 | all | baseline | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | line-count 8, string-length 8 |
| agent:claude-sonnet-5-5 | no-size | frozen | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | – |
| agent:claude-sonnet-5-5 | no-size | baseline | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/0 (–) | 0/0 (–) | 0/0 | – |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | frozen | 8/21 | d3 0/13, d4 8/8 (16) | 1/4 | 2/8 (25%) | 4/8 (50%) | 1/1 | line-count 8, string-length 8 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | baseline | 8/21 | d3 0/13, d4 8/8 (16) | 1/4 | 2/8 (25%) | 4/8 (50%) | 1/1 | line-count 8, string-length 8 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | interp | 1/21 | d3 0/13, d4 1/8 (16) | 1/4 | 0/8 (0%) | 0/8 (0%) | 0/1 | line-count 1, string-length 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | version | 1/21 | d3 0/13, d4 1/8 (16) | 1/4 | 0/8 (0%) | 0/8 (0%) | 0/1 | line-count 1, string-length 1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | frozen | 0/21 | d3 0/13, d4 0/8 | 0/4 | 0/8 (0%) | 0/8 (0%) | 0/1 | – |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | baseline | 0/21 | d3 0/13, d4 0/8 | 0/4 | 0/8 (0%) | 0/8 (0%) | 0/1 | – |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | interp | 0/21 | d3 0/13, d4 0/8 | 0/4 | 0/8 (0%) | 0/8 (0%) | 0/1 | – |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | version | 0/21 | d3 0/13, d4 0/8 | 0/4 | 0/8 (0%) | 0/8 (0%) | 0/1 | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | frozen | 8/21 | d3 0/13, d4 8/8 (16) | 0/2 | 2/6 (33%) | 5/12 (42%) | 1/1 | line-count 8, string-length 8 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | baseline | 8/21 | d3 0/13, d4 8/8 (16) | 0/2 | 2/6 (33%) | 5/12 (42%) | 1/1 | line-count 8, string-length 8 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | interp | 1/21 | d3 0/13, d4 1/8 (16) | 0/2 | 0/6 (0%) | 0/12 (0%) | 1/1 | line-count 1, string-length 1 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | version | 1/21 | d3 0/13, d4 1/8 (16) | 0/2 | 0/6 (0%) | 0/12 (0%) | 1/1 | line-count 1, string-length 1 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | frozen | 0/21 | d3 0/13, d4 0/8 | 0/2 | 0/6 (0%) | 0/12 (0%) | 0/1 | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | baseline | 0/21 | d3 0/13, d4 0/8 | 0/2 | 0/6 (0%) | 0/12 (0%) | 0/1 | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | interp | 0/21 | d3 0/13, d4 0/8 | 0/2 | 0/6 (0%) | 0/12 (0%) | 0/1 | – |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | version | 0/21 | d3 0/13, d4 0/8 | 0/2 | 0/6 (0%) | 0/12 (0%) | 0/1 | – |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | frozen | 8/21 | d3 0/13, d4 8/8 (16) | 2/2 | 0/2 (0%) | 6/17 (35%) | 0/0 | line-count 8, string-length 8 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | baseline | 8/21 | d3 0/13, d4 8/8 (16) | 2/2 | 0/2 (0%) | 6/17 (35%) | 0/0 | line-count 8, string-length 8 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | interp | 1/21 | d3 0/13, d4 1/8 (16) | 1/2 | 0/2 (0%) | 0/17 (0%) | 0/0 | line-count 1, string-length 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | version | 2/21 | d3 0/13, d4 2/8 (16) | 2/2 | 0/2 (0%) | 0/17 (0%) | 0/0 | line-count 2, string-length 2 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | frozen | 0/21 | d3 0/13, d4 0/8 | 0/2 | 0/2 (0%) | 0/17 (0%) | 0/0 | – |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | baseline | 0/21 | d3 0/13, d4 0/8 | 0/2 | 0/2 (0%) | 0/17 (0%) | 0/0 | – |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | interp | 0/21 | d3 0/13, d4 0/8 | 0/2 | 0/2 (0%) | 0/17 (0%) | 0/0 | – |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | version | 0/21 | d3 0/13, d4 0/8 | 0/2 | 0/2 (0%) | 0/17 (0%) | 0/0 | – |
| static:B1-haiku-records-k1 | all | frozen | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 6/7 (86%) | 2/14 (14%) | 0/0 | line-count 8, string-length 8 |
| static:B1-haiku-records-k1 | all | baseline | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 6/7 (86%) | 2/14 (14%) | 0/0 | line-count 8, string-length 8 |
| static:B1-haiku-records-k1 | all | interp | 8/21 | d3 0/13, d4 8/8 (16) | 0/0 | 6/7 (86%) | 2/14 (14%) | 0/0 | line-count 8, string-length 8 |
| static:B1-haiku-records-k1 | no-size | frozen | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/7 (0%) | 0/14 (0%) | 0/0 | – |
| static:B1-haiku-records-k1 | no-size | baseline | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/7 (0%) | 0/14 (0%) | 0/0 | – |
| static:B1-haiku-records-k1 | no-size | interp | 0/21 | d3 0/13, d4 0/8 | 0/0 | 0/7 (0%) | 0/14 (0%) | 0/0 | – |

## Deopt-on-novelty counterfactual (novel compiled delivery -> interpreter; oracle view)

Price and pass rate per difficulty: the interpreter model's agent arm in this run at that difficulty (else the arm's own interpreter-only rows).

| arm | features | policy | silent misses caught | correct compiled answers turned into deopts | + interpreter $ (net of avoided compiled/shadow $) | expected passes +gained -lost (net) | paired (same task, agent arm): + $ net, passes +gained -lost |
|---|---|---|---|---|---|---|---|
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | frozen | 2/8 | 4/8 | $1.17 ($-1.54) | +1.5 -1 (0.5) | $-1.46, +1 -1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | baseline | 2/8 | 4/8 | $1.17 ($-1.54) | +1.5 -1 (0.5) | $-1.46, +1 -1 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | interp | 0/8 | 0/8 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | all | version | 0/8 | 0/8 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | frozen | 0/8 | 0/8 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | baseline | 0/8 | 0/8 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | interp | 0/8 | 0/8 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | no-size | version | 0/8 | 0/8 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | frozen | 2/6 | 5/12 | $4.66 ($3.93) | +2 -0 (2) | $4.00, +2 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | baseline | 2/6 | 5/12 | $4.66 ($3.93) | +2 -0 (2) | $4.00, +2 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | interp | 0/6 | 0/12 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | all | version | 0/6 | 0/12 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | frozen | 0/6 | 0/12 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | baseline | 0/6 | 0/12 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | interp | 0/6 | 0/12 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-opus-5-5/claude-haiku-5-5 | no-size | version | 0/6 | 0/12 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | frozen | 0/2 | 6/17 | $2.21 ($1.14) | +0 -0 (0) | $1.07, +0 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | baseline | 0/2 | 6/17 | $2.21 ($1.14) | +0 -0 (0) | $1.07, +0 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | interp | 0/2 | 0/17 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | all | version | 0/2 | 0/17 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | frozen | 0/2 | 0/17 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | baseline | 0/2 | 0/17 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | interp | 0/2 | 0/17 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | no-size | version | 0/2 | 0/17 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| static:B1-haiku-records-k1 | all | frozen | 6/7 | 2/14 | $1.55 ($1.10) | +4.5 -0.5 (4) | $1.10, +4 -0 |
| static:B1-haiku-records-k1 | all | baseline | 6/7 | 2/14 | $1.55 ($1.10) | +4.5 -0.5 (4) | $1.10, +4 -0 |
| static:B1-haiku-records-k1 | all | interp | 6/7 | 2/14 | $1.55 ($1.10) | +4.5 -0.5 (4) | $1.10, +4 -0 |
| static:B1-haiku-records-k1 | no-size | frozen | 0/7 | 0/14 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| static:B1-haiku-records-k1 | no-size | baseline | 0/7 | 0/14 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
| static:B1-haiku-records-k1 | no-size | interp | 0/7 | 0/14 | $0.00 ($0.00) | +0 -0 (0) | $0.00, +0 -0 |
