# Pre-registration: `jit-stream-1` (DRAFT, not frozen; restated 2026-10-14)

*Draft written 2026-10-08 while JIT v0 was being built, and revised 2026-10-09 after BLOCKER-SYNTHESIS row 1 (the analysis
instrument) and row 5 (the verification-policy simulator). **Restated 2026-10-14, before any freeze (§0):** the H1 cost
claim against the Haiku agent is withdrawn for both families on the M2 evidence, and the primary hypotheses are replaced.
Fields marked **TBD** are fixed after the R0 and R0-K rehearsals (BLOCKER-SYNTHESIS §4.1 steps 3–4) and before the first
held-out task runs; §0.5 lists the ones already resolved and §0.6 the ones still open. At freeze, the commit SHA goes in the
table, and later edits go only in Amendments. This document makes no comparative claim.*

| Field | Value |
|---|---|
| Experiment id | `jit-stream-1` |
| Claim tested | **Restated 2026-10-14 (§0.3).** Three primary hypotheses, tested in the fixed order H1-C → H1-R → H1-K, each without access to any oracle: **H1-C**, on records the JIT S→H arm's steady-state $ per task is lower than the Opus 5.5 agent's on the same tasks; **H1-R**, on records the JIT S→H arm delivers more oracle-verified successes than the Haiku 5.5 agent; **H1-K**, on kinetics the JIT O→H arm delivers more oracle-verified successes than the Haiku 5.5 agent (it enters only under the §0.3 R0-K condition). Each is supported or falsified only by its §4 rule; anything else is reported as "directional, no decision". *Withdrawn for both families (§0.1), kept here for the record:* ~~"On a stream of 24 recurring tasks with a mid-stream difficulty shift, a JIT that interprets with an agent, compiles from traces into code with Haiku 5.5, and guards/deopts/shadows delivers at least as many oracle-verified successes as a Haiku 5.5 agent run on every task, at a lower total cost per success."~~ |
| Evidence class | `sealed`-style held-out: fresh test seeds nobody has inspected. The beds are not sealed beds, so the claim is "held-out seeds", not "held-out family" |
| Engine freeze point | **Proposed (§0.5): E1c**, the kit R0-K runs on: commit `ba0eb22b9158f0c6566c54dffd3cd546cc40a32c` (branch `kit-e1c-20261014`), construction-kit hash `852ebdf05588de97`, policy hash `cfe79728f185334b3f352cd77daa4ad6f732cfb810af9bde91a50369456bc297`, `experiments/jit` tree `3e485b50e0b5f7a7b8abbe03d1585b44a0f478f6` (ENGINE-FREEZE §6). Confirmed by G1 at freeze. R0 records ran on E1, not E1c, so "shared by R0, R0-K and this run" does not hold (deviation, §0.5) |
| Pre-registration commit | TBD at freeze |
| Date | TBD at freeze |

## 0. Restatement before the freeze (2026-10-14)

*Inputs: M2 ([analysis/verify-economics/REPORT.md](analysis/verify-economics/REPORT.md) with its appended adversarial
verification, "confirmed with caveats"), M9 ([analysis/cusum/REPORT.md](analysis/cusum/REPORT.md)), DEV-NOTES D25–D29,
ENGINE-FREEZE §6, ATTACK-20261014 §3–§5. Numbers tagged **[M]** were computed for this section at $0 from the committed dev
exports (`runs/jit-dev-records-1`, `jit-dev-kinetics-1`, `jit-r0-records`) with `experiments/jit/stats.mjs`; the scratch
scripts are not committed, and DEV-NOTES D30 records the method. Everything here is development evidence at K = 1.
**R0-K was running while this was written** (at 15:11Z the Haiku agent arm had 24 rows and the O/H arm 10). Only those row
counts were looked at, and no R0-K outcome was read, so the R0-K conditions below are written blind to its results.*

### 0.1 Withdrawn: H1's cost claim against the Haiku agent, for records and kinetics

**Rule** (ATTACK §3 M2). If no (shadow tier, rate) with a rate at or above the 25% random floor beats the Haiku agent's
$ per task in steady state, the H1 cost claim against the Haiku agent is withdrawn for that family.

**Evidence** (M2; dev seeds 201–224 and R0 records 225–236; K = 1). "L1" is per post-warmup task: compiled runs, plus
deopt fallbacks to the interpreter, plus verification. "Engine as built" means shadows by the arm's own interpreter,
with adjudication of disagreements, as `stream.mjs` runs them.

| | records | kinetics |
|---|---|---|
| Haiku agent, $ per task ($ per success) | $0.1027 ($0.164); $0.1109 paired to the JIT's post-warmup seeds | $0.0876 ($0.124); $0.054–0.079 paired |
| engine as built at the floor, L1 | S→H $0.1805, O→H $0.2183 | S→H $0.2508, O→H $0.3181 |
| break-even shadow rate against the Haiku agent, engine as built | 6.0% (S→H) and 7.0% (O→H) with adjudication, 9.0% and 9.1% without; 8.0–12.1% against the paired target | never |
| L1 before any verification | $0.0575–0.0784 | $0.195–0.250, already above the agent |
| cheapest setting priced | Haiku-agent shadows, an engine change: O→H $0.0966 with Haiku adjudication, S→H $0.1008 without adjudication | the $0 exclusion-set witness, a reference-aware ceiling: $0.24–0.28 |
| 24-task stream, $ per success | best $0.29 (O→H with Haiku shadows); engine as built $0.42–0.45 | best $0.93 |

**Why.** These are mechanisms, not noise:
1. **A realizable verifier costs about one agent run.**
   - A shadow is an interpreter session: about $0.30 (Sonnet) or $0.55 (Opus) per records task.
   - The cheapest model tier is a Haiku-agent session, which costs what the Haiku agent itself costs.
   - At the 25% floor, records S→H's verification term without adjudication already brings the task to $0.1456, above
     the agent's $0.1027. Its lowest possible value, at P(disagree) = 0, is $0.128 (M2 verification).
2. **Compiled runs deopt to the interpreter.**
   - Deopts hit 10% of post-warmup tasks on records and 38–60% on kinetics.
   - So kinetics costs more than the agent before verification is priced. No kinetics version settled (D25 §4).
3. **Construction is front-loaded.**
   - Records S→H spent $4.83 on compiles. The Haiku agent's whole 24-task stream cost $2.46.
   - Kinetics compiles cost $9.6–17.1, against $2.10 for the agent's stream.
4. **The flag policy raises the shadow rate.**
   - With `shadowOnFlags: true`, R0's H→H raised a flag on 9 of 9 compiled runs, so all 9 were shadowed.
   - Its effective shadow rate was 100%, not 25%. At that rate it costs $0.1180 per task, above the agent's $0.1039.
5. **The cheap agent is good enough on these flat tasks.** It passes 62.5% (records) and 70.8% (kinetics) at $0.09–0.10
   per task.

**Qualifications** (M2's adversarial verification).
- **Kinetics level.** Kinetics is withdrawn for the engine as built at every cost level, and for every tier at L1 and L2.
  At L0 (compiled runs only, the ATTACK's level), Haiku-tier settings beat the agent at $0.043–0.080. Kinetics never
  reached the steady state that L0 assumes.
- **Records with Haiku-agent shadows.** That this setting "survives" is within noise: the margins are $0.006 and $0.002
  on K = 1 data, and it is an engine change. Keeping the Haiku shadow's own wrong answers, a perfect comparator gives
  S→H $0.1102 (a loss) and O→H $0.0922.
- **The H→H negative control** beats the agent at the floor (dev $0.0788, R0 $0.0438). It loses at L2 and at R0's
  realized 100% rate, and 8 of its 16 dev compiled deliveries were wrong.
- **The withdrawal rests on the cost structure above, not on a test.** At K = 2 even the negative is undecidable: the
  projected 95% CI of the 24-task cost-per-success ratio, S→H against the Haiku agent, is 0.55–7.3 at ρ 0.1 [M].

### 0.2 What the evidence still supports, and what K = 2 can decide

**Success power.**
- Computed with `stats.mjs` `pairedPower` at the dev pass rates, with pRef the mean of the two arms' rates, K = 2 and m = 24.
- The rule's C check widens the CI with **ρ = 0.1 whatever the true ρ is** (`pairedComparison` uses `RHO_PREREG`). The
  ρ = 0.1 figure is therefore the rule's working power. The ρ = 0 figure is shown for scale only.

**Cost CIs.**
- A task bootstrap on the dev rows (20,000 draws), scaled to K = 2 by 1/√2 and widened by √Deff (3.3 at ρ = 0.1) [M].
- This is an approximation. With two lineages, between-lineage variance in compile spend is not observable.

| candidate | dev evidence (K = 1) | K = 2: power, or projected 95% CI of the ratio | verdict |
|---|---|---|---|
| records S→H vs Haiku agent, verified successes | 22 vs 15 (+29.2 pts); discordant 8/1, exact McNemar p 0.039 | power 41% (ρ 0.1), 93% (ρ 0); 80% needs ρ ≤ 0.02; K = 4 gives 52% | **H1-R**: primary, power declared |
| records O→H vs Haiku agent, successes | 18 vs 15 (+12.5); 5/2 | 5% (ρ 0.1), 15% (ρ 0) | secondary |
| records S→H vs Sonnet agent, successes | 22 vs 13 (+37.5); 10/1, p 0.012 | 64% (ρ 0.1), 99% (ρ 0); 80% needs ρ ≤ 0.06 | secondary (directional) |
| records S→H vs Opus agent, successes | 22 vs 24 (−8.3); 0/2 | 10% (ρ 0.1) | secondary; undecidable |
| kinetics O→H vs Haiku agent, successes | 17 vs 13 on 19 paired tasks (+21.1; 4/0, p 0.125); the arm was truncated | 20% (ρ 0.1), 66% (ρ 0) | **H1-K**, only under the §0.3 condition |
| records 24-task $ per success, S→H vs Sonnet / Opus agent | ratios 0.75 / 0.72, as run | 0.19–1.92 / 0.22–1.69 (ρ 0.1); 0.35–1.26 / 0.37–1.16 (ρ 0) | **not decidable**: compile spend arrives in lumps. Secondary |
| records steady-state $ per task (idx ≥ 3, compile spend excluded), S→H vs Opus agent | $0.1644 vs $0.5782, ratio 0.28, as run. M2: 0.32 at the floor, 0.86 at a 100% shadow rate ($0.4871 against $0.5643) | 0.12–0.52 (ρ 0.1): about 98% power at the dev ratio | **H1-C**: primary. Decidable while the effective shadow rate stays at or below about 39% |
| same, O→H vs Opus agent | ratio 0.33 | 0.07–0.70 | secondary |
| same, S→H vs Sonnet agent | ratio 0.55; break-even shadow rate 52.7% (M2) | 0.23–0.99 (ρ 0.1) | secondary (borderline) |
| engine-change arm (Haiku-agent shadows, oracle-threshold records comparator) vs Haiku agent, steady state | O→H $0.0966 vs $0.1027: a 6% margin, 13% against the paired target. Over 24 tasks, $0.29 vs $0.164 per success | a 6–13% reduction lies far inside the K = 2 CI (as-built S→H vs the Haiku agent in steady state: 0.58–3.18 at ρ 0.1) | out of scope: needs its own pre-registration (§0.4) |

**H1-C's power figure** [M, approximate]:
- The log-ratio SE is 0.31 at K = 2 and ρ 0.1.
- 80% power needs a true ratio ≤ 0.42.
- On M2's dev slope, S→H's L1 cost is $0.0784 + $0.4087 × r at shadow rate r. That keeps the ratio ≤ 0.42 up to an
  effective rate of about 39–40%.
- Above that, H1-C's likely verdict is "directional, no decision".

**Reading.**
- At K = 2, under the rule as written, no success comparison reaches 80% power at its dev gap. The power table decides
  only gaps of at least about 39–41 points at ρ = 0.1.
- Cost per verified success over 24 tasks is not decidable against any agent, because compile spend arrives as a few
  large lumps per lineage.
- The decidable quantity is the marginal (steady-state) cost against a frontier agent, as long as the flag policy does
  not push the effective shadow rate toward 100%.
- The primaries below follow from this. The arm and family were chosen on the same dev data, so expect smaller held-out
  effects (§8).

### 0.3 Replacement primary hypotheses

**H1-C (records; cost; the decidable primary).**
- **Arms.** `jit:claude-sonnet-5-5/claude-haiku-5-5` (S→H) against `agent:claude-opus-5-5`, streams A and B.
- **Quantity.** Each stream's steady-state $ per task is computed over tasks idx 3–23 (21 tasks; warmup is 3):
  - The JIT side is each row's `costUsd` minus its compile spend. Compile spend is every `costBreakdown` entry whose key
    starts with `compile`, except `compiled`.
  - That leaves compiled runs, interpreter deopt fallbacks, shadows and adjudications.
  - The agent side is `costUsd` on the same tasks.
  - The pooled ratio is the sum on the JIT side over the sum on the agent side, across both streams.
- **Rule CR (cost).**
  - V and K as in the §4 decision rule.
  - Every stream's ratio is below 1.
  - The 95% CI of the pooled log ratio lies below 0. The CI is the wider of two: a two-stage cluster bootstrap (streams,
    then tasks), and the paired-task bootstrap widened by √Deff (ρ = 0.1, m = 21, Deff 3.0).
  - Otherwise the result is "directional, no decision".
  - Rule CR needs code before the freeze (§0.6).
- **Always reported beside it:**
  - warmup and compile spend;
  - both arms' 24-task cost per verified success;
  - the payback horizon against each agent;
  - the realized effective shadow rate;
  - the success comparison with the Opus agent (directional; dev 22 vs 24).
- **What it claims.** Once compiled, a records task costs less than an Opus-agent run. It is a marginal-cost claim, not a
  whole-stream claim, and not a claim made at success parity.

**H1-R (records; reliability against the cheap agent; underpowered primary).**
- **Arms.** S→H against `agent:claude-haiku-5-5`.
- **Quantity.** Oracle-verified successes out of 24 per stream, counting every delivery, interpreter warmup and
  fallbacks included.
- **Rule.** The §4 decision rule, unchanged.
- **Declared power.**
  - 41% at the dev gap of +29.2 points.
  - The expected verdict is "directional, no decision" unless the held-out gap reaches about 40 points.
- **Why it stays primary.** After the withdrawal, it is the capability number against the simple baseline.
- **Reported with it.** The 24-task cost-per-success ratio against the Haiku agent (dev 2.49), as the price of that
  reliability.

**H1-K (kinetics; reliability; conditional).**
- **Arms.** `jit:claude-opus-5-5/claude-haiku-5-5` (O→H) against the Haiku agent; the rule is the same as H1-R's.
- **Admission.** The condition is written now, blind to R0-K's outcomes. It is decided from R0-K's rows once R0-K ends.
  H1-K enters the sequence only if all three hold:
  1. neither R0-K arm is "invalid: env faults";
  2. there are at least 20 paired tasks;
  3. the paired gap, O/H minus the Haiku agent, is at least +39 points (the K = 2 MDE at ρ 0.1 and pRef 0.8).
- **If it is not admitted.**
  - The kinetics JIT arms are dropped from `jit-stream-1`.
  - Kinetics stays a dev and R0-K negative on cost, with a directional reading on reliability.
- **If it is admitted**, kinetics runs O→H and the Haiku agent only. The kinetics S→H and H→H arms are dropped:
  - on the tasks they completed, they passed 7/13 and 8/12, against 10/13 and 9/12 for the Haiku agent;
  - they cost 7–10× the agent's spend.

**Order and error control.**
- Fixed sequence: H1-C, then H1-R, then H1-K if admitted.
- Each is tested at α = 0.05 under its own rule.
- Testing stops at the first "directional, no decision". Every later hypothesis is then reported as directional only.
- This keeps the family-wise error rate at or below 0.05. The order puts the best-powered hypothesis first.

**Secondary** (reported, never decided):
- the withdrawn H1 quantities against the Haiku agent (successes and 24-task cost per success), so the withdrawal can be
  audited;
- the 24-task cost per verified success against every agent;
- steady-state cost and success against the Sonnet agent;
- O→H against every agent;
- H→H, the negative control and the owner's literal question;
- the static arm;
- the effective shadow rate: flagged plus floor-drawn shadows over compiled-ok deliveries, per arm and stream;
- the §3 secondary and system-view measures;
- latency p50 and p95 per task (PROOF-LEDGER K17);
- $ + W × silent misses, if the owner declares W (K11).

### 0.4 The engine-change arm needs its own pre-registration

**What it is.** S→H or O→H with three changes:
- shadows by a Haiku agent instead of the arm's interpreter;
- adjudication by a second Haiku session;
- a records comparator at the oracle's own thresholds (fieldAccuracy ≥ 0.97, pairF1 ≥ 0.95, entity slack 0.02),
  instead of exact `'unordered'`.

This is the cheaper comparator M2 §12 names.

**Why it is not in `jit-stream-1`.**
1. **It changes the engine.** It changes `stream.mjs` and the arm definition. That means a new `experiments/jit` tree, a
   new arm hash, an engine stamp, and a rehearsal of its own.
2. **Its cost hypothesis cannot be decided at K = 2.**
   - It is a 6–13% steady-state margin over the Haiku agent.
   - ROADMAP §4.3 puts a ≥ 30% reduction at 23–89 paired tasks. A reduction of about 10% needs roughly 9× that [I].
3. **It still loses over 24 tasks**: $0.29 against $0.164 per success.

**Payback horizon** [M, approximate]. From M2's tables, at L1, assuming no recompiles after the measured ones and the dev
success rates:

| setting | per task | per verified success |
|---|---|---|
| Haiku-tier settings | about 170–2,750 tasks of one shape | about 95–155 tasks |
| engine as built | never | never |

The per-success horizon is finite only because S→H and O→H pass more often than the Haiku agent. So the cost value would
come from the reliability gap, which H1-R tests.

**What its own pre-registration must fix:**
- the $0 pricing of the comparator change on the archived rows, with false alarms split into comparator-driven ones and
  wrong shadows (M2 verification, finding 3);
- a long stream of one shape, at least as long as the payback horizon priced from the arm's own numbers;
- the Haiku shadow's detection rate (67–100% on records) and false-alarm rate (42–63%), and what they do to the
  system-view bound;
- the random floor and the system-view miss bound;
- success non-inferiority against the Haiku agent;
- a seed range reserved in SEED-LEDGER.

### 0.5 TBDs resolved by R0, R0-K and M2 (with E1c and M9)

| field (section) | status | value | source |
|---|---|---|---|
| Engine freeze point (header) | resolved for R0-K; **proposed** for this run | E1c, `ba0eb22`: kit `852ebdf05588de97`; policy `cfe79728…bc297` (`policyVersion` 2026-10-09.1); `src` tree `dc710129c998136cb449e1440a429a640f4bd53b`; `experiments/jit` tree `3e485b50…`, with `flow-v2.mjs` sha256 `5dde4666…5223`; `experiments/lib` tree `6c414274…`; Node v24.21.0; claude CLI 2.1.299; sessions run as uid 65534 on a root host. Every run of this experiment runs from the E1c tree, not from the branch HEAD, whose `experiments/jit` tree has moved (`14f9ab8a…` at `04af9af`) | ENGINE-FREEZE §6 |
| "Shared by R0, R0-K and this run" (header) | **deviation** | R0 records ran on E1 (kit `a572eeee1ac237aa`, laptop, CLI 2.1.295). On a non-root host the argv is byte-identical; the arm hashes and the JIT tree are equal. R0 is a rehearsal and contributes no evidence, so the claim is unaffected, but the header's wording was wrong | ENGINE-FREEZE §6, "Comparability" |
| Bed hashes (§1) | resolved; confirmed at freeze | records 3.0.0: `beds/records/index.mjs` sha256 `951ea4172b04b593969f8306e18767fdd23481d9dfa1e1b3b8778666e237a04d`, tree `daaf97cbc9b6040d83de8e92f63c016926c49e70`. kinetics 4.0.0 (`world.mjs` VERSION): `beds/kinetics/index.mjs` sha256 `5927b7679c8d90e3db1fb5b135524e45dc3b9d7de4755d34a1b85860ba743698`, tree `6e8d722bc8d9c766b7290a9a31f8ef88e1c4990e`. Identical at E1c and at `04af9af`. M2 re-scored 189 of 189 archived answers to identical oracle details | `git rev-parse`, `sha256sum`; M2 §0 |
| kinetics `relTol` (§2) | resolved | **0.05**, absTol 1e-9, tolerantKeys `['vmax','km']`, exclusion list compared exactly. Basis: Stage B (0 of 15 correct–correct pairs disagree; 13 of 13 wrong answers differ in the exclusion set) and D25 §3 (4 of 4 rebuilt shadows decided; 7 more correct–correct pairs within 0.65%). Adopted by O1 under the orchestrator's delegation (ATTACK §5 decision 5; the scope of the delegation is [U]). **Deviation:** §2 required the fallback to be written down before row 2's results were read; that was not done, so 0.05 is dev-calibrated, not a pre-committed fallback | D23, D25 §3, ENGINE-FREEZE §5 |
| Exclusion-set witness (bears on the kinetics comparator) | measured | The set differs in 6 of 6 wrong compiled deliveries, but in only 24 of 28 wrong answers overall (85.7%). The misses are interpreter answers with the right set and wrong numbers, including the s212 common-mode shadow and adjudicator pair. A same-set wrong shadow can therefore agree with a compiled answer at relTol 0.05 | M2 §8 |
| Adoption rule (§2) | resolved for R0-K; carried over | **Any usable version is adopted** (no `adoptRequiresAcceptance`), as in R0-K. A requires-acceptance arm, with its own hash, may enter only after R0-K's BLOCKER-SYNTHESIS rows 10–11 are read | ATTACK §5 decision 5 |
| Random shadow floor (§2) | resolved | `jit.shadowFloor` 0.25 as a Bernoulli draw, `shadowOnFlags: true`, propensity logged. R0 rehearsed it: draws logged, 5 of 9 below 0.25. **But the §2 premise "cost-neutral against every-4th" is false in practice**: R0 shadowed 9 of 9 compiled runs because all 9 were flagged, an effective rate of 100%. H1-C's power depends on this rate (§0.2) | M2 §3 reading 1; `r0-*.json` |
| JIT parameters (§2) | resolved | warmup 3; `recompileOnDeopts` 2 (M9: the risk-adjusted CUSUM fails its bar, so the count stays; PROOF-LEDGER K15 N); maxTraces 8; `compilerFallback` claude-opus-5-5; `maxFallbacks` 2; `preserveRefusals` true; prompt v4; acceptance `strict` (minPartial 0.9); `acceptanceIds` `exact`. Records: `jit.compare` `'unordered'`, `compile.compare` tolerant at relTol 0 and absTol 0 | `r0-records.json`, `r0-kinetics.json`; D29 |
| Agent and session budgets (§2) | resolved | `agentBudgetUsd` **$2** per agent or interpreter session (the §2 table's "$1" was stale: the dev and R0 configs all ran $2); `agentMinutes` 15; `perTaskUsd` $1; `compiledMinutes` 20; `concurrency` 2 | configs; `stream.mjs:225` at E1c |
| Env-fault rule (§6) | resolved | More than 25% impaired tasks means "invalid: env faults". R0 had no environment faults. The dev streams had 81 `MODEL_RATE_LIMIT` rows: the 23:47Z burst was resolved by resume with no task impaired, and the 04:50Z usage stop truncated the three kinetics JIT arms. Under this rule kinetics H→H (12 of 24 impaired) and S→H (11 of 24) would be invalid, and O→H (5 of 24) valid. Paid starts are therefore gated on the 5h meter ≤ 0.60 and the 7d meter ≤ 0.80 | D24, D25 §5; ATTACK §4.1 |
| G4 and cost imputation (R0-RUNBOOK §4) | resolved | E1c G4 PASS: one sandboxed Haiku `interpret`, $0.0402, `costUnknown` false, no `EXECUTOR_PROTOCOL` (the uid fix in `756d6de`) | ENGINE-FREEZE §6 |
| Spend caps (R0-RUNBOOK §4) | resolved for R0-K; **proposed** for this run | R0-K: O/H $32, agent $5, `spendStopUsd` $40. Proposed per stream (dev $ × 1.5): S→H $13.5, Opus agent $20.3, Haiku agent $3.7, Sonnet agent $10.6, O→H $11.3, H→H $12.2, static $1.8. Kinetics O→H: R0-K's actual × 1.5, if H1-K is admitted. At a 100% shadow rate, records S→H's 24-task total rises from $9.33 to $15.76 (M2 §5), above the proposed cap | R0-RUNBOOK §4; D25 |
| Cost (§7) | resolved from dev | see §7 | D25; M2 |
| Analysis scripts (§5) | candidate; **re-hash at freeze** | `report.mjs` `ff586a40473e4e3559916262afea0519f5eea140be4b978a539d443d8bf76106`, `stats.mjs` `53653ccc6f14180c3537a07e767f18e6ee265b5719081317658726bff47347b9`, `durability.mjs` `527ee6e117321fd46615463a84f1dd6728c95229c770470d7b3e04e46cafa5b3`; equal at E1c and at `04af9af`. `stats.mjs` changes when rule CR lands | `sha256sum` |
| K (§4) | resolved | K = 2 (ATTACK §4; the power table) | §4 |
| H1 cost claim against the Haiku agent | resolved: withdrawn | §0.1 | M2, D27 |

### 0.6 Still open

1. **Freeze inputs.** Still to set at freeze:
   - the freeze commit and date;
   - the held-out configs: records, plus kinetics only if H1-K is admitted;
   - their test-split arm hashes, which differ from the dev and R0 hashes because the arm hash covers the split;
   - the SEED-LEDGER check of 8001–8024 and 8101–8124;
   - a G1–G6 re-run on E1c.
2. **Rule CR in code.** `decideCost` in `stats.mjs`, with the steady-state definition from §0.3, the two-stage cluster
   bootstrap and the Deff widening, plus a test. Then re-hash `stats.mjs`.
3. **R0-K reading** (outcomes not read for this restatement):
   - rows 10–11, acceptance predictiveness, which decides whether a requires-acceptance arm is added;
   - the realized effective shadow rate;
   - the H1-K admission condition;
   - the kinetics caps.
4. **The primary arm has never run on the frozen config.**
   - S→H's dev numbers come from the dev config: prompt v1, `shadowEvery: 4`, no strict acceptance and no flags.
   - R0 ran only H/H and the agent.
   - Recommendation: run R0 records S/H (arm `3b9dc642498f5df8`, cap $12 in `r0-records.json`) on records 225–248
     **before** the seed-ledger flip. It is the only way to measure, before the freeze, the effective shadow rate that
     H1-C's power depends on. At a high flag rate the $12 cap may stop it early.
   - Otherwise declare the primary arm unrehearsed.
5. **Seed ledger.** `jit-r0-fresh` (225–248) is still `fresh` for both beds. The per-bed split (ATTACK §5 decision 12)
   has not been done, and point 4 must be settled before records is flipped to `used`.
6. **The `shadowOnFlags` policy.**
   - Recommended: keep `true`. Flags are the verification the engine has, and H1-C is then tested at the rate actually
     realized.
   - The alternative is a cap on flag-forced shadows. That is a config change: a new arm hash, decided before the freeze.
7. **Unmeasured or undeclared inputs:**
   - ρ (0.1 is assumed, never measured);
   - W, the cost of a wrong delivery (K11);
   - the latency budget (K17).
8. **Which secondary arms run** (a budget decision, §7). The minimum set for H1-C and H1-R is S→H, the Opus agent and the
   Haiku agent.
9. **Owner confirmation of this restatement.** The orchestrator's delegation is recorded only second-hand (ATTACK §5,
   "Authority").
10. **The engine-change arm's own pre-registration** (§0.4).

## 1. Beds, splits, seeds and order

**Beds.**
- `records` 3.0.0: `beds/records/index.mjs` sha256 `951ea417…a04d`, tree `daaf97cb…`.
- `kinetics` 4.0.0: `beds/kinetics/index.mjs` sha256 `5927b767…3698`, tree `6e8d722b…`. It is the family of the dev run
  `jit-dev-kinetics-1`, and it runs only if H1-K is admitted (§0.3).
- Full values are in §0.5; they are confirmed at freeze.

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

| arm | definition | models | role (restated 2026-10-14, §0.3) |
|---|---|---|---|
| agent-haiku | Claude Code agent on every task ($2 session budget, 15 min; §0.5) | claude-haiku-5-5 | H1-R comparator (records); H1-K comparator (kinetics, if admitted) |
| agent-sonnet | same | claude-sonnet-5-5 | secondary |
| agent-opus | same | claude-opus-5-5 | H1-C comparator (records) |
| static | the C0 B1-haiku solver for the family; deopt or crash falls back to the Haiku agent | claude-haiku-5-5 | secondary (records only; kinetics has no static solver) |
| jit-H/H | interpreter Haiku, compiler Haiku (Opus fallback once); negative control | haiku (opus on fallback) | secondary, negative control (records) |
| jit-S/H | interpreter Sonnet, compiler Haiku | sonnet, haiku | **primary JIT arm** for H1-C and H1-R (records) |
| jit-O/H | interpreter Opus, compiler Haiku | opus, haiku | H1-K (kinetics, if admitted); secondary on records |

**JIT parameters** (SPEC §6.1). Resolved values (§0.5): warmup 3, recompileOnDeopts 2 (kept after M9), maxTraces 8,
compilerFallback Opus, maxFallbacks 2. The shadow schedule is set below.

**Configuration** (HANDOFF §3, rehearsed by R0 and R0-K before the freeze):

| setting | records | kinetics |
|---|---|---|
| `jit.compare` | `'unordered'` | `'tolerant'`: relTol **0.05** (resolved, §0.5; from BLOCKER-SYNTHESIS row 2, Stage B), absTol 1e-9, tolerantKeys `['vmax','km']`, exclusion list exact |
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
- **Resolved 2026-10-14 (§0.5): relTol 0.05 by O1.** Deviation: the fallback was not written down before Stage B was
  read.

**Adoption rule.** Can a version with `accepted: false` be adopted (`stream.mjs:554`)? This was TBD, to be decided with
step-0 acceptance hardening (S0-6) and written here.
- **Resolved 2026-10-14 (§0.5): any usable version is adopted**, as in R0-K.
- A requires-acceptance arm, with its own hash, enters only after R0-K's rows 10–11 are read.

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
- **Resolved 2026-10-14 (§0.5): ε = 0.25 with `shadowOnFlags: true`**, as rehearsed by R0.
  - The cost-neutrality premise above did not hold in R0: every compiled run was flagged, so the effective rate was
    100%.
  - The effective rate is reported per arm and stream, and H1-C is read at that rate (§0.2).
  - M2 §6: at 24 tasks the system-view bound is 39–62% even with 0 detected, so it stays descriptive.

## 3. Measurements

**Primary** (restated 2026-10-14; the definitions are in §0.3):
- H1-C: steady-state $ per task over idx 3–23, compile spend excluded, S→H against the Opus agent (records);
- H1-R and H1-K: oracle-verified successes out of 24 per stream (records S→H against the Haiku agent; kinetics O→H
  against the Haiku agent, if admitted).

**Reported with every primary:**
- cost per success, where cost is every dollar: interpretations, compiles, shadows, adjudications, compiled runs and
  fallbacks;
- the effective shadow rate.

Until 2026-10-14, cost per success against the Haiku agent was a primary; it is now a reported secondary (§0.1).

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

**The restated primaries (2026-10-14, §0.2–§0.3).**
- **Which rule applies.**
  - The decision rule above decides H1-R and H1-K.
  - Rule CR (§0.3) decides H1-C. It is the same V and K checks, every stream in the claimed direction, and a
    lineage-clustered CI of the pooled log cost ratio that excludes 0.
- **Power at the dev effects.**
  - H1-R: 41%.
  - H1-K: 20% at its dev gap. It is admitted only at a gap of at least 39 points.
  - H1-C: about 98% at the dev ratio, and at least 80% while the effective shadow rate stays at or below about 39%.
- **Where the working power comes from.**
  - The rule's C check fixes ρ = 0.1, so the ρ = 0.1 column above is the rule's working power whatever the true ρ is.
  - Lowering ρ after seeing data is not allowed; ρ changes only by amendment, from a measurement.
- **Order.** Fixed sequence H1-C → H1-R → H1-K at α = 0.05 each. Testing stops at the first "directional, no decision".

## 5. Analysis

- `experiments/jit/report.mjs` (sha256 TBD): per stream, both units, the env-fault table, and per-pair McNemar and CI
  labelled "directional, no decision (one stream)".
- `experiments/jit/stats.mjs` (sha256 TBD): `decide` over the K streams, plus the power table.
- `experiments/jit/durability.mjs` (sha256 TBD): oracle-view and system-view durability.
- The analysis-script hashes are recorded at freeze. Candidate values at E1c are in §0.5. `stats.mjs` changes when rule
  CR (`decideCost`) lands, so it is re-hashed then.
- `experiments/jit/verify-economics.mjs` (M2) re-prices each arm at the realized shadow rate. It is descriptive only and
  decides nothing.

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

*Before 2026-10-14:* TBD from R0 and R0-K, measured in the owner's usage. Rough: agent arms $0.11 / $0.4 / $0.5 per task
× 48; JIT arms ~$5–10 per stream, plus the shadow floor if adopted (cost-neutral against every-4th in expectation). The
total is roughly $60–120, well under the $500 ask threshold.

**Resolved from the measured dev streams (2026-10-14; D25, M2; list price).**

Per-stream totals, records:

| arm | $ per stream |
|---|---|
| Opus agent | 13.54 |
| S→H | 8.99 |
| H→H | 8.12 |
| O→H | 7.53 |
| Sonnet agent | 7.05 |
| Haiku agent | 2.46 |
| static | 1.21 |
| all seven | 48.90 |

Per-stream totals, kinetics:

| arm | $ per stream |
|---|---|
| O→H | about 27.8, extrapolated from $21.99 for 19 tasks (R0-K measures it) |
| Haiku agent | 2.10 |

Estimates for `jit-stream-1` at K = 2:

| what runs | estimate |
|---|---|
| minimum set for H1-C and H1-R (S→H, Opus agent, Haiku agent; records) | about $50 |
| all records arms | about $98 |
| kinetics, if H1-K is admitted | about $60 more |

**What moves these figures:**
- They assume the dev shadow rate. At a 100% effective rate, records S→H costs about $6.4 more per stream (M2 §5).
- The CLI's 1-hour prompt cache and the shared quota meter make list price an imperfect proxy (ATTACK §1.4).
- Every option stays under the $500 ask threshold.

## 8. Threats to validity

- The static arm's builder had oracle-scored probes; the JIT arms have none.
- Pseudo-labels from Haiku interpreters are noisy.
- Order: seed order within each difficulty block, identical across arms; one random order per stream, 2 in all. ROADMAP
  §4.3's ≥ 3 is not met (deviation declared in §1). Order effects are confounded with lineage and seed set.
- ρ is assumed (0.1), not measured. If it is larger, the Deff-widened CI is too narrow. The power table shows 0.3.
- The CLI's 1-hour prompt cache makes trial costs non-independent (P1 deviation 9).
- Engine drift: R0, R0-K and this run must share one engine freeze point (S0-4).
  - They do not fully: R0 ran on E1, R0-K on E1c (§0.5).
  - This run is proposed on E1c, from the E1c tree, not the branch HEAD.
- **Added 2026-10-14:**
  - **The dev configuration differs from the frozen one.** The dev effect sizes behind §0.2 come from:
    - prompt v1;
    - `shadowEvery: 4`;
    - no strict acceptance;
    - no flag shadows;
    - exact comparison on both families.

    The frozen configuration is R0's: prompt v4, strict acceptance, the floor plus `shadowOnFlags`, and the tolerant
    comparator on kinetics. S→H has never run on it (§0.6 item 4).
  - **Winner's curse.** S→H and records were chosen as primary on the same dev data that supplies their effect sizes,
    out of three JIT arms and two families. Expect smaller held-out gaps than 29 points and ratios above 0.28.
  - **H1-C depends on the flag rate.** If flags force near-100% shadowing, the steady-state ratio against the Opus agent
    rises to about 0.86, and H1-C becomes undecidable (§0.2).
  - **Cost CIs understate lineage variance.** With K = 2 the cluster bootstrap cannot see between-lineage variance in
    compile and recompile spend. The ρ = 0.1 widening is an assumption for cost as well as for success.
  - **H1-C is a marginal-cost claim.** It excludes compile spend by definition. The 24-task cost per success, which
    includes compile spend, is reported beside it and decides nothing.

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
- **2026-10-14, restatement before any freeze** (ATTACK-20261014 §3 M2 rule; DEV-NOTES D27 and D30):
  - **Withdrawn.** H1's cost claim against the Haiku agent, for records and kinetics (§0.1, with the M2 numbers and why).
    The original claim text is kept, struck through, in the header.
  - **New §0.2.** What K = 2 can decide [M]:
    - no success comparison reaches 80% power at its dev gap under the rule's fixed ρ = 0.1;
    - 24-task cost per success is not decidable against any agent;
    - the steady-state cost against the Opus agent is decidable.
  - **New §0.3.** The primaries are now H1-C (steady-state cost, S→H against the Opus agent, rule CR), H1-R (verified
    successes, S→H against the Haiku agent; declared power 41%) and H1-K (kinetics O→H against the Haiku agent, admitted
    only by a condition written blind to R0-K's outcomes). They are tested in a fixed sequence. Arm roles are added to §2.
  - **New §0.4.** The engine-change arm (Haiku-agent shadows plus the oracle-threshold records comparator) is moved to its
    own future pre-registration.
  - **New §0.5.** The TBDs that R0, R0-K, M2, E1c and M9 resolved, with values:
    - engine (proposed E1c);
    - beds;
    - relTol;
    - adoption;
    - shadow floor;
    - JIT parameters;
    - budgets;
    - env-fault rule;
    - G4;
    - caps;
    - cost;
    - candidate analysis hashes;
    - K.

    Two deviations are recorded: R0 ran on E1, not E1c, and the relTol fallback was never pre-written.
  - **New §0.6.** What is still open.
  - **Edited:** §1, §2, §3, §4, §5, §7 and §8 to match.
  - **Still DRAFT.** Nothing is frozen, no arm hash is computed for the test split, and R0-K's outcomes were not read.

## Amendments
(none yet; amendments start after the freeze)
