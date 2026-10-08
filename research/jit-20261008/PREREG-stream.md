# Pre-registration: `jit-stream-1` (DRAFT, not frozen)

*Draft written 2026-10-08 while the JIT v0 was being built. Fields marked **TBD** are fixed after the dev stream
`dev-records-1` and before the first held-out task runs. When it is frozen, the commit SHA goes in the table and
edits go only in Amendments.*

| Field | Value |
|---|---|
| Experiment id | `jit-stream-1` |
| Claim tested | On a stream of 24 recurring tasks with a mid-stream difficulty shift, a JIT that interprets with an agent, compiles from traces into code with Haiku 5.5, and guards/deopts/shadows delivers **at least as many oracle-verified successes as a Haiku 5.5 agent run on every task, at a lower total cost per success**, without access to any oracle. Falsified if either inequality fails by more than the noise band on both streams. |
| Evidence class | `sealed`-style held-out: fresh test seeds nobody has inspected. The beds are not sealed beds, so the claim is "held-out seeds", not "held-out family" |
| Pre-registration commit | TBD |
| Date | TBD |

## 1. Beds and splits
- `records` 3.0.0 (`beds/records/index.mjs`, sha256 TBD); second family TBD (from the family scout).
- Stream: 16 tasks at the base difficulty, then 8 at the drift difficulty. Test split, seeds **7001–7024** for stream A
  and **7101–7124** for stream B, per family. Nobody has generated or inspected these seeds. The burned seeds
  (5001–5006, 6001–6004) are not used.
- Oracle controls (reference passes, bad controls fail) are run on these seeds by code before any arm runs. Only pass/fail
  counts are printed, never content.

## 2. Arms (frozen hashes TBD)

| arm | definition | models |
|---|---|---|
| agent-haiku | Claude Code agent on every task (b0Agent: $1, 15 min) | claude-haiku-5-5 |
| agent-sonnet | same | claude-sonnet-5-5 |
| agent-opus | same | claude-opus-5-5 |
| static | the C0 B1-haiku solver for the family; deopt or crash falls back to the Haiku agent | claude-haiku-5-5 |
| jit-H/H | interpreter Haiku, compiler Haiku (Opus fallback once) | haiku (opus on fallback) |
| jit-S/H | interpreter Sonnet, compiler Haiku | sonnet, haiku |
| jit-O/H | interpreter Opus, compiler Haiku | opus, haiku |

JIT parameters, from SPEC §6.1, final values TBD after dev: warmup 3, shadowEvery 4, recompileOnDeopts 2, maxTraces 8.

## 3. Measurements
- **Primary:**
  - oracle-verified successes out of 24 per stream;
  - cost per success, where cost is every dollar: interpretations, compiles, shadows, adjudications, compiled runs and fallbacks.
- **Secondary:**
  - steady-state success and cost on tasks 13–24;
  - success on the 8 drift tasks;
  - break-even index against each agent arm;
  - number of compiles and deopts by kind;
  - wrong-and-undetected rate (delivered compiled answers that fail the oracle, with no deopt or disagreement raised).
- K = 2 streams (A, B) per arm and family. The unit of analysis is the task, paired across arms.

## 4. Power
48 paired tasks per family per comparison. This round is directional: a success gap under 3 points (≈1.5 tasks of 48) is
noise, and only gaps that hold in both streams are reported as effects.

## 5. Analysis
`experiments/jit/report.mjs` (sha256 TBD) plus a paired comparison script (TBD).

## 6. Kill rule
- Stop an arm if it spends more than 2× its estimated budget.
- Stop everything if any oracle control fails.
- An arm whose environment faults exceed 25% of its tasks is reported as invalid.

## 7. Cost
Estimate TBD from the dev stream. Rough: agent arms $0.11 / $0.4 / $0.5 per task × 48; JIT arms ~$5–10 per stream.
Total is roughly $60–120, well under the $500 ask threshold.

## 8. Threats to validity
- The static arm's builder had oracle-scored probes; the JIT arms have none.
- Pseudo-labels from Haiku interpreters are noisy.
- Order effects within a stream are fixed by seed order and identical across arms.
- The CLI 1-hour prompt cache makes trial costs non-independent (P1 deviation 9).

## Amendments
(none yet)
