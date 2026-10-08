# Headroom calibration for the second stream family (2026-10-08, development evidence)

Haiku 5.5 and Sonnet 5.5 Claude Code agents (b0Agent, $1 budget, 15 min), K = 1, dev split seeds 301–304.
Script: `experiments/jit/calibrate.mjs`. Raw rows: `experiments/runs/jit/calibration/*.jsonl` (gitignored; numbers
copied here). Picking the family came from the scout report (family scout, 2026-10-08), which found no
measured agent result outside records and codefix.

| family | d | agent-haiku | $/task | agent-sonnet | $/task |
|---|---|---|---|---|---|
| codefix | 4 | 4/4 | 0.014 | 4/4 | 0.060 |
| codefix | 5 | 4/4 | 0.015 | 4/4 | 0.071 |
| kinetics | 3 | 4/4 | 0.039 | 3/4 | 0.176 |
| kinetics | 4 | **2/4** | 0.056 | **2/4** | 0.270 |
| incident | 3 | 4/4 | 0.020 | 2/4 | 0.139 |

Reading (directional, n = 4 per cell):
- **codefix d4/d5 and incident d3 have no headroom** for a Haiku agent, which solves them for about 2 cents. Here
  compiling cannot pay for itself. These families are the router's *interpret* case, a negative result worth keeping.
- **kinetics d4 has headroom for both agents** (2/4 each; Sonnet at 5× the cost). It becomes the second stream family:
  16 tasks at d4 plus 8 at d5 (drift). There is no C0 static solver for kinetics, so that stream has no static arm.
- Sonnet below Haiku on kinetics d3 and incident d3 is within noise at n = 4. It is recorded, not interpreted.
