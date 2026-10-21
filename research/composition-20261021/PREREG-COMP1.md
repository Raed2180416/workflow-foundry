# COMP-1 preregistration: composed vs monolithic construction on E8 (frozen 2026-10-21, before any paid build)

**Question** (owner, 2026-10-15): can a cheap builder (Haiku 5.5) construct a *composed* long-horizon enterprise
workflow correctly — a parent plus sub-workflows it chooses itself — and does composition help under faults and drift?

## Arms (development evidence)

**Paid builds:**
- **C-H**: Haiku 5.5 chooses the decomposition. K = 3 builds.
- **C-H-T**: Haiku 5.5 builds from frontier-written decomposition templates. K = 3. The templates come from the
  **clean-room** run `author-templates.mjs` (Opus 5.5, SPEC-E only). The agent-written templates are not used for the
  comparison, because their author had read the oracle.

**Existing rows, not re-run:**
- B1L-H lineage 1 and B1N-H lineages 2 and 3: monolithic Haiku builds.
- agent-H 10/14 and agent-H + V 12/14.

**Build conditions for every arm (same as B1L-H):**
- Haiku 5.5 at effort high, with a $3 and 40-minute cap per build.
- The same SPEC-E and CONTRACT text.
- A smoke loop on practice worlds 1235–1237.

## Frozen harness

- Harness commit: the commit containing this file (parent `663f14b`).
- sha256 prefixes of `experiments/compose/`:

```
102b02483d67cb31  experiments/compose/author-templates.mjs
88e23afc0705a675  experiments/compose/build.mjs
d1591a73f8fefd95  experiments/compose/bundle.mjs
533e0b9aaa390cbe  experiments/compose/capabilities.mjs
2487c8e59e982bf1  experiments/compose/drift-run.mjs
31dd10e319868a45  experiments/compose/drift.mjs
bf1a6bda26711c09  experiments/compose/fault-run.mjs
b2c6c6d40fc0d74e  experiments/compose/faults.mjs
fa9ae678e5af7cb7  experiments/compose/loader.mjs
43e8d636e638840e  experiments/compose/reference.mjs
a12bac31af9e6446  experiments/compose/run.mjs
14591e30564316af  experiments/compose/runtime.mjs
b1b2c3ac12843590  experiments/compose/smoke.mjs
8f13ca4ae03550a3  experiments/compose/trace.mjs
6867314d0904699a  experiments/compose/validate.mjs
faa8d1560faf7d72  experiments/compose/builder/COMPOSE.md
```

## Measures

All are graded at $0 after each build.

| # | Measure | Where | Role |
|---|---|---|---|
| M1 | Completed-case pass, E8 oracle | grading worlds 1232–1234 × d2, d3, d5, plus 1232 d2 size 12 (the paired 14 cases) | Primary. Pooled over K = 3 builds per arm; per-build values reported |
| M2 | Capability-contract pass (13 contracts) | same worlds | — |
| M3 | Interface violations | strict and audit mode | Audit mode separates honesty from consequence |
| M4a | Restart | fault battery, dev worlds 1161 d2, 1162 d3, 1164 d5 | Reported as its own row |
| M4b | Crash after apply with redelivery | same | Reported as its own row |
| M4c | Delayed duplicate | same | Reported as its own row |
| M4d | Same-instant duplicate (E8's known MR5 gap) | same | Reported as its own row |
| M4e | Downstream failure after a side effect (MR11) | same | Reported as its own row |
| M5 | Drift D1 (R2.2) | — | Pass after rebuild or patch, and which modules changed |
| M6 | Build $ and wall time | — | Machine load recorded during each build |

## Predictions (author, fixed now)

- **P1. Buildability.** At least 2 of 3 C-H builds produce a program that loads and passes the interface checks in
  strict mode.
- **P2. Correctness.** Pooled C-H M1 is at least 0.95, against B1L-H's mean of 0.982.
  - Composition should not cost much correctness.
  - A miss reads "composition costs correctness at equal budget". It is not inconclusive, because the M1 sample is
    large (thousands of completed cases).
- **P3. Fault robustness.**
  - Under M4d, at least one C-H build loses fewer cases than the best monolith (32 of 43 lost on 1161 d2).
  - Under M4e, the median C-H build completes every compensation, where B1L-H lineage 1 leaves 3 of 27 incomplete.
- **P4. Templates help.** C-H-T's M1 is at least C-H's, and C-H-T's interface violations are at most C-H's.

## Reading rules

- **Status.** These are dev worlds and K = 3, so the evidence is development-grade. No sealed claim follows.
- **H-COMP** ("cheap builders construct correct composed workflows"):
  - **supported** if P1 and P2 both hold;
  - **refuted** if fewer than 2 of 3 C-H builds load, or pooled C-H M1 is below 0.90;
  - otherwise **inconclusive**.
- **Machine load.** If load during a build exceeded 8 for more than half its wall time, that build is flagged and
  reported both with and without it.
- **The composition trace.** `decisions.composition` is never graded.

## Cost

| Item | Estimate | Cap |
|---|---|---|
| C-H builds | about $0.75–1.50 each, about $2–5 for K = 3 | $9 |
| Clean-room templates | $1–3 | $5 |
| C-H-T builds | as C-H | $9 |
| **Total** | | **$23** |
