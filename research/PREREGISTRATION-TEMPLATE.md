# Pre-registration: <experiment id>

Copy this file to `research/<topic>-<date>/PREREG.md` and fill every field **before** the
first comparative run. Commit it, record the commit SHA below, and do not edit it after
that except in the "Amendments" section (dated, with a reason). An experiment without a
committed pre-registration produces diagnostic evidence only, never a claim.

| Field | Value |
|---|---|
| Experiment id | |
| Claim tested | C0 / C1 / C2 / C3 / C4 / C5 (ROADMAP §4.1), stated as a falsifiable sentence |
| Evidence class | `development` (diagnostic) or `sealed` (held-out, claim-bearing) |
| Pre-registration commit | `git rev-parse HEAD` after committing this file |
| Date | |

## 1. Beds and splits
- Families and their generators (path + content hash):
- Dev split (seeds / ids) and sealed split (seeds / ids, or the hash of the sealed manifest
  if the split is hidden from the builder):
- Who authored the sealed split, and what the experimenter has and has not seen:
- Oracle per family (path + sha256). Oracle controls run before the experiment:
  known-good (reference solver) must pass, known-bad (no-op, corrupted output) must fail.
  Record the control results here before any arm runs.

## 2. Arms
For every arm: what it is, the model ids (from `policy/models.json`, with policy version),
the tools, the budget per task (USD, tokens, wall time, steps), the construction budget if
any, and the hash of the frozen arm definition (prompt/script/workflow).

| Arm | Definition | Models | Tools | Budget/task | Frozen hash |
|---|---|---|---|---|---|
| B0 | plain executor | | | | |
| B0+N | B0 + append-only notes | | | | |
| B1 | independent CC-workflow-style script | | | | |
| B5 | best-of-K with the same verifier | | | | |
| F | Foundry | | | | |
| Ceiling | hand-written workflow | | | | |

Held constant across arms: model(s), tools, environment image, per-task budget, verifier.
Interleaving: arms run interleaved per task on identical environments (order recorded).

## 3. Measurements
- Primary metric and its exact definition (e.g. verified success; CPS = all USD incl.
  failures, construction and verification ÷ oracle-verified successes):
- Secondary metrics (pass^k with k=, TTFH, reuse / deopt / wrong-reuse, cost, latency):
- K (trials per task per arm), stream orders (≥3 for learning arms):
- Unit of analysis and clustering (family-clustered paired bootstrap, B=10000):

## 4. Power
- Assumed effect size, variance source, α, power, resulting n (cite ROADMAP §4.3 / R05 §3):
- If the affordable n is below the required n, say so here and downgrade the result to
  "directional" in advance.

## 5. Analysis
- Analysis script path and sha256 (frozen before data collection):
- Decision rule (e.g. non-inferiority margin δ, CI level):
- Gaps under 3 points are noise. No K=1 comparative claim.

## 6. Kill rule and falsifiers
- Kill rule (stop early if …):
- Falsifiers from ROADMAP §4.3 that apply:

## 7. Cost
- Estimated cost (show the arithmetic). Above $500 for a single experiment: stop and ask
  the owner in README first.
- Cost ledger entry id in README:

## 8. Threats to validity
- Contamination / leakage controls (library leakage scan for task literals, gold-patch probe):
- Oracle weaknesses known in advance:
- Infrastructure noise controls:

## Amendments
(dated entries only)
