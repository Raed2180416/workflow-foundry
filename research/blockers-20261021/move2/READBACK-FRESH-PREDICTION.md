# Read-back option: prediction before the fresh-world check (written 2026-11-04, before the run)

**Why.** The read-back option (`runtime2.mjs`, `reconcile`) was designed after reading the crash rows of dev worlds 1161,
1162 and 1164 (a monolith lost one case behind the plain envelope that it passes without it). On those worlds every crash
loss of all nine subjects goes to 0 with read-back, but that is in-sample. This check runs it on two dev worlds the
option was not designed on. Development evidence, $0, runtime2 outside the PREREG-COMP1 freeze (D28 (3)).

**Run.** `nice -n 15 node experiments/compose/move2-battery.mjs --plan fresh --worlds 1181:3:40,1183:5:40
--out research/blockers-20261021/move2/runs-fresh`. Subjects: ch-e8-2 (the D3 build), cht-e8-1 (the best C-H-T build),
b1lh-e8-1 (a monolith). Each under runtime 1, plain runtime 2 and runtime 2 with read-back; faults `none` and `crash`.

**Predictions (6 cells = 3 subjects × 2 worlds).**
- P1. Fault-free: the logical journal digest and the business-row digest of runtime 2 with read-back equal plain
  runtime 2's in 6 of 6 cells, and plain runtime 2's equal runtime 1's in 6 of 6.
- P2. Crash loss (cases passed fault-free minus cases passed under crash, same runtime): runtime 2 with read-back ≤ plain
  runtime 2 in 6 of 6 cells, and = 0 in at least 5 of 6.
- P3. No logical duplicate and no 409 key conflict in any runtime-2 cell (with or without read-back), and no critical
  finding beyond the subject's fault-free ones.

**Kill.** Any fault-free digest differs (P1), or read-back loses more than plain runtime 2 in any cell (P2): then
read-back is not proposed as the runtime2 default.
