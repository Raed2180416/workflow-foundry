# Pre-registration: c0-dev (construction, development round)

| Field | Value |
|---|---|
| Experiment id | `c0-dev` |
| Claim tested | C0 (ROADMAP §4.1), development round: given a task family it has not solved before, does the same builder agent (Claude Code, Opus 5.5) produce a working solver more often, and with lower total cost per verified success, when it builds a typed Foundry workflow (F) than when it writes an ordinary orchestration script (B1), and than when it solves each task directly (B0)? |
| Evidence class | **development**. Families are the 5 one-shot dev beds; the Foundry construction skill (`skills/micro-harness`) was written by the experimenter using the records pilot. Results may be used to improve the protocol and skill before the sealed round (`PREREG-sealed.md`), which is the claim-bearing test. |
| Pre-registration commit | recorded under Amendments when frozen |
| Date | 2026-10-07 |

## 1. Beds and splits
- Families: `records`, `incident`, `codefix`, `synth`, `kinetics` (all `kind: oneshot`), difficulty 3.
- Probes given to builders: `dev` split seeds 1, 2, 3.
- Evaluation tasks: `test` split seeds 6001–6004 (4 tasks per family; never inspected).
- Oracles: each bed's `oracle()`; bed test suites green before the run.

## 2. Arms
| Arm | Construction | Execution per task |
|---|---|---|
| F | Opus 5.5 builder in the executor sandbox with the Foundry kit, `skills/micro-harness`, probes, `/score` (≤ 12 checks), model gateway ($2 cap); builder cap $8; 45 min | the delivered `workflow.json` on the Foundry runtime (host), run maxCost $1 |
| B1 | same builder, same probes, `/score`, gateway, caps and time; writes `solve.mjs` | `node solve.mjs task.json` in the sandbox, gateway per-task cap $1 |
| B0-opus | none | Claude Code headless (Opus 5.5) with tools, per-task cap $2, 20 min |
| B0-haiku | none | same with Haiku 4.5, per-task cap $1 |

Models a builder may assign: `qwen3.5-4b-q4km` (local, slow), `claude-haiku-4-5-20251001`, `claude-sonnet-5-5`, `claude-opus-5-5`. Prompts: `experiments/c0/prompts.mjs` (hash under Amendments). One construction per family per arm (K_c = 1 in this round). Execution K = 2 trials per task.

## 3. Measurements
- **Construction success**: artifact delivered and runs without harness fault on all probes.
- **TTFH**: score checks and wall time until the first passing probe check (from `/score` logs).
- **Verified success** on the 4 × 2 evaluation trials per family and arm.
- **CPS** = (construction $ + all execution $) / verified successes, with construction amortised over the 8 evaluation trials, and the break-even task count vs B0-opus.
- Per-task execution cost, latency, harness-fault rate, verdicts (F), models used.

## 4. Analysis and power
`node experiments/c0/analyze.mjs` (frozen with this file). 5 families × 4 tasks × K = 2 is far below the power needed for success differences (R05 §3): **directional only**. Report per-family tables and family-clustered bootstrap CIs; no claim is made from this round.

## 5. Kill rule
Stop if a construction session exceeds its caps by more than 20% (measurement failure), if total spend passes $250, or if usage limits stall more than 25% of runs (record and resume after reset).

## 6. Cost estimate
Constructions: 10 × ≤ $10 = ≤ $100. Execution: F and B1 ≤ $1 × 8 × 5 × 2 = ≤ $80 (likely much less); B0-opus ≤ $2 × 40 = ≤ $80; B0-haiku ≤ $40. Total ≤ $300 at caps, expected ≈ $120.

## 7. Threats
- One construction per arm per family: builder variance is large (the Haiku smoke built a single-node workflow); the sealed round uses K_c = 2.
- The skill was written with knowledge of the records family (only general lessons are in it; a literal scan of the kit for dev-family strings is part of the sealed protocol).
- B1's script and F's workflow run on different substrates (sandboxed Node vs Foundry runtime on the host); both reach models only through the same policy, journal and pricing.

## Amendments
(dated entries only)
