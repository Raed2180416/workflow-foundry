# Pre-registration: `jit-stream-1` (DRAFT, not frozen)

*Draft written 2026-10-08 while JIT v0 was being built, and revised 2026-10-09 after BLOCKER-SYNTHESIS row 1 (the analysis
instrument) and row 5 (the verification-policy simulator). Fields marked **TBD** are fixed after the R0 and R0-K
rehearsals (BLOCKER-SYNTHESIS §4.1 steps 3–4) and before the first held-out task runs. At freeze, the commit SHA goes in the
table, and later edits go only in Amendments. This document makes no comparative claim.*

| Field | Value |
|---|---|
| Experiment id | `jit-stream-1` |
| Claim tested | On a stream of 24 recurring tasks with a mid-stream difficulty shift, a JIT that interprets with an agent, compiles from traces into code with Haiku 5.5, and guards/deopts/shadows delivers **at least as many oracle-verified successes as a Haiku 5.5 agent run on every task, at a lower total cost per success**, without access to any oracle. Supported or falsified only by the §4 decision rule. Anything else is reported as "directional, no decision". |
| Evidence class | `sealed`-style held-out: fresh test seeds nobody has inspected. The beds are not sealed beds, so the claim is "held-out seeds", not "held-out family" |
| Engine freeze point | TBD: commit, construction-kit hash and policy hash (BLOCKER-SYNTHESIS S0-4), shared by R0, R0-K and this run |
| Pre-registration commit | TBD |
| Date | TBD |

## 1. Beds, splits, seeds and order

**Beds.** `records` 3.0.0 (`beds/records/index.mjs`, sha256 TBD) and `kinetics` (sha256 TBD), the family of the dev run
`jit-dev-kinetics-1`.

**Seeds** (test split, per family):

| stream | seeds | records | kinetics |
|---|---|---|---|
| A | **8001–8024** | 8001–8016 at d3, then 8017–8024 at d4 | 8001–8016 at d4, then 8017–8024 at d5 |
| B | **8101–8124** | 8101–8116 at d3, then 8117–8124 at d4 | 8101–8116 at d4, then 8117–8124 at d5 |

In each family, stream A runs 16 base-difficulty tasks and then 8 drift tasks, as the dev configs do (HANDOFF §5.2).

- **Why 8001+ and not 7001+.**
  - Kev's registry reserves test seeds 7000–7039 and 7040–7199 for every bed (`experiments/kev-data/lib/registry.mjs`).
  - That is a reservation, not contamination. No records or kinetics world with a test seed in 7000–7199 has been
    generated or read.
  - Moving to 8001+ is $0 insurance against a future two-way collision. The clean range is test seeds ≥ 7200 for every
    bed.
  - Synth test seeds 7000–7099 were already generated and scored once (`beds/synth/AUDIT.md`), so they count as used.
  - The burned seeds 5001–5006 and 6001–6004 are not used.
- **Ledger.** Every range is recorded per (bed, split) in `research/jit-20261008/SEED-LEDGER.json` (BLOCKER-SYNTHESIS
  S0-5, maintained separately). Before any arm runs, the frozen configs must pass the ledger check.
- **More streams.** If the owner raises K (§4), the extra streams take further ranges that the ledger must reserve first,
  for example 8201–8224 and 8301–8324. No such range is used without a ledger entry.

**Oracle controls run first.** Run `node experiments/jit/oracle-controls.mjs <frozen config>` on every frozen config before
any arm runs. The reference must pass and every bad control must fail. It prints only counts and task hashes, never
content. Any failure stops everything (§6).

**Order rule** (this reconciles §8 with ROADMAP §4.3):
- Within a stream, tasks run in seed order inside each difficulty block (base, then drift). The order is identical across
  arms, so tasks pair.
- A world is a hash of (bed, version, split, seed, difficulty), so seed order is a random order with respect to task content.
- Each stream is an independent order, and each stream carries one compiled-solver lineage per JIT arm.
- With K = 2 there are **2 random orders, not the ≥ 3 that ROADMAP §4.3 asks for. This deviation is declared.**
- **Why.** The power table (§4) shows that a third order (K = 3) leaves every cell at δ ≤ 10 points below 15% power under
  every ρ. The decision class does not change, and the JIT arms cost about 50% more.
- **Consequence.** Order effects are confounded with lineage and seed set, so a difference between streams A and B cannot
  be attributed to order.

## 2. Arms and configuration (frozen hashes TBD)

| arm | definition | models |
|---|---|---|
| agent-haiku | Claude Code agent on every task (b0Agent: $1, 15 min) | claude-haiku-5-5 |
| agent-sonnet | same | claude-sonnet-5-5 |
| agent-opus | same | claude-opus-5-5 |
| static | the C0 B1-haiku solver for the family; deopt or crash falls back to the Haiku agent | claude-haiku-5-5 |
| jit-H/H | interpreter Haiku, compiler Haiku (Opus fallback once); negative control | haiku (opus on fallback) |
| jit-S/H | interpreter Sonnet, compiler Haiku | sonnet, haiku |
| jit-O/H | interpreter Opus, compiler Haiku | opus, haiku |

**JIT parameters** (SPEC §6.1; final values after R0 and R0-K): warmup 3, recompileOnDeopts 2, maxTraces 8. The shadow
schedule is set below.

**Configuration** (HANDOFF §3, rehearsed by R0 and R0-K before the freeze):

| setting | records | kinetics |
|---|---|---|
| `jit.compare` | `'unordered'` | `'tolerant'`: relTol **TBD (BLOCKER-SYNTHESIS row 2, Stage B)**, absTol 1e-9, tolerantKeys `['vmax','km']` |
| `compile.compare` | `'tolerant'`, relTol 0 and absTol 0 | follows `jit.compare` |
| `compile.acceptance` | `'strict'` (minPartial 0.9) | `'strict'` (minPartial 0.9) |
| `compile.promptVersion` | 4 | 4 |
| `jit.preserveRefusals` | true | true |
| `jit.shadowOnFlags` | true | true |
| shadow schedule | see "Random shadow floor" below | same |

**Kinetics relTol.** The value comes from row 2 Stage B (two Haiku-agent sessions per kinetics dev seed 201–224).
- It may enter here as a dev-calibrated value only if the owner agrees (BLOCKER-SYNTHESIS Q4/O1). The calibration slice,
  kinetics dev 201–224, is then frozen, disclosed, and kept apart from claim seeds.
- If the owner does not agree, the **fallback** is either:
  - the task prompt's ±10% grading rule (`beds/kinetics/render.mjs:891`; the bed README's pass rule); or
  - the bed README's stated precision: the reference fit within 5%, a replicate-mean fit within 8% (DEV-NOTES D7, FG §4.1).

  Which one is chosen is written here **before** row 2's results are read. Row 2 then only reports that value's
  false-disagreement and false-agreement rates.

**Adoption rule.** Can a version with `accepted: false` be adopted (`stream.mjs:554`)? This is TBD, and it is decided with
step-0 acceptance hardening (S0-6) and written here.

**Random shadow floor: an explicit config choice, for system-view numbers only.**
- **Preferred: ε = 0.25, as a Bernoulli draw that replaces the periodic `shadowEvery: 4` schedule.**
  - A compiled ok run that raised no flag is shadowed with probability 0.25.
  - A flagged run is always shadowed (π = 1).
  - The propensity is logged on every row.
- **Basis:** `analysis/verification-policy-sim.md`.
  - ε = 0.25 has the same expected shadow count as every-4th, so arm behaviour and cost are approximately unchanged.
  - It removes the bias of flag- or dispute-only verification. On records dev that bias reached −21 points on the
    system-view miss rate.
  - It removes the realisation bias of a periodic schedule.
  - At n = 24 per arm-stream the system-view CIs stay wider than 0.30 for some arms. About ε = 0.5 would be needed for
    usable CIs, and that would double the scheduled shadows and change the JIT arms.
- **Requires** a `stream.mjs` option, for example `jit.shadowFloor`, that writes `row.shadowPropensity`. It must land before
  R0 so that R0 rehearses it.
- **If it has not landed by then: floor "none"** (`shadowEvery: 4` plus `shadowOnFlags`). The consequence: system-view miss
  and durability numbers are flag/periodic-only, biased optimistic by an unknown amount, and reported only as labelled
  descriptive counts, never as rates.
- **Either way:**
  - the oracle-scored outcomes in §3 are unaffected, because they are scored on every delivered answer
    (`durability.mjs:19–20`);
  - no system-view number enters the §4 decision rule.

## 3. Measurements

**Primary:**
- oracle-verified successes out of 24 per stream;
- cost per success, where cost is every dollar: interpretations, compiles, shadows, adjudications, compiled runs and
  fallbacks.

**Secondary:**
- steady-state success and cost on tasks 13–24;
- success on the 8 drift tasks;
- break-even index against each agent arm;
- number of compiles and deopts by kind;
- the wrong-and-undetected rate: delivered compiled answers that fail the oracle with no deopt or disagreement raised. It
  is oracle-scored on every delivered answer, so the shadow schedule cannot bias it.

**System view (descriptive only):**
- the miss rate and durability the system estimates from its own shadows: IPW with the logged propensity
  (`experiments/jit/stats.mjs ipwMissEstimate`) when a floor is set;
- otherwise, labelled counts, as in §2.

**Design.** K = 2 streams (A, B) per arm and family; one compiled-solver lineage per JIT arm per stream. The unit of
analysis is the task, paired across arms within a stream.

## 4. Power, units and the decision rule

**Units.**
- A *point* is one percentage point of pass rate. The owner's floor is 3 points (HANDOFF §0; ROADMAP:889): 0.72 tasks of
  24, 1.44 tasks of 48.
- `report.mjs:10` counts tasks: a gap under 3 tasks per stream, 12.5 points, is printed as noise.
- Every report prints both units and names the rule applied. The task rule is shown for continuity and never decides.

**Decision rule** (`experiments/jit/stats.mjs` `DECISION_RULE`, `decide`; CLI
`node experiments/jit/stats.mjs decide <armX> <armY> <runDirA> <runDirB>`). For arms X and Y in one family, an **effect is
reported only if every one of these holds:**
- **V:** neither arm is "invalid: env faults" (§6) in any stream, and the paired task sets match;
- **K:** K ≥ 2 streams (no K=1 claims);
- **F:** the pooled gap is ≥ 3 points, and in **every** stream the gap is ≥ 3 points in the same direction;
- **T:** the exact two-sided McNemar test on the pooled discordant pairs gives p < 0.05;
- **C:** the 95% lineage-clustered CI of the pooled paired difference excludes 0.

Otherwise the outcome is **"directional, no decision"**. Notes on the rule:
- **"In both streams" is F per stream, plus T and C pooled.** A test inside one stream sees one lineage and no
  between-lineage variance. Requiring a test in every stream would also make power fall as K grows.
- **The lineage-clustered CI.**
  - The cluster is the compiled-solver lineage for a JIT arm: one arm's stream, where v1 and every recompile descend from
    one state. For an agent or static arm the cluster is the task.
  - The CI is the wider of:
    - a two-stage cluster bootstrap (resample lineages, then tasks within each);
    - the paired-task bootstrap widened by √Deff, with Deff = 1 + (m − 1)ρ, m = 24 and **ρ = 0.1 assumed**. ρ has never
      been measured; it is amended when rows 16 and 31 measure it.
  - With K = 2 the bootstrap cannot see between-lineage variance, so the Deff term binds.
- **The McNemar test treats pairs as independent,** which is anti-conservative under clustering. That is why C is also
  required.

**Power formula** (`stats.mjs pairedPower`).
- **Margins.** pX = 0.8 + δ/2 and pY = 0.8 − δ/2.
- **Discordance.** ψ = pX(1 − pY) + pY(1 − pX). This assumes arms independent given the task, which is conservative.
- **Pooled test.** Var(dᵢ) = ψ − δ² and SE = √(Var · Deff / (K·m)). Power(T) = Φ(δ/SE − 1.96) + Φ(−δ/SE − 1.96), a normal
  approximation; exact McNemar is slightly more conservative.
- **Floor in every stream.** P(F in every stream) = Φ((δ − 0.03)/SE_s)^K, with SE_s = √(Var · Deff / m).
- **Full rule.** Power(rule) ≈ Power(T) · P(F in every stream). This is a lower bound, because the two events are
  positively correlated. C is taken to coincide with T.
- **Design-effect assumption.** ρ is the within-lineage intraclass correlation of the paired difference. Using one ρ for
  the paired difference treats the agent side as independent across tasks.

**Power table.** m = 24 tasks per lineage, α = 0.05 two-sided, 3-point floor. Each cell is the power of the full rule, with
the power of the pooled test alone in brackets. K = 1 is never a decision. MDE is the smallest δ with 80% power under the
rule.

| ρ | Deff | K | δ = 3 pts | δ = 5 pts | δ = 10 pts | effective n | MDE at 80% (rule) |
|---|---|---|---|---|---|---|---|
| 0 | 1.0 | 1 | – [6%] | – [7%] | – [14%] | 24.0 | never (K=1) |
| 0 | 1.0 | 2 | 2% [7%] | 3% [9%] | 12% [23%] | 48.0 | 23 pts |
| 0 | 1.0 | 3 | 1% [7%] | 2% [12%] | 13% [33%] | 72.0 | 22 pts |
| 0 | 1.0 | 4 | 1% [8%] | 1% [14%] | 12% [42%] | 96.0 | 22 pts |
| 0.1 | 3.3 | 1 | – [5%] | – [6%] | – [8%] | 7.3 | never (K=1) |
| 0.1 | 3.3 | 2 | 1% [5%] | 2% [6%] | 4% [10%] | 14.5 | 39 pts |
| 0.1 | 3.3 | 3 | 1% [6%] | 1% [7%] | 3% [13%] | 21.8 | 36 pts |
| 0.1 | 3.3 | 4 | 0% [6%] | 1% [8%] | 3% [16%] | 29.1 | 35 pts |
| 0.3 | 7.9 | 1 | – [5%] | – [5%] | – [6%] | 3.0 | never (K=1) |
| 0.3 | 7.9 | 2 | 1% [5%] | 2% [6%] | 2% [7%] | 6.1 | 52 pts |
| 0.3 | 7.9 | 3 | 1% [5%] | 1% [6%] | 2% [8%] | 9.1 | 49 pts |
| 0.3 | 7.9 | 4 | 0% [5%] | 0% [6%] | 1% [10%] | 12.2 | 48 pts |

**K.** Planned K = 2. The table shows:
- K ≤ 4 cannot decide any gap of 10 points or less under any ρ;
- at K = 2 the rule reaches 80% power only for gaps of about 23 points (ρ = 0) to 52 points (ρ = 0.3);
- raising K to 3 or 4 moves the MDE by at most 4 points.

So this round is **directional by rule for gaps below the MDE**. The owner chooses between this and a larger K
(BLOCKER-SYNTHESIS §4.1 step 4); the recommendation is K = 2. R0 is not used as a second lineage.

## 5. Analysis

- `experiments/jit/report.mjs` (sha256 TBD): per stream, both units, the env-fault table, and per-pair McNemar and CI
  labelled "directional, no decision (one stream)".
- `experiments/jit/stats.mjs` (sha256 TBD): `decide` over the K streams, plus the power table.
- `experiments/jit/durability.mjs` (sha256 TBD): oracle-view and system-view durability.
- The analysis-script hashes are recorded at freeze.

## 6. Kill rule and validity

- Stop an arm if it spends more than 2× its estimated budget.
- Stop everything if any oracle control fails.
- **Environment-fault rule** (`stats.mjs envFaultCheck`; report.mjs prints it per arm):
  - **Denominator:** the stream's planned tasks (24).
  - **Fault codes:** the codes `stream.mjs` retries once and then records in `faults.jsonl` (`experiments/lib/runner.mjs`
    `ENV_FAULTS`): `MODEL_RATE_LIMIT`, `MODEL_UNAVAILABLE`, `SANDBOX_UNAVAILABLE`, `EXECUTOR_LAUNCH`, `EXECUTOR_PROTOCOL`.
  - **Fault event:** one `faults.jsonl` line, a fault that survived its one in-place retry. `fault-retry` events, which
    recovered on the retry, are transient and reported only.
  - **Env-impaired task:**
    - **unresolved:** a planned task with no result row after every resume that has a fault line, or, for a JIT arm,
      every task after the fault that stopped the stream;
    - **degraded:** a row whose shadow or adjudicator faulted (`shadow-fault`, `adjudicator-fault`), so the verification
      the config schedules did not happen.
  - **Rule:** an arm whose env-impaired tasks **exceed 25%** of its planned tasks in a stream (7 or more of 24) is "invalid:
    env faults" in that stream, and every comparison with it fails V.
  - **A fault a resume later resolved is not an impaired task.** Faults are never outcomes, and the resumed task runs from
    the persisted state. Fault events are still reported, and the arm is marked "stressed" when they exceed 25% of planned
    tasks.
  - This is distinct from PREREG-dev §5's stall rule in `runner.mjs`, which stops a run in progress.

## 7. Cost

TBD from R0 and R0-K, measured in the owner's usage. Rough: agent arms $0.11 / $0.4 / $0.5 per task × 48; JIT arms
~$5–10 per stream, plus the shadow floor if adopted (cost-neutral against every-4th in expectation). The total is roughly
$60–120, well under the $500 ask threshold.

## 8. Threats to validity

- The static arm's builder had oracle-scored probes; the JIT arms have none.
- Pseudo-labels from Haiku interpreters are noisy.
- Order: seed order within each difficulty block, identical across arms; one random order per stream, 2 in all. ROADMAP
  §4.3's ≥ 3 is not met (deviation declared in §1). Order effects are confounded with lineage and seed set.
- ρ is assumed (0.1), not measured. If it is larger, the Deff-widened CI is too narrow. The power table shows 0.3.
- The CLI's 1-hour prompt cache makes trial costs non-independent (P1 deviation 9).
- Engine drift: R0, R0-K and this run must share one engine freeze point (S0-4).

## Changelog (draft revisions; not amendments, because nothing is frozen)

- **2026-10-09, BLOCKER-SYNTHESIS rows 1 and 5** (§4 row 2, §4.1 step 4, §7 Q1; critique M1, M3, M6):
  - **Seeds** moved from 7001–7024 / 7101–7124 to 8001–8024 / 8101–8124 per family, recorded in `SEED-LEDGER.json`. This
    is insurance against Kev's 7000–7199 reservation, not a contamination fix. Test seeds ≥ 7200 are clean for every bed,
    and synth 7000–7099 is used.
  - The **second family** is named as kinetics (d4 → d5), as run in dev.
  - **§1 order rule** added: seed order within blocks, 2 random orders. The deviation from ROADMAP §4.3 is declared and
    justified by the power table.
  - **§1:** `oracle-controls.mjs` runs first.
  - **§2** gains the HANDOFF §3 config. The kinetics relTol is `TBD: row 2 Stage B`, with the prompt ±10% or README-precision
    fallback. The adoption rule is TBD (S0-6).
  - **§2:** the random shadow floor is an explicit config choice for system-view numbers (ε = 0.25 Bernoulli, or "none"
    with the consequence stated), sized by `analysis/verification-policy-sim.md`.
  - **§3:** the oracle-scored outcomes are stated to be unaffected by the shadow schedule, and system-view numbers are
    descriptive.
  - **§4** replaces "a gap under 3 points is noise" with the decision rule: the 3-point floor in every stream, exact
    McNemar, and the lineage-clustered CI. It adds both units, the power formula with its design-effect assumption, the
    power table and K.
  - **§5:** `stats.mjs` is added.
  - **§6:** the 25% env-fault rule is defined precisely.
  - **Header:** an engine freeze point field (S0-4) is added, and the claim row now points to the decision rule.
  - **Still DRAFT.** Nothing is frozen.

## Amendments
(none yet; amendments start after the freeze)
