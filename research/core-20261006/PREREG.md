# Pre-registration: p1-records-v3 (Phase 1 exit)

| Field | Value |
|---|---|
| Experiment id | `p1-records-v3` |
| Claim tested | Phase 1 exit (ROADMAP §5.1): a hand-written Foundry workflow for one Tier-A family runs on M and L models (S is parked, see below) with a check on every model node and reproducible context receipts; its verified success, pass^3 and CPS are reported against single-call (B0), notes (B0+N) and agent (B0-agent) baselines. Directional question for C1: does the workflow let the cheap model (Haiku 5.5, class M) reach or beat the success of a strong single call (Sonnet 5.5) at lower cost, and does it rescue a weaker model (Haiku 4.5 single call as reference)? |
| Evidence class | **development**. The workflow (`experiments/workflows/records-v3.mjs`) was built by an Opus agent on `records` dev seeds 101–160 (d3–d4) without reading the generator internals, then independently reviewed on dev seeds it had not used. Evaluation uses the bed's `test` split, seeds 5001–5006, never inspected: held-out *instances* of a *development* family. Not claim-bearing for generalisation. |
| Pre-registration commit | recorded in the Amendments section when frozen |
| Date | 2026-10-07 |

## 1. Beds and splits
- Family `records` **v3.0.0** (`beds/records/`, audited 2026-10-07, `beds/records/AUDIT.md`). From difficulty 3, five conventions are drawn per task and stated only in paraphrased source notes (date orders of three systems, meaning of extra status values, one re-stamped mirror system, balance sign perspective per system); a 40-line heuristic passes 0/30 at d3. d1–d2 are byte-identical to v2 and scriptable, so they are not used.
- Oracle: `beds/records/index.mjs` `oracle()` (scores a plain copy of the output, `score.mjs`); pass iff field accuracy ≥ 0.97, cluster pair-F1 ≥ 0.95 and extra/missing entities within 2% (bed README). Bed tests green before the run (`node --test beds/records/`: 28/28).
- Tasks: `test` split, difficulty 3 and 4, seeds 5001–5006 → 12 tasks. Task hashes are printed by `node experiments/p1/run.mjs --dry`.

## 2. Arms (K = 3 trials per task)
| Arm | Definition | Model(s) | Budget/task |
|---|---|---|---|
| `b0call-haiku-none` | B0: one structured call with the whole task (`experiments/lib/arms/b0-call.mjs`), thinking off | Haiku 5.5 | per-call CLI cap $1 |
| `b0call-haiku-med` | same, thinking budget 8K | Haiku 5.5 | $1 |
| `b0call-haiku45-none` | same, thinking off (reference: the previous, weaker Haiku) | Haiku 4.5 | $1 |
| `b0call-sonnet-med` | same, thinking budget 8K | Sonnet 5.5 | $1 |
| `b0ncall-haiku-med` | B0+N: as `b0call-haiku-med` plus append-only notes rewritten after each task given only the outcome bit; 3 seeded stream orders | Haiku 5.5 | $1 + notes call |
| `b0agent-haiku` | B0 executor: Claude Code headless with Bash/Read/Write/Edit/Glob/Grep in a sandbox with the repo hidden | Haiku 5.5 | $1, 20 min |
| `fhand-haiku` | F: `experiments/workflows/records-v3.mjs`. Code nodes parse the five structured systems, the spec tables, identity rules, merge, FX; typed agent nodes read each per-task convention (date order per system, status meanings, mirror, perspective), VENDEX free text (two independent reads) and non-exact countries; every model node has checks; E1/E2 escalation up to L | Haiku 5.5 (+ Sonnet 5.5 on escalation) | run maxCost $2, 20 min |
| `fhand-sonnet` | same workflow, every model node on Sonnet 5.5 | Sonnet 5.5 | $2, 20 min |

Held constant: the bed, oracle, tasks, the policy subset `[claude-haiku-5-5, claude-haiku-4-5-20251001, claude-sonnet-5-5]` of `policy/models.json` (hash printed by `--dry`), the CLI version (recorded per call in the journal). Arms run interleaved (rotated order per task), concurrency 4. Local generative models were parked before freezing (owner decision 2026-10-07; negative result in `docs/RESEARCH.md`), so class S is not run.

## 3. Measurements
- Primary: verified success rate (oracle pass) and CPS = all list-price USD (including failed trials, retries, escalations and B0+N notes calls) ÷ verified successes. Calls whose spend could not be observed (killed calls) are charged at their bound and reported separately.
- Secondary: pass^3 (unbiased, per task, averaged), mean oracle score, cost per trial, latency, escalation counts and which node escalated, verdict distribution, error codes.
- Analysis: `node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl`. Paired comparisons (difficulty as the cluster, 10 000 bootstrap resamples, exact McNemar on per-task majority outcome): fhand-haiku vs each B0 arm and vs b0call-sonnet-med; fhand-sonnet vs b0call-sonnet-med; b0call-haiku-none vs b0call-haiku45-none.

## 4. Power
12 tasks × K = 3. A +10-point success difference needs ~116–234 paired tasks (R05 §3); a 30% cost reduction needs ~23–89. This experiment is **under-powered** for success differences below ~35 points and is **directional only**; cost ratios with a CI excluding 1 can still be reported as development evidence.

## 5. Decision rules
- Gaps under 3 points are noise. No K=1 comparative claim.
- "Cheap workflow reaches strong-single-call success at lower cost" is supported (directionally) only if fhand-haiku's success CI overlaps or exceeds b0call-sonnet-med's AND the CPS ratio (fhand-haiku / b0call-sonnet-med) upper CI bound is < 1.
- Environment faults (usage limits, outages, sandbox unavailable) on a failed trial exclude that trial from results and retry it on resume (`envFaultRule`); more than 25% faulted trials stops the run.

## 6. Kill rule
Stop if total spend exceeds $60, if any single arm exceeds $20, or if rate limits make an arm miss more than 20% of its trials (record and report).

## 7. Cost
Estimate from the dev pilots (`/var/tmp/foundry-work/records-v3/dev-log.jsonl`): fhand on Haiku 4.5 $0.11–0.12/task, all-Sonnet $0.17–0.28/task; Haiku 5.5 is priced at a tenth of Haiku 4.5. Single calls at d3–d4 (~7–9K input tokens): Haiku 5.5 < $0.01, Haiku 4.5 ≈ $0.02–0.06, Sonnet ≈ $0.05–0.15; B0-agent ≤ $1. 8 arms × 36 trials ≈ **$25–40** list price. Under the $500 pause rule.

## 8. Threats to validity
- The workflow encodes family knowledge (the five structured line formats, the spec's rule shapes) learned on dev seeds: it is a hand-written ceiling, not construction (C0 measures construction).
- Single family: no transfer claim.
- Claude CLI route: no temperature control; thinking budget set by `MAX_THINKING_TOKENS`; the CLI version can change between days (recorded per call).
- Shared subscription limits can stall runs; stalls are recorded, not retried silently.
- The workflow was developed with Haiku 4.5 as the M model and switched to Haiku 5.5 before freezing (dev check on seeds 151–155 recorded under Amendments).

## Amendments
(dated entries only)
