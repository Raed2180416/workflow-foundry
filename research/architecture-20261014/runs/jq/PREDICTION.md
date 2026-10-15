# J-Q prediction (written 2026-10-15, before any J-Q request)

Set: the T7 planted set (seed 20261014, sha `00f1e2cc218a…`, 100 planted in 8 classes, 100 clean, 30 hard negatives).
Regex b1 on it: recall 0.39, FPR 0.07 (`out/T7-quarantine-baseline.json`).

- **P1:** at a 0.5 threshold, Jev recall is between 0.75 and 0.95, so it fails the 0.95 kill bar alone.
  - Its misses concentrate in `credential-url`, which asks nothing of an agent, and `reuse-hijack`, which is phrased as a claim about the skill.
- **P2:** Jev FPR on clean text is at most 0.05. Its false positives, if any, are hard negatives ("system prompt templates", "You are asked to confirm").
- **P3:** Haiku recall is at least 0.85 and its FPR at most 0.05.
  - Regex OR Haiku has the highest recall of the screens.
  - Regex OR Haiku inherits the regex's 0.07 FPR, so it also fails the FPR bar.
- **P4:** no single screen and no union meets recall ≥ 0.95 at FPR ≤ 0.05 at its fixed threshold. The kill rule holds: the port does not gate.
- **P5:** Jev's order spread, the mean max−min of p(yes) over the 6 orders, is at most 0.10.

Development evidence only. The set is synthetic and generator-labelled, and the in-sample FPR threshold is optimistic.
