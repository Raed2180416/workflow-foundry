# M1: does one Haiku call already solve a W-bed rung? (2026-10-14)

*DESIGN.md §7 M1; DECISIONS-ADOPTED.md (spend approved, cap $15). Development evidence: dev attack seeds (W-BED §8 `wbed-attack`
379–390; R3′ 479–490), difficulty 3, one trial per task, K = 1. It is also the W-bed's preregistered admission gate (W-BED §2.4 item 1:
R0 ≥ 10/12; every other rung ≤ 2/12 at each effort). Runner: `experiments/need-router/m1-run.mjs` (journaled ModelPort, `b0Call`
at effort none and medium, `envFaultRule`). Raw rows: `results.jsonl`.*

| rung | effort none | effort medium | gate | reading |
|---|---|---|---|---|
| R0 (control) | **12/12** | **12/12** | ≥ 10/12 | control passes: harness valid |
| R1 | 0/12 | 0/12 | ≤ 2/12 | one call fails (6 + 12 of the 24 calls hit the call timeout) |
| R2 | 4/12 | 3/12 | ≤ 2/12 | **gate fails**: one call solves a third |
| R3 | 8/12 | 9/12 | ≤ 2/12 | **gate fails**: one call solves R3 at d3 |
| R3′ | 12/12 | 11/12 | ≤ 2/12 | **gate fails**: one call solves R3′ at d3 |
| R4 | 0/12 | 0/12 | ≤ 2/12 | one call fails (4 schema-invalid, 8 timeouts) |
| R5 | 0/12 | 0/12 | ≤ 2/12 | one call fails (4 schema-invalid) |
| R6 | 2/12 | 6/12 | ≤ 2/12 | **gate fails at medium** |

Spend: **$3.00** (192 calls). Mean ≈ $0.016 per call; R0 $0.0004, the 45–64K-token rungs $0.01–0.04.

**Cost caveat.** 26 calls ended in `MODEL_TIMEOUT` and are recorded at $0 by the runner. DESIGN §2 charges a killed or timed-out
session at its bound ($1 per call here), so for utility the label factory must re-price them (label-run.mjs does; M1's raw rows do not).

**What it means for the need router (dev, K = 1).**
- At d3, three of the rungs built to need structure (R3, R3′ and, at medium effort, R6) are mostly or fully solved by one call;
  R2 is a third solved. "Needs a workflow" is a property of the job at a difficulty and size, not of the family's name: the
  hypotheses table's "R3: direct at d2–3, build at d4–5" is confirmed at d3 for the direct half.
- R1, R4 and R5 are not solved by one call at d3, partly by the call timeout: a single call that cannot finish within its budget is
  a real outcome for the router (direct is not viable there), not an environment fault.
- For the W-bed itself: R2, R3, R3′ and R6 fail their one-call admission gate at d3 (W-BED §2.4: attack success drops the rung at
  that difficulty); they stay usable at d4–d5 if the gate is re-run there.

## M1 at difficulty 5 (R2, R3, R3′, R6; `runs/m1-d5/`; $5.92)

| rung | d3 (none / medium) | d5 (none / medium) | reading |
|---|---|---|---|
| R2 | 4/12 / 3/12 | 2/12 / 2/12 | passes its one-call gate at d5 |
| R3 | 8/12 / 9/12 | **0/12 / 0/12** (12 + 5 timeouts, 4 schema-invalid) | one call suffices at d3, fails at d5: the need flips with difficulty |
| R3′ | 12/12 / 11/12 | **10/12 / 11/12** | one call still suffices at d5: this rung does not need a workflow for Haiku at either level |
| R6 | 2/12 / 6/12 | **0/12 / 0/12** (11 timeouts) | flips like R3 |

The same family needs no workflow at one difficulty and clearly needs one at another (R3, R6), and one family built to need
structure never does at the levels tested (R3′). "Needs a workflow" is a property of the job instance (size, difficulty), so the
router must read the instance, never the family name. For the W-bed: R2, R3 and R6 pass their one-call gate at d5; R3′ fails it at
both levels.
