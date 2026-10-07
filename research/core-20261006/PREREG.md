# Pre-registration: p1-records (Phase 1 exit)

| Field | Value |
|---|---|
| Experiment id | `p1-records-hosted` |
| Claim tested | Phase 1 exit (ROADMAP §5.1): a hand-written Foundry workflow for one Tier-A family runs on M and L models (ROADMAP names S/M/L; S is not run, see below) with a check on every node and reproducible context receipts; its verified success, pass^3 and CPS are reported against B0 and B0+N. Directional question for C1: does the workflow let a cheap model (Haiku 4.5, class M) reach the success of a strong single call (Sonnet 5.5) at no higher cost? (A local Qwen3.5-4B lane was dropped before freezing: owner decision 2026-10-07 to park local generative models on this CPU-only VM; see README and docs/RESEARCH.md.) |
| Evidence class | **development**. The workflow was designed by the experimenter on `records` dev seeds 101–103 (d2–d3). Evaluation uses the bed's `test` split, seeds 5001–5006, never inspected: held-out *instances* of a *development* family. Not claim-bearing for generalisation. |
| Pre-registration commit | recorded in the Amendments section when frozen (the commit that also contains the Phase 1 review fixes) |
| Date | 2026-10-07 |

## 1. Beds and splits
- Family `records` (`beds/records/`, contract v1). Oracle: `beds/records/index.mjs` `oracle()`; pass iff field accuracy ≥ 0.97, cluster pair-F1 ≥ 0.95 and extra/missing entities within 2% (bed README).
- Tasks: `test` split, difficulty 2 and 3, seeds 5001–5006 → 12 tasks. Task hashes are printed by `node experiments/p1/run.mjs --dry`.
- Oracle controls (bed test suite, `node --test beds/records/`): reference solver passes, all seven bad controls fail, an inputs-only solver passes (12 tests green before the run).

## 2. Arms (K = 3 trials per task)
| Arm | Definition | Model(s) | Budget/task |
|---|---|---|---|
| `b0call-haiku-med` | B0: one structured call with the whole task (`experiments/lib/arms/b0-call.mjs`), thinking budget 8K | Haiku 4.5 | per-call CLI cap $1 |
| `b0call-haiku-none` | same, thinking off | Haiku 4.5 | $1 |
| `b0call-sonnet-med` | same, thinking budget 8K | Sonnet 5.5 | $1 |
| `b0ncall-haiku-med` | B0+N: as `b0call-haiku-med` plus append-only notes rewritten after each task given only the outcome bit; 3 seeded stream orders | Haiku 4.5 | $1 + notes call |
| `b0agent-haiku` | B0 executor: Claude Code headless with Bash/Read/Write/Edit/Glob/Grep in a sandbox with the repo hidden | Haiku 4.5 | $1, 15 min |
| `fhand-haiku` | F: hand-written workflow `experiments/workflows/records-hand.mjs` (code nodes for splitting, spec tables, identity rules, merge, FX; one agent node per 6-row chunk, thinking off, E1/E2/E7 escalation up to L) | Haiku 4.5 (+ Sonnet on escalation) | run maxCost $2 |
| `fhand-sonnet` | same workflow, extraction on Sonnet | Sonnet 5.5 | $2 |

Held constant: the bed, oracle, tasks, policy file (`policy/models.json`), CLI version (recorded per call in the journal). Arms run interleaved (rotated order per task) with concurrency 3.

## 3. Measurements
- Primary: verified success rate (oracle pass) and CPS = all list-price USD (including failed trials, retries, escalations and B0+N notes calls) ÷ verified successes. Calls whose cost is unknown (timeouts) are reported with their upper bound separately.
- Secondary: pass^3 (unbiased, per task, averaged), mean oracle score, cost per trial, escalation counts, verdict distribution, error codes.
- Analysis: `node experiments/p1/analyze.mjs experiments/runs/p1/results-*.jsonl`. Paired comparisons (difficulty as the cluster, 10 000 bootstrap resamples, exact McNemar on per-task majority outcome): fhand-haiku vs each B0 arm and vs b0call-sonnet-med; fhand-sonnet vs b0call-sonnet-med.

## 4. Power
12 tasks × K = 3. A +10-point success difference needs ~116–234 paired tasks (R05 §3); a 30% cost reduction needs ~23–89. This experiment is **under-powered** for success differences below ~35 points and is **directional only**; cost ratios with a CI excluding 1 can still be reported as development evidence.

## 5. Decision rules
- Gaps under 3 points are noise. No K=1 comparative claim.
- "Cheap workflow reaches frontier success at no higher cost" is supported (directionally) only if fhand-haiku's success CI overlaps or exceeds b0call-sonnet-med's AND the CPS ratio upper CI bound is ≤ 1.

## 6. Kill rule
Stop if total spend exceeds $60, if any single arm exceeds $25, or if rate limits make an arm miss more than 20% of its trials (record and report).

## 7. Cost
Estimate from pilots (`experiments/runs/calibration`, `experiments/runs/records-hand-pilot`): per trial ≈ b0call-haiku $0.17, b0call-sonnet $0.15, b0ncall $0.20, b0agent ≤ $0.5, fhand-haiku $0.09–0.20, fhand-sonnet $0.21–0.33 → 36 trials × ≈ $1.4 ≈ **$50**. Under the $500 pause rule.

## 8. Threats to validity
- The workflow encodes family knowledge (spec table formats, system date/number conventions) learned on dev seeds: this is a hand-written ceiling, not construction (Phase 2 measures construction).
- Single family: no transfer claim.
- Claude CLI route: no temperature control; thinking budget set by `MAX_THINKING_TOKENS`; the CLI version can change between days (recorded per call).
- Shared subscription limits can stall runs; stalls are recorded, not retried silently.

## Amendments
(dated entries only)
