# Pre-registration: W-bed ladder slice 1 (`wbed-s1`): R1, then R3 (DRAFT, not frozen)

*Draft written 2026-10-14 (about 16:00–17:00 UTC) on branch `claude/intelligent-hamilton-vg1f9a` at `93b27ec`. **$0**: no model
call of any kind (no `claude` CLI, no Jev, no paid stream), `beds/sealed/` not read, no credential read. Inputs:
ATTACK-20261014 §0, §3 (M1, M2, M10), §4, §5; PROOF-LEDGER §B and §K; design/W-BED.md (all); design/FLOW-V3.md;
design/FLOW-V3-SLICE2.md (§1–§17); PAUSE-20261009 §4–§6; SEED-LEDGER.json; ENGINE-FREEZE §5–§6; PREREG-stream §0;
analysis/verify-economics/REPORT.md (at `722c4f0`); DEV-NOTES D22, D25, D27, D30. Paths are relative to the repository root.
Every number tagged **[M]** was computed for this draft at $0 by the scratch scripts listed in Appendix B (not committed).
Tags: **[M]** measured here; **[code]** read in code; **[doc]** a claim made by a repo document; **[I]** inference; **[U]**
unverified.*

*This is the first paid slice of the W-bed ladder (ATTACK §4.2 days 4–7; W-BED §8–§9). It is a draft: fields marked
**TBD** are listed in §13 with what resolves each. There are two freeze points. **F1** freezes §2 (seeds), §4 (the paid
pre-steps and their rules) and the pre-step caps of §10, before the first pre-step spends anything. **F2** freezes the rest,
with the E2 record of §8, before the first held-out task runs. After a freeze, changes go only in Amendments. This document
makes no comparative claim.*

| Field | Value |
|---|---|
| Experiment id | `wbed-s1` (configs `wbed-s1-r1-a`, `wbed-s1-r1-b`; `wbed-s1-r3-a`, `wbed-s1-r3-b` if R3 runs) |
| Claim tested | Per rung r ∈ {R1, R3}, three steady-state cost ratios are **decided** (§7.1): CR1 (a) JIT H/H against (d) the Haiku agent; CR2 (a) against (c) the frozen reference workflow; CR3 (e) Haiku-built-once against (a). Success comparisons are **reported directionally** (§7.3): at K = 2 the decision rule's minimum detectable effect is 39 points at ρ = 0.1. Rung kill rules (§9) are programme switches, not claims |
| Evidence class | Held-out **seeds** of synthetic, Claude-written beds (W-BED O10): not a held-out family, not a sealed bed |
| Rungs | R1 "ledger close" (`wbed-r1` 1.0.0); R3 "statement audit" (`wbed-r3` 1.0.0) only under the §9.2 gate |
| Arms | (a) `jit:claude-haiku-5-5/claude-haiku-5-5`; (e) a Haiku-built-once B1 script as a `static:` arm; (c) the frozen reference workflow as a `static:` arm; (d) `agent:claude-haiku-5-5` |
| K | 2 lineages (streams A and B), 24 tasks each |
| Engine freeze point | **E2, TBD** (§8). Not stampable today: the static-arm SDK gap of §8.1 is a blocker for arm (c) |
| Freeze commits | F1 TBD; F2 TBD |
| Date | TBD at F2 |

## 0. Summary

- **What runs.** R1 at K = 2: arms (a) H/H, (e), (c) and (d) on held-out seeds 8201–8224 (stream A) and 8301–8324
  (stream B), 16 tasks at d3 then 8 at d4 (W-BED §2.5, §5). R3 runs only if R1 yields an accepted H/H solver in **both**
  lineages, the weekly envelope covers R3's caps, and the quota gates hold (§9.2).
- **Paid pre-steps** (§4), each with its own rule: P0 the triviality/necessity attack (PROOF-LEDGER B11) with an R0
  positive control; P1 the paid validation and freeze of the references; P2 the (e) builds; P3 the E2 stamp with G1–G6;
  P4 a capped dev smoke on E2. No held-out seed is touched before F2.
- **What is decided.** Three steady-state cost ratios per rung under rule CR-W (§7.1): the structure of `stats.mjs`
  `DECISION_RULE` (validity, K ≥ 2, direction in every stream, a CI that excludes 0) applied to log cost ratios, with
  Bonferroni over the three (98.33% CIs). A planning projection from R0 records gives a K = 2 standard error of 0.197 on
  the log ratio, so ratios beyond about 0.53 or 1.89 are decidable at 80% power [M, approximate]. **Construction cost is
  not decidable by any test at K = 2** (one lump per lineage). This corrects M10 / PROOF-LEDGER K7 ("construction cost
  ratio, which is decidable"); it is read by a declared dominance rule instead (§7.2).
- **What is directional.** Every success comparison, including W-BED H1 (non-inferiority to the reference at δ = 10). The
  rule is computed and printed, and power is declared (§7.3).
- **A blocker found at $0.** A `static:` arm runs its script on `flow.mjs` v1, because only `JitRun` defines `flowPath`
  (`experiments/jit/stream.mjs:855`, `:891`) [code]. The R1 reference crashes there with `TypeError: flow.phase is not a
  function`, and runs `ok` on flow-v3 (stub gateway, dev seed 325) [M]. In a stream, every (c) task would crash and fall
  back to the Haiku interpreter, so arm (c) would silently become a second Haiku agent. E2 must include a static-arm SDK
  option before anything is stamped (§8.1, TBD T2).
- **Shadow floor** (§5, citing M2): `shadowFloor` 0.25 with `shadowOnFlags: true`, the engine as built. M2 shows that at
  24 tasks the floor bounds nothing (39–62% Wilson upper bound at 0 detected), so here it is an unbiased sample for the
  system-view miss estimate, and cost is decided at the realized shadow rate.
- **Spend.** R1 path, pre-steps included: expected about $37–77 list, hard cap $98.5 (§10). R3: hard cap $109 (shape
  d3/d4) or $149 (shape d4/d5). The R3 caps fit the $150 weekly envelope only in a fresh week (ATTACK §5 decision 6: "R3 is
  the item that waits").
- **Open.** 21 TBDs (§13). The blockers before F2 are T2 (static-arm SDK), T3 (rule CR in code), T4 (reference freeze)
  and T1 (E2 stamp).

## 1. Scope

**In the slice:** R1 (and R3 under the gate), arms (a), (e), (c), (d), K = 2, the B11 attack as a paid pre-step, the
reference freeze, and the (e) builds.

**Not in the slice, and why:**
- **R2** is skipped (ATTACK §4.2 days 6–7 name R1 and R3). **R4** waits for R3: its subsidiaries call the R1 and R3
  references and solvers (W-BED §3.4; ATTACK §4.4). So H3 (curriculum, CUR − ISO) is not tested here, and no CUR/ISO
  pair is run.
- **R5, R6** need slice 2b's `flow.agent` and `flow.wide` arms on a ladder that has not started (ATTACK §4.4).
- **(b) O/H** (quota-heavy; W-BED §4) and the **Sonnet/Opus agent ceilings** of W-BED §4 (d): not named by ATTACK §4.
- **(e′)**, the Sonnet builder (ATTACK M10): descriptive, scheduled later.
- **(g)** library-first: blocked. The census is still a candidate generator, L1 revision 2 is pending (PROOF-LEDGER D1),
  and M4's enumeration was killed (K6).
- **(c′)**: owner decision, after the R1 reference exists (ATTACK §5 decision 1).
- **The R0 interleave** (W-BED §5: an R0 task at every 8th position) is not built: `stream.mjs` takes one `familyId` per
  config [code]. So no R0 tasks run in the streams, and the router metric is not measured (deviation §12 item 2).
- **R8 faults:** none are injected.

## 2. Beds, seeds and order

### 2.1 Beds (hashes at `93b27ec`; confirmed at F2)

| bed | version | `index.mjs` sha256 | tree |
|---|---|---|---|
| `wbed-r1` (`beds/wbed/r1/`, shim `beds/wbed-r1/index.mjs`) | 1.0.0 | `b962e4e7140f3a6d…` | `45ab60fa99fbd1b2e5ffe48945c9b825c54620d8` |
| `wbed-r3` (`beds/wbed/r3/`, shim `beds/wbed-r3/index.mjs`) | 1.0.0 | `01354fd2225316bf…` | `d35948e9b80cd91ab74ade62596bc80f4d415726` |
| shared world `beds/wbed/lib/` | — | — | `26e69bd57b37e199776956da4592c574487437e2` |
| `wbed-r0` (P0 positive control only) | as committed | TBD at F1 | TBD at F1 |

R1 task sizes (inline tokens, means over seeds 301–310): 10.0K at d2, 13.9K at d3, 17.7K at d4, 24.1K at d5
(W-BED-R1-NOTES §2) [doc]. On the attack seeds, the driver's dry run gives d3 13,532–15,257 (mean 14,257) and d4
16,819–19,130 (mean 18,184) [M]. R3 on the attack seeds: d3 12,810, d4 39,165, d5 63,163 (means) [M]; every d4 and d5
task is above 32K tokens (W-BED-R2R3-NOTES §6) [doc].

### 2.2 Seeds (SEED-LEDGER W-bed blocks), verified unused

| use | bed(s) | split | seeds | ledger row (status) | purpose | `seedRefusals` |
|---|---|---|---|---|---|---|
| stream A (lineage 1) | wbed-r1, wbed-r3 | test | **8201–8224** | `wbed-heldout-a` (reserved) | `jit-heldout` | 0 of 24 per bed [M] |
| stream B (lineage 2) | wbed-r1, wbed-r3 | test | **8301–8324** | `wbed-heldout-b` (reserved) | `jit-heldout` | 0 of 24 per bed [M] |
| P0 attack | wbed-r0, wbed-r1, wbed-r3 | dev | 379–390 | `wbed-dev` (fresh) inside `kev-probe-pilot` | `jit-dev` | 0 of 12 [M] |
| reference fixtures (seen with labels by the reference author); (e) examples (inputs only) | wbed-r1, wbed-r3 | dev | 373–378 | `wbed-dev` | `jit-dev` | 0 of 6 [M] |
| P1 reference validation | wbed-r1, wbed-r3 | dev | 301–312 | `wbed-dev` | `jit-dev` | 0 of 12 [M] |
| P4 dev smoke | wbed-r1 (wbed-r3 if R3 runs) | dev | 325–328 | `wbed-dev` | `jit-dev` | 0 of 4 [M] |

**Why held-out seeds for the first W-bed streams.** The slice makes preregistered decisions (§7.1), and AGENTS.md keeps
development seeds out of claims. Held-out blocks C (8401–8424) and D (8501–8524) stay reserved, so a later K = 4
extension of the same rung remains possible. The engine risk of a first run is taken by the dev smoke P4, not by
held-out seeds.

**"Unused", checked four ways at $0** [M]:
1. `seedRefusals` from `experiments/jit/seeds.mjs` (the check `stream.mjs` runs) refuses none of the planned seeds.
2. No run directory or config names a W-bed family. Scanned: `experiments/runs/`, `research/jit-20261008/runs/`,
   `experiments/jit/configs/`, `/var/tmp/foundry-work/runs/`, `/var/tmp/foundry-work/jit/` and
   `/var/tmp/foundry-work/configs/`. Result: none.
3. No test or analysis generates a **wbed-r1** or **wbed-r3** task at a held-out seed. Held-out seeds appear only in the
   R4, R5 and R6 bed tests, as generator checks on those beds' own parents (`beds/wbed/r4/r4.test.mjs:209`, `r5.test.mjs:199`,
   `:225`, `r6.test.mjs:24`). R4's child seeds are ≥ 1,000,000 and outside every ledger range (`r4.test.mjs:207–227`).
4. The reference-author tables contain the string `QP-8301` (`beds/wbed/references/author/fixture-answers.json:541`). It is
   a document id in a dev fixture, not a seed.

**Caveat on the dev seeds.** 301–324 and 341–346 were used at $0 to tune the R4 input profile (FLOW-V3-SLICE2 §2.2), and
301–312 to validate the references. That is development use of dev seeds. None of it is evidence here.

### 2.3 Stream shape

- **R1:** idx 0–15 at d3 on seeds base+0…base+15, then idx 16–23 at d4 on base+16…base+23. The base is 8201 (A) or 8301
  (B), as in Appendix A. This holds if P0 admits d3 and d4 (§4.1). Otherwise the §4.1 shape rule applies.
- **R3:** shape d3/d4 or d4/d5, chosen by the §4.1 shape rule from P0's R3 attack before any R1 outcome is read.
- **Second half:** idx 12–23 (12 tasks: 4 at the first difficulty, 8 at the drift difficulty).
- **Steady-state window:** idx 3–23 (21 tasks; warmup 3) for every arm, so that pairs match.

### 2.4 Ledger edits at launch (TBD T9)

The held-out rows cover all eight W-bed beds, and `jit-heldout` needs fresh seeds. Flipping a whole row to `used` would
refuse R3 and every later rung with `SEED_REFUSED`, the same trap as `jit-r0-fresh` (ATTACK §5 decision 12). So:
- at the R1 launch commit, split `wbed-r1` out of `wbed-heldout-a` and `-b` into rows with status `used`;
- do the same for `wbed-r3` at R3's launch;
- do this in the same commit as the configs (the ledger's own rule).

### 2.5 Order of execution

| step | what | split | gate to start |
|---|---|---|---|
| F1 | freeze §2, §4 and the pre-step caps | — | this draft reviewed |
| P0 | attacks: R0 control; R1 at d3, d4, d5; R3 at d3, d4, d5 (§4.1) | dev 379–390 | F1; quota (§9.6) |
| P1 | paid reference validation, one revision allowed, freeze by sha256 (§4.2) | dev 301–312 | P0 admitted the rung |
| P2 | (e) builds, two per rung (§4.3) | dev 373–378, inputs only | P0 admitted the rung |
| P3 | land T2 and T3, stamp E2, G1–G6 (§8) | — | P1, P2 done |
| P4 | dev smoke on E2 (§4.4) | dev 325–328 | P3 |
| F2 | freeze the rest: configs, arm hashes, E2 record, reference and (e) shas, `stats.mjs` sha | — | P4 passed |
| P5 | R1 stream A, then stream B (serial) | test | F2; quota; envelope |
| P6 | read R1's gates (§9.1–§9.2) | — | P5 done |
| P7 | R3: P2 builds, P4 smoke, then streams A and B | dev, then test | §9.2 gate |

The R3 attack, validation and stamp items run with R1's (P0, P1, P3), so R3's shape and admission are fixed blind to every
R1 outcome. R3's builds and smoke wait for the gate, so that no money is spent on a rung that may not run.

## 3. Arms and configuration

### 3.1 Arms

| arm | builds | runs | construction | lineage |
|---|---|---|---|---|
| **(a) JIT H/H** `jit:claude-haiku-5-5/claude-haiku-5-5` | Haiku interprets warmup tasks 0–2; the Haiku builder compiles flow-v3 from traces (prompt v5; with an empty library its text is v4's byte for byte, FLOW-V3-SLICE2 §4 item 1 [doc]) | compiled solver on flow-v3; deopt → Haiku interpreter; shadows and adjudication by the arm's interpreter (Haiku); **no Opus fallback** (`compilerFallback: null`) | warmup interpreter $ + every compile (builder + gateway + host check), recompiles included | the stream |
| **(e) B1 built once** `static:<build artifact>` | one Haiku 5.5 builder session per lineage (`experiments/c0/construct.mjs`, arm `B1`, the script kit), from the spec and 3 example tasks' **inputs**; `scoreChecks: 0`, so no score service, no labels and no traces | the built `solve.mjs`; deopt, crash, timeout or invalid output → Haiku interpreter (`static:` semantics, `stream.mjs` header) | the build record's `constructionCostUsd` (builder + gateway), cap $3 + $1.5 | the build; build A runs on stream A, build B on stream B |
| **(c) reference** `static:beds/wbed/references/<rung>-reference.mjs` | written once per rung from the rung spec and the labelled fixtures 373–378; frozen by sha256 after P1 (W-BED §2.3) | the frozen script on flow-v3 (needs T2), judges Haiku first, escalating to Sonnet on a failed check; crash or deopt → Haiku interpreter | authoring cost as recorded (T4); never added to per-task cost | one script for both streams; clustered by stream |
| **(d) Haiku agent** `agent:claude-haiku-5-5` | — | one sandboxed Haiku session per task, budget $2, 15 minutes | 0 | tasks are independent |

### 3.2 Configuration decisions (proposed; taken under the orchestrator's delegation, scope [U], T16)

Appendix A shows the full config. Each decision below gives its reason.

1. **No Opus anywhere in (a).** This is W-BED §4 (a), the owner's literal question. R0's H/H arm (`2559d6a6`) had an Opus
   compile fallback. It looks unused: its compiles cost $3.83 and $1.59, against a fallback cap of $8 + $1.5 [M, from rows].
   So R0 is still a fair cost proxy.
2. **`gatewayModels: [haiku, sonnet]` for every arm.** The reference escalates judges to Sonnet (W-BED §2.3), so (a) and
   (e) get the same tiers. The stream's default would also allow Opus judges inside compiled solvers (`stream.mjs:327`
   [code]). The Sonnet share of judge spend is reported per arm (§6).
3. **Adoption rule: any usable version is adopted** (no `adoptRequiresAcceptance`), as in R0-K (ATTACK §5 decision 5).
   "Accepted" is still read from the compile record, for the §9.2 gate.
4. **Strict acceptance** (`minPartial` 0.9), `acceptanceIds: exact`, `preserveRefusals: true`, warmup 3,
   `recompileOnDeopts: 2` (M9 keeps the count; PROOF-LEDGER K15), `maxTraces: 8`. These are the R0/PREREG-stream values
   (PREREG-stream §0.5).
5. **Comparators.** `jit.compare: 'unordered'`; `compile.compare` tolerant at relTol 0 and absTol 0, which is exact with
   arrays compared as multisets. The R1 and R3 oracles are exact and order-free (W-BED-R1-NOTES §3; R2R3-NOTES §4) [doc].
   These are the records settings.
6. **(a) is a library arm in mode `iso` with an empty registry** (`childBudgetUsd` 0.3, `concurrency` 2,
   `parentMarginUsd` 0.1; the budget rule gives 0.7 ≤ 1). Its only effect at R1/R3 is that the adopted accepted version
   is registered with the whole stream's input profile (FLOW-V3-SLICE2 §17 T1). R4's CUR arm needs those entries. At R1,
   ISO and CUR are the same arm. R3 runs as ISO too, so that B3 measures Haiku building R3 from scratch. W-BED §5's CUR
   chain through R3 is not run (deviation §12 item 9). R4's CUR seed will be the union of the same lineage's R1 and R3
   registries (T18, not this slice).
7. **(e) uses the C0 B1 script kit, not flow-v3** (deviation §12 item 3). M10 says "Haiku builds B1 once"; C0 measured
   it (B1-haiku 16/16, $2.21 per build, `REPORT-dev.md:26`) [doc]; its kit hash is frozen in E1c (`6bc6b06eccf45cae`,
   ENGINE-FREEZE §6) [doc]. A B1 script imports only `tools/model.mjs`, so it runs in a `static:` arm today. The builder
   may run its script on the 3 unlabelled examples through the gateway (cap $1.5). W-BED §4 says "no runs"; M10 says "no
   traces". This draft adopts M10's reading: no labels, no score and no interpreter answers reach the builder.
8. **Example seeds for (e):** build A gets 373–375 and build B gets 376–378, at the stream's first difficulty. Two
   different example sets make the lineages more independent.
9. **Shadow floor:** §5.
10. **`jit.invariance` (M1) is off.** Its adoption rule has not passed (PROOF-LEDGER K4: N on records), and the stream
    refuses it together with `library` (`stream.mjs` normalizeConfig) [code].
11. **Concurrency 2, streams serial** (A then B), and each stream runs alone with at most one $0 agent beside it
    (ATTACK §4.1 items 4–5, §4.3).

## 4. The paid pre-steps and their rules

### 4.1 P0: triviality and necessity attack (PROOF-LEDGER B11), a paid gate with its own rule

**Plan.** `beds/wbed/attacks/triviality.mjs` (sha256 `726c187e…` at `93b27ec`): 12 attack seeds (379–390) × effort
`none` and `medium` × one `claude-haiku-5-5` call with the task inline (B0-call system prompt), through the in-repo route:
`b0Call` arms in `runExperiment` with a journaled `createModelPort` and `envFaultRule: true` (driver output) [code].

| rung | difficulties | calls | token-priced cost | with the claude-cli overhead | cap |
|---|---|---|---|---|---|
| R0 (positive control) | d3 | 24 | — | $0.62–0.72 | $1.0 |
| R1 | d3, d4, d5 | 72 | $0.121 at d3 [M] | about $1.9–2.2 | $3.5 |
| R3 | d3, d4, d5 | 72 | $0.108 / $0.194 / $0.274 [M] | about $1.9–2.2 | $4.5 |

**Rule (fixed at F1):**
1. **Admission per (rung, difficulty).** A difficulty is admitted if one Haiku call passes **≤ 2 of 12** at **each**
   effort. That is W-BED §2.4 item 1, and the same as ATTACK §4's "drop at ≥ 20%", because 3/12 is 25%.
2. **Shape rule.** The stream uses the lowest consecutive pair (d, d+1) in {d3/d4, d4/d5} whose difficulties are both
   admitted. If neither pair is admitted, **the rung is dropped from the slice and reported** as attack success.
   - For R3, the d3 segment is a judgment test, not a size test (R2R3-NOTES §9). The shape rule is the R2R3 notes' "start
     at d4" made mechanical.
3. **Positive control.** R0 is expected to pass **≥ 10 of 12** at each effort (W-BED §3.0). If it passes fewer, the attack
   instrument (prompt rendering, schema, port) is suspect: R1/R3 *admissions* are not read until the cause is found and
   recorded. *Drops* stand, because the gate is asymmetric (W-BED O2): a rung is dropped on attack success and never
   "proven complex" by attack failure.
4. **Necessity.**
   - R1 has no separate necessity attack: the pipeline is the feature, so the one-call attack is the necessity attack
     (driver table).
   - R3's deterministic necessity stand-ins (`sequential-single-context` at d4–d5, `no-reducer-lost-middle`,
     `no-reducer-currency-mixed`) must fail ≥ 50% of the attack seeds at the stream's difficulties. This is checked at $0
     with `--stub <control>`. Its paid counterpart is the one-call attack at d4/d5 (the size necessity). The 32K
     single-context budget behind `sequential-single-context` is an inference (R2R3-NOTES §8 item 6).
   - W-BED §2.4 item 2, a ≤ 20-line deterministic script, must also fail. It is $0 and not yet built (T7).
5. **Validity.** A call that ends in an environment fault (`ENV_FAULT_CODES`) is retried once. A difficulty with more than
   25% of its calls still impaired is re-run at the next quota window; it is never read. Schema-invalid output is a fail,
   not a fault.

The attack's outcomes are dev evidence. They gate admission and fix the shape, and they enter no claim.

### 4.2 P1: reference validation and freeze (arm c; W-BED §2.3)

- The references exist as working files: `beds/wbed/references/r1-reference.mjs` (uses `flow.phase` 7×, `flow.flag`,
  27 guards, 7 invariants, 1 judge site) and `r3-reference.mjs` (uses `flow.wide` 1×, 2 judge sites) [code]. Both are
  validated at $0 on stub gateways by `validate.mjs`. These files are another agent's area and are being edited (`git
  status` at `93b27ec`: M on `r1-reference.mjs`, `validate.mjs` and the author tables). Their FROZEN.json and README do not
  exist yet. Who wrote them and through what route (an in-session agent, not the `claude -p` Opus session of W-BED §2.3) is
  **[U]** until the README records it (T4).
- **Paid validation:** each reference runs on dev 301–312 at the stream's two difficulties (24 runs) with live judges
  (Haiku, then Sonnet on a failed check). Scoring is by the oracle, analyst-side. Cap $2 per rung.
- **Rule (W-BED §2.3):**
  - At ≥ 10/12 at each difficulty, the reference is frozen as is.
  - Below that, the author gets the failing seeds' inputs and expected outputs once, revises once, and the result is
    frozen by sha256 whatever its score.
  - Revisions, their cost and the validation scores are recorded. The reference is never tuned again, and nothing
    from P5 reaches its author.
- **Authoring cost** (the human-curation proxy): the authoring session's list-price dollars, tokens and wall-clock if
  journaled, else "unmeasured" stated explicitly (T4). It is reported beside (c), never added to per-task cost.

### 4.3 P2: the (e) builds

- **Setup.** `construct({ arm: 'B1', familyId: 'wbed-<rung>', probeSeeds: [373, 374, 375] | [376, 377, 378], difficulty:
  <first stream difficulty>, builderModel: 'claude-haiku-5-5', builderEffort: 'high', builderBudgetUsd: 3,
  constructionModelUsd: 1.5, minutes: 30, scoreChecks: 0, models: ['claude-haiku-5-5', 'claude-sonnet-5-5'] })`.
  These are (a)'s compile caps per build, so the construction budgets are equal (W-BED §4 (e)).
- **Rule.**
  - A build that ends in an environment fault is retried (`BUILD_ENV_FAULTS`).
  - A build with `nestedModelAttempts > 0` is void and rebuilt once.
  - A build with no `solve.mjs` is recorded as a construction failure. Its arm then runs as "no artifact": every task
    goes to the Haiku interpreter, and it is reported so.
  - The artifact is frozen by sha256 before F2.
- **Never shown to the builder:** oracle output, labels, interpreter answers or any held-out input.

### 4.4 P4: dev smoke on E2 (engine validity, not evidence)

- **What runs.** One stream config per rung, cloned from Appendix A with `split: dev`, seeds 325–328 at the first stream
  difficulty, `seedPurpose: jit-dev`, from the E2 worktree. Every arm runs. (a) runs through its first compile and one
  compiled task. Cap $8 per rung.
- **Pass condition, all required:**
  - every arm writes 4 rows and no harness error;
  - (c) delivers `compiled` (not `fallback`) on at least 3 of 4, and its compiled trace shows flow-v3 events, which
    tests T2;
  - (e) runs its build artifact (`scriptSha` matches P2);
  - (a)'s first prompt-v5 compile completes, accepted or not, and its compiled run executes on flow-v3;
  - no row has `costUnknown` except one booked at its bound and explained;
  - no unexplained environment fault.
- **On failure.** Any engine fix re-stamps E2 (§8) and re-runs P4. Smoke rows are dev, never pooled and never read for
  outcomes.

## 5. Shadow floor and verification (ATTACK M2)

**Setting.** `jit.shadowFloor` **0.25**, a seeded Bernoulli draw per compiled-ok delivery with the propensity logged, plus
`shadowOnFlags: true`. Shadows and adjudication use the arm's interpreter, which for H/H is a Haiku agent session. So for
(a), M2's "interp" and "haiku" tiers are the same tier (M2 §2.2) [doc]. Static arms (c) and (e) are never shadowed.
`shadowSeed` defaults to the experiment name, so the JIT arm hash differs between lineages only through it (Appendix A)
[M].

**Why this setting, per M2** (`research/jit-20261008/analysis/verify-economics/REPORT.md` at `722c4f0`;
`experiments/jit/verify-economics.mjs` is under concurrent edit, so the report is re-cited at F2, T21):
1. **At 24 tasks the floor bounds nothing.** With 0 detected, the Wilson upper bound on system-view misses is 39–62%. A
   bound of ≤ 20% is infeasible at N = 24 for every arm, and ≤ 10% is infeasible at every N (M2 §0, §6.3–§6.4). So no
   slider setting is preregistered. The floor's job here is an **unbiased sample** for the IPW system-view miss estimate
   (`ipwMissEstimate`), not a guarantee.
2. **CSP-1 is not used.** With the measured false-alarm rates (φ 42–100% on records), it degenerates to about 100%
   inspection (M2 §7).
3. **Flags dominate the realized rate.** R0's H/H shadowed 9 of 9 compiled runs because all 9 were flagged (M2 §6.1; R0
   rows [M]). At that realized 100% rate, H/H cost $0.1180 per task on records against the Haiku agent's $0.1039; at the
   floor alone it would cost $0.0438 (M2 §0). Keeping `shadowOnFlags` tests the engine as built, as PREREG-stream §0.6
   item 6 recommends. **Cost ratios are decided at the realized rate.** The same ratios are also reported repriced at the
   floor only (M2's L1 at r = 0.25), as a descriptive counterfactual.
4. **(c) and (e) carry no verification cost by construction.** So CR2 and CR3 are also reported at L1 (before
   verification). That shows how much of any gap is verification and how much is execution. Their silent misses are
   reported in the oracle view only; a system view needs shadows they do not have.
5. **After the slice,** `verify-economics.mjs` `armEconomics` is run on the slice's exports as a secondary analysis:
   break-even shadow rate for H/H on R1/R3, and the slider table. It is descriptive and moves no rule.

## 6. Measurements (definitions, fixed at F2)

- **Verified success:** the bed oracle's `pass` on the delivered answer, whoever delivered it (compiled, interpreter
  fallback, adjudicated). Also reported: the compiled-only pass rate where rows carry `compiledPass`, and the share of
  static-arm tasks delivered by fallback.
- **Steady-state $ per task (SS):**
  - computed over idx 3–23;
  - for (a): row `costUsd` minus compile spend (every `costBreakdown` key that starts with `compile`, except `compiled`;
    PREREG-stream §0.3). It therefore holds compiled runs, deopt fallbacks, shadows and adjudication at the realized rate:
    M2's L1 plus realized verification;
  - for (c), (e) and (d): row `costUsd`;
  - `costUnknown` rows are booked at their bound (PROOF-LEDGER A9) and counted in the report.
- **Construction spend per lineage:**
  - (a): interpreter spend on idx 0–2 plus every compile spend in the stream;
  - (e): its build record;
  - (c): its authoring cost (reported only);
  - (d): 0.
- **24-task $ per verified success (CPS):** total spend including construction, over passes. For (c), shown without and
  with authoring cost spread over the 48 tasks.
- **Secondary:**
  - time to first accepted version and number of versions;
  - deopt kinds;
  - effective shadow rate (flagged plus floor shadows over compiled-ok deliveries);
  - silent misses per 100 tasks in the oracle and system views (`durability.mjs`), with the IPW estimate;
  - quota share by model tier in list $ and Opus-equivalent units, and the Sonnet share of judge spend (W-BED §6.2);
  - code share (W-BED §6.2);
  - latency p50 and p95 per task and arm (PROOF-LEDGER K17);
  - (e)'s d3 vs drift-segment success (M10's kill mode);
  - `$ + W × silent misses` if the owner declares W (K11; T13);
  - R3 critical-path wall-clock (W-BED §3.3).
- **Descriptive only:** structural fidelity against the reference (W-BED §6.3), only if the extractor exists at F2 (T19).
  It is never a criterion.

## 7. Hypotheses and decision rules

### 7.1 Decided: steady-state cost ratios (rule CR-W)

**Family per rung r** (Bonferroni, m = 3, so each CI is at 1 − 0.05/3 = 98.33%):

| id | pair X vs Y | the question |
|---|---|---|
| CR1(r) | (a) H/H vs (d) Haiku agent | the cost half of the owner's literal question: once Haiku has built it, is a task cheaper than asking the Haiku agent? |
| CR2(r) | (a) H/H vs (c) reference | does the Haiku-built workflow run as cheaply as the hand-curated one? |
| CR3(r) | (e) built once vs (a) H/H | M10: is building once from the spec cheaper to run than JIT from traces? |

**Rule CR-W** (two-sided; `DECISION_RULE`'s structure applied to cost; PREREG-stream rule CR made two-sided):
- **V:** neither arm is invalid by the env-fault rule or the truncation rule (§9.4), and the paired task sets on idx
  3–23 match in both streams.
- **K:** K = 2 streams (lineages).
- **F (direction):** each stream's ratio (Σ SS of X over Σ SS of Y on its 21 tasks) is on the same side of 1 as the
  pooled ratio.
- **C (CI):** the 98.33% CI of the pooled log ratio excludes 0. The CI is the wider of two:
  - a two-stage cluster bootstrap (streams, then tasks within each stream);
  - the paired-task bootstrap widened by √Deff, with Deff = 1 + (m − 1)ρ, ρ = 0.1 (`RHO_PREREG`), m = 21, so Deff = 3.0.

  With 2 clusters the cluster bootstrap cannot see between-lineage variance, so the widened one binds, as in `stats.mjs`.
- **Clustering.** Pairs that involve (a), (e) or (c) are clustered by lineage. For (c) and (e) this needs the static arms
  passed as `kind: 'jit'` (lineage-clustered), because `stats.mjs` `pairRows` clusters non-JIT arms by task
  (`experiments/jit/stats.mjs:143`) [code] (T3).
- **Verdicts:** "X cheaper than Y" (V, K, F hold and the CI is entirely below 0); "X dearer than Y" (the CI is entirely
  above 0); otherwise "directional, no decision"; or "invalid".
- **Code.** Rule CR is not in code yet: `stats.mjs` has no cost decision (T3, shared with PREREG-stream §0.6 item 2).

**Planning power** [M, approximate; method of PREREG-stream §0.2]:
- **Data.** R0 records (dev 225–236, K = 1, records not R1), H/H against the Haiku agent on idx 3–11 (9 paired tasks):
  SS $0.118 vs $0.0614 per task, ratio 1.92.
- **Projection.** The task-bootstrap SD of the log ratio, 0.246, is scaled to K = 2 × 21 tasks and widened by √3.0. That
  gives an SE of 0.197.
- **CIs at the R0 ratio:** 98.33% CI 1.20–3.08; 95% CI 1.31–2.83.
- **Power.** At 80% power with Bonferroni, CR-W decides ratios ≤ 0.53 or ≥ 1.89.
- **Reading.** If R1 behaves like records, CR1 is likely decided "dearer" [I]. CR2 and CR3 compare an unshadowed static
  arm with a shadowed JIT arm, so large ratios and decisions are likely [I]. No ratio from W-bed data exists yet.

### 7.2 Construction cost: a dominance reading, not a test

Construction spend is one lump per lineage: two numbers per arm at K = 2. No test at α = 0.05 exists on two paired
lumps; the exact sign test's smallest one-sided p is 0.25. So M10 / PROOF-LEDGER K7's "construction cost ratio, which is
decidable" does not hold (deviation §12 item 7).

**Declared reading,** (e) against (a), per rung:
- **"(e) dominates on construction"** if (e)'s construction spend is at most half of (a)'s **in each lineage**;
- **"(a) dominates"** if the reverse holds;
- otherwise "mixed".

It is labelled "dominance, not a test" wherever it is reported. Three things are reported beside it: both lineages'
lumps, the (e) build success, and the 24-task CPS (which includes construction).

### 7.3 Success: directional, with declared power

- **Rule.** `stats.mjs` `decide` (`DECISION_RULE` unchanged: V; K ≥ 2; a 3-point floor in every stream with the pooled
  sign; exact McNemar p < 0.05; the 95% lineage-clustered CI excludes 0) is computed and printed for each pair below.
- **Power** (`node experiments/jit/stats.mjs power`, m = 24, pRef 0.8) [M]:
  - at K = 2 the rule's MDE at 80% power is 23 points at ρ = 0, 39 at ρ = 0.1 and 52 at ρ = 0.3;
  - its power at δ = 10 points is 12% at ρ = 0 and 4% at ρ = 0.1;
  - the pooled test alone has 23% and 10%.
- **Reading.** None of the following is a preregistered primary. A verdict that clears every check is reported as such,
  with this power statement beside it; anything else is "directional, no decision".
- **Pairs:**
  - **S1(r), W-BED H1** (second half, idx 12–23): (a) vs (c). Non-inferiority at δ = 10 is read from the same CI against
    −10 points.
  - **S2(r)** (all 24): (a) vs (d).
  - **S3(r)** (all 24, plus the drift segment idx 16–23 alone): (e) vs (a). This is M10's kill mode: C0's static script
    went 2/8 on records d4, failing silently (D25).
  - **S4(r)** (all 24): (c) vs (d). A bed check: if the hand-curated workflow does not beat agent-every-time, the rung's
    premise is weak.

### 7.4 Secondary, never decided

- Every other arm pair's SS ratio and CPS ratio, with CIs.
- Both CR2 and CR3 at L1 (before verification).
- The floor-only reprice of (a) (§5 item 3).
- The 24-task CPS ratios (expected undecidable: PREREG-stream §0.2 measured a K = 2 CI of 0.55–7.3 for a records CPS
  ratio).
- §6's secondary list.
- M2 on the slice's exports.

## 8. What must be stamped before launch: the E2 record

E2 is stamped **from the commit the streams run on**, in a frozen worktree like E1c's (ENGINE-FREEZE §6), because other
agents commit to `experiments/` concurrently (FLOW-V3-SLICE2 §13, §17.6). No W-bed run starts before it (ROADMAP §6
rule 13; ATTACK §4.1 item 6). The record goes into ENGINE-FREEZE as a new section and its values are copied into §0 here
at F2.

### 8.1 Engine items that must land before the stamp

1. **Static arms on flow-v3 (T2, a blocker for (c)).**
   - **Measured** [M]: the R1 reference under `DEFAULT_FLOW` (`flow.mjs`, the SDK a `static:` arm gets) ends `crash`,
     `SCRIPT_ERROR`, `TypeError: flow.phase is not a function`, $0. Under `FLOW_V3` it ends `ok` (stub gateway policy A,
     dev seed 325 at d3, $0.0031 stub cost).
   - **Coverage gap.** Of the three primitives the references use beyond v1, `flow.mjs` v1 defines none (`flag`, `phase`,
     `wide`) and flow-v2 defines `flag` only [code]. So R3's reference (`flow.wide`) fails the same way.
   - **Fix.** A static-arm SDK option hashed into the static arm's definition, for example `staticFlowVersion: 3` or a
     `static@3:` spec. It needs a test that a static arm runs the R1 reference `ok` and the R3 reference's `wide` on a
     stub gateway, and that an arm without the option keeps today's hash (`V1_HASHES`, the R0 static arm `ca4f763d…`).
2. **Rule CR in code (T3).** This is `decideCost`, with:
   - the SS definition of §6;
   - a CI `level` parameter (98.33%);
   - the two-stage cluster bootstrap and the √Deff widening;
   - two-sided verdicts;
   - lineage clustering for static arms;
   - a test.

   After it lands, `stats.mjs` is re-hashed. It is shared with PREREG-stream §0.6 item 2.
3. **(a) without a fallback compiler.** `compilerFallback: null` normalizes (Appendix A), and the compile path skips the
   fallback when `fb` is null (`stream.mjs:1124`) [code]. A stub stream test must confirm that no fallback compile is
   attempted (T11).

### 8.2 The record (each value from the launch commit)

| item | candidate value at `93b27ec` (re-taken at the stamp) | source |
|---|---|---|
| commit, root tree; pushed or tagged (an unpushed kit commit is a single copy, ATTACK §0) | TBD | `git rev-parse` |
| `experiments/jit` tree | `249226da1da504c5e84f65a76bbce420f86915f5` (moves with T2, T3) | — |
| `experiments/lib` tree | `eb61500a8df53f9a1b3d95cccbc93873c0adb4c2` | — |
| `experiments/c0` tree (the (e) builder: `construct.mjs`, `prompts.mjs`) | `1ef9bbc5fcecdc3198959c712658420ad718953f` | — |
| `flow-v3.mjs` sha256 (pinned in `slice2-wiring.test.mjs`) | `15da5c24efd537afb30eb8754955583c735fb6f36e8c55ca3646c13aa848f06b` (= FLOW-V3-SLICE2 §17.6) | `sha256sum` |
| `flow-v2.mjs` sha256 | `5dde46668c10c338074ee4a1ec1115632f18ddca4773a71024b4b6ee18fb5223` | — |
| construction-kit hash; B1 script-kit hash | expected `852ebdf05588de97`; `6bc6b06eccf45cae` (E1c values, re-run `kitHash()`) | ENGINE-FREEZE §6 |
| `src` tree; policy hash | expected `dc710129…`; `cfe79728…bc297` | ENGINE-FREEZE §6 |
| Node; claude CLI; uid route; `DEFAULT_KEEP_RO` | expected v24.21.0; 2.1.299; 65534 mapped onto host 0 | ENGINE-FREEZE §6 |
| bed hashes and trees | §2.1 | — |
| reference shas (FROZEN.json), revision count, validation scores | T4 | P1 |
| (e) artifact shas and build records | T5 | P2 |
| analysis scripts: `stats.mjs` (after T3), `report.mjs` `ff586a40…`, `durability.mjs` `527ee6e1…`, triviality driver `726c187e…` | re-hash | `sha256sum` |
| arm hashes of the 8 (or 16) test-split arms; every static arm's `scriptSha` non-null and equal to the frozen file | T8 | `parseArm(spec, normalizeConfig(cfg))` |
| unchanged pins: `V1_HASHES` (dev-records-1, dev-kinetics-1), R0 records and R0-K arm hashes (`slice2-review` T5) | green | test suite |

### 8.3 Gates at the stamp (as E1c's, ENGINE-FREEZE §6)

- **G1 engine:** the table above; frozen paths clean.
- **G2 suites:** `node --test --test-concurrency=2 experiments/jit/test/*.test.mjs` (332 tests at FLOW-V3-SLICE2 §17.7,
  plus T2's and T3's tests), the main suite, `experiments/lib`, and the `beds/wbed` R1/R3 tests.
- **G3 seeds and configs:** `stream.mjs --dry` on each slice config. This includes `assertSeedsAllowed`, and no run
  directory may exist yet.
- **G4 live smoke:** one sandboxed Haiku `interpret`, cap $0.45, `costUnknown` false, scans clean.
- **G5 quota:** 5h ≤ 0.60 and 7d ≤ 0.80.
- **G6 machine:** ≥ 3 GB free on `/`; RAM; no other `stream.mjs` or `claude -p` running.

### 8.4 FLOW-V3-SLICE2 semantics this slice relies on (read before launch: §17.5, §17.3)

- **Wide admission** (§17.5 item 1). The R3 reference's `flow.wide` runs its first judge item alone, then admits items
  while (in flight + 1) × the mean cost fits. A worker that cannot start waits. It has a hard budget.
- **Skip objects fail items** (item 2). **Checks are synchronous** (item 3).
- **The compile scan** (item 4). A v5 `solve.mjs` that imports or executes shipped code is void and never adopted. The
  R1/R3 inputs ship no code.
- **The registry** (item 6) gains the whole stream's profile row at arm end.
- **Host totals** (item 7) carry `envFaults` when one happened.
- **Not exercised here:** D10's `textLabel` (no agent nodes; `library.agent` is unset); C9 stall restarts (`stallMs` off,
  §17.3); I2's bed side (R5 only); env faults inside a library child during the compile host check (§17.3: the library
  is empty at R1/R3).

## 9. Kill rules, stop rules and validity

### 9.1 Rung kill rules (programme switches, read at P6 and after R3; W-BED §3, PAUSE §6)

**KR-T, triviality** (§4.1): the shape rule admits no stream shape, because one Haiku call passes ≥ 3/12 at either effort
at some difficulty of every allowed shape. The rung is dropped before any arm runs.

**KR-1, rung negative for Haiku construction.**
- **Rule** (PAUSE §6). H/H's second-half success (idx 12–23) is more than 10 points below the reference's in **both**
  lineages, which means at least 2 of 12 tasks in each.
- **Pooled reading.** W-BED §3.1's "over both streams" reading (at least 3 of 24 pooled) is reported beside it.
- **Measured behaviour** [M], from independent binomials (an upper bound on false kills under positive pairing):

  | true gap | per-lineage rule fires (pRef 0.6 / 0.8 / 0.9) | pooled reading fires |
  |---|---|---|
  | 0 (equal) | 7.1% / 4.8% / 2.1% | 23.1% / 18.2% / 11.1% |
  | −10 points | 20.6% / 19.7% / 18.1% | 49.0% / 48.7% / 48.1% |
  | −20 points | 42.3% / 43.9% / 46.6% | 75.3% / 77.2% / 80.5% |
  | −30 points | 66.9% / 68.7% / 73.3% | 92.2% / 93.2% / 95.3% |

- **Reading.** The switch is the per-lineage rule. It rarely fires falsely, and it misses most true 10-point deficits.
  The pooled reading fires falsely up to 23% of the time.

**KR-2, "cheaply" falsified** (W-BED §3.1, §3.3 cost clauses; point estimates, pooled over both streams).
- **Rule.** At R1, H/H's 24-task CPS exceeds the Haiku agent's by more than **2×**. At R3, by more than **1×**.
- **Expected to fire.** W-BED §0 and O4 say so. On R0 records idx 0–11 (the tasks both arms ran), H/H's CPS was about
  5.3× the agent's: $6.62 / 9 passes against $0.69 / 5 [M].
- **Status.** It is recorded as the falsifier as written, not as a test.

**KR-3, no accepted solver** (W-BED §8). If H/H adopts no accepted version (compile record `accepted: true`) within its
cap on R1 in both lineages, the owner's question is answered "no" at R1, and R3 does not run in this slice.

**KR-4, (e)'s kill mode** (M10). In both lineages (e) passes ≤ 2/8 on the drift segment while passing ≥ 12/16 before it.
Then "(e) + recompile is the next arm" is recorded as a design consequence, not a claim.

### 9.2 The R3 gate (ATTACK §4.2 days 6–7)

R3 runs only if all four hold:
1. R1 adopted an accepted H/H version in **both** lineages (stricter than W-BED §8; with exactly one, R3 waits and the
   split is reported);
2. P0 admitted an R3 shape;
3. week-to-date list spend plus R3's caps (§10) is ≤ the $150 weekly envelope (ATTACK §5 decision 6);
4. the quota gates of §9.6 hold.

If 3 or 4 fails, R3 waits for the next window under this unchanged pre-registration.

### 9.3 Environment-fault invalidation (PREREG-stream §6; `stats.mjs` `ENV_FAULT_LIMIT`)

- **Which tasks are impaired.** A task is impaired when its delivery is lost to an environment fault that remains after
  the stream's fault retry. The fault codes are `ENV_FAULT_CODES`: `MODEL_RATE_LIMIT`, `MODEL_UNAVAILABLE`,
  `SANDBOX_UNAVAILABLE`, `EXECUTOR_LAUNCH` and `EXECUTOR_PROTOCOL`. Faults inside a library call tree count
  (`rc.calls.envFaults`, FLOW-V3-SLICE2 §17.1 C1).
- **Rule.** An arm whose impaired tasks exceed **25% of planned tasks** in a stream is "invalid: env faults" (`envFaultCheck`).
  No pair that contains it is decided.
- **Resume.** A usage-limit stop is resumed after the reset from the same E2 worktree. The arm hash is checked per row,
  so a resume never mixes engines (D25 §5).

### 9.4 Truncation and spend stops

- **Spend stops** (§10) are hard: `armSpendStopUsd` per arm and `spendStopUsd` per stream.
- **Truncation rule.** An arm truncated by its cap on more than 25% of planned tasks is "invalid: truncated" (ATTACK §5
  decision 11).
- **No raises.** A cap is never raised after a stream has started. A raise between streams A and B is an amendment, made
  without reading any outcome.

### 9.5 Isolation and security halts

- **Void sessions.** A session with `nestedModelAttempts > 0` is void (as built).
- **Halt.** If any `hiddenPathAttempts` entry or tool path names `.session_ingress_token`, `/home/claude/.claude/remote`
  or a credential file, the slice stops and the owner is told (PROOF-LEDGER K9). Rotation is the owner's decision.
- **Secret scan.** After each stream, the E1c secret-scan regex runs over the run, work and log directories (ENGINE-FREEZE
  §6 G4).

### 9.6 Quota and machine

- **Paid starts.** A paid start (each pre-step and each stream) needs the 5h meter ≤ 0.60 and the 7d meter ≤ 0.80
  (ATTACK §4.1).
- **Concurrency.** At most 2 executors at once. A paid stream overlaps with at most one $0 agent.
- **Mid-stream.** If the 5h meter reaches 0.9, no new task is launched until the reset, and the stream resumes on the same
  engine.

## 10. Spend caps and expected cost (list price)

**Per stream (24 tasks)** [basis: W-BED §9 (the brief and PAUSE §4 call it §7); R0 records rows [M]; D25; R1-NOTES §5;
R2R3-NOTES §7; D22]:

| arm | basis | R1 expected | R1 cap | R3 (d3/d4) cap | R3 (d4/d5) cap |
|---|---|---|---|---|---|
| (d) Haiku agent | R0 records: $0.104 per task, max $0.244 [M]; R1 is about 2× the inline tokens; R1-NOTES §5 gives $0.12–0.18 [I]; R3: $0.25–0.50 at d3–d4 [I] | $2.9–4.3 | **$6** | $12 | $24 |
| (c) reference | stub-gateway token estimate about $0.003 per task (validation files, uncommitted) [doc]; a tiny judge call costs $0.00011 (D22); plus Haiku fallbacks at about $0.15 each | $0.1–1 | **$3** | $3 | $4 |
| (e) runs | static C0 on records: $1.21 for 24 tasks (D25); plus fallbacks | $0.5–3 | **$5** | $6 | $8 |
| (a) H/H | R0 records, 12 tasks: $6.62, of which compile $5.41 in 2 compiles ($3.83, $1.59), steady state $0.118 per task [M]; dev H→H, 24 tasks: $6.12 measured + $2.00 imputed, 4 versions (D25); W-BED §9: $6–20 | $8–18 | **$20** | $25 | $30 |
| `spendStopUsd` (per stream) | sum of the arm caps | — | **$34** | $46 | $66 |
| (e) build (per lineage, P2) | $3 builder + $1.5 gateway; C0 B1-haiku $2.21 | $2–4.5 | **$4.5** | $4.5 | $4.5 |

**Totals:**

| item | expected | hard cap |
|---|---|---|
| P0 attacks (R0, R1, R3; §4.1) | $4.5–5 | $9 |
| P1 reference validations (R1, R3) | $0.5–2 | $4 |
| P2 (e) builds, R1 × 2 | $4–9 | $9 |
| P3 G4 smoke | $0.04 | $0.45 |
| P4 dev smoke, R1 | $5–8 | $8 |
| P5 R1 streams, K = 2 (sum of the per-stream expectations above, × 2) | $23–53 | $68 |
| **R1 path** | **≈ $37–77** | **$98.5** |
| R3 (P2 builds + P4 smoke + streams), d3/d4 | ≈ $35–70 [I] | $9 + $8 + $92 = $109 |
| R3, d4/d5 | ≈ $50–100 [I] | $9 + $8 + $132 = $149 |

This sits in ATTACK §4.2's range for days 4 and 6–7 ($15–35 plus $25–60). R3 at d4/d5 cannot share a week with R0-K and
R1 under the $150 envelope. That is the gate in §9.2 item 3.

## 11. Threats to validity

1. **Authorship correlation** (W-BED O10). Claude wrote the beds, oracles, references, prompts and thresholds, and
   Claude models fill every role. A shared misreading can sit in generator, oracle and reference at once.
2. **Arm (c) is ceiling-like.** Its author saw labelled fixtures (373–378) and one round of validation feedback. The JIT
   and (e) see no labels (W-BED §2.3).
3. **The static arms are unverified.** (c) and (e) carry no shadows, so their cost advantage is partly the absence of
   verification. §5 item 4 and §7.4 report L1 so that this is visible.
4. **Fallbacks blur the static arms.** A crash in (c) or (e) delivers a Haiku agent answer. The fallback share is
   reported, and a high share means the arm measured the agent.
5. **K = 2 and ρ unmeasured.** ρ = 0.1 is assumed (T15). With two clusters, between-lineage variance in compile spend is
   unobservable, and that is why construction cost is not tested (§7.2).
6. **The same seeds across rungs.** R1 and R3 share held-out seed numbers, but they generate different worlds. R3
   reuses R1's billing dialects (R2R3-NOTES §8 item 10).
7. **Profile tuning on R1 dev seeds** (301–324) affects R4's reuse fence, not R1 itself. It is irrelevant here.
8. **Quota attribution.** The meter is shared, so arms are priced in list dollars, not in meter ticks (W-BED O5).
9. **Platform drift.** The claude CLI version (2.1.299) and the cloud host are recorded. Laptop rows are not mixed in.
10. **Selection.** R3's existence depends on R1's accepted-solver gate. R3's rules, shape and admission are fixed blind
    to R1's outcomes (§2.5), so the gate selects on a design property, not on R3 data.
11. **The planning projection is from records**, not R1, and from 9 tasks of one lineage.

## 12. Deviations from W-BED, ATTACK and M10

1. Slice = R1 (+R3), not R1–R4. There is no CUR/ISO pair, so H3 is not tested (ATTACK §4).
2. No R0 interleave in the streams: not built (§1).
3. (e) is built with the C0 B1 script kit, not on flow-v3 (W-BED §4 (e)), and its builder may run unlabelled examples
   (§3.2 item 7).
4. (e) has no input-profile fence. M10's "runs under the profile" is not built for static arms; (e) has `static:`
   semantics only.
5. (c) and (e) are not shadowed (static arms).
6. Bonferroni over three decided cost ratios. W-BED §8 decided success; ATTACK decides only cost.
7. Construction cost is read by dominance, not tested (§7.2). This corrects M10 and PROOF-LEDGER K7.
8. W-BED §3.1's falsifier is applied in PAUSE §6's per-lineage form, with the pooled form reported (§9.1).
9. (a) runs as a library arm in mode `iso` at both R1 and R3. W-BED §5's CUR chain through R2 and R3 is not run (§3.2
   item 6).
10. `gatewayModels` are {Haiku, Sonnet} for every arm. W-BED §4 (a) says "Haiku judges"; this draft matches the
    reference's escalation tier instead (§3.2 item 2).
11. The first W-bed streams run on held-out seeds, after a dev smoke on E2 (§2.2, §4.4).
12. The reference was likely authored in-session rather than in one `claude -p` Opus session ([U], T4).
13. P0 attacks three difficulties per rung, not one, and adds an R0 positive control (§4.1).

## 13. TBDs and what resolves each

| id | TBD | resolved by | blocks |
|---|---|---|---|
| T1 | E2 record values (§8.2) | stamping from the launch commit in a frozen worktree after T2, T3 and T11, with G1–G6 | F2 |
| T2 | static arms on flow-v3 | the engine change and tests of §8.1 item 1 | F2; (c) at all |
| T3 | rule CR-W in code (`decideCost`: level, two-sided, lineage clustering of static arms) | code and test in `experiments/jit/stats.mjs`; re-hash (shared with PREREG-stream §0.6 item 2) | F2 |
| T4 | reference freeze: FROZEN.json shas, authoring route and cost, paid validation scores, revision count | P1, and the references' owner committing README and FROZEN.json | F2 |
| T5 | (e) artifacts and build records (2 per rung) | P2 | F2 |
| T6 | attack outcomes: admission and shapes for R1 and R3; the R0 control | P0 | P1, P2 |
| T7 | W-BED §2.4 item 2: a ≤ 20-line deterministic script fails R1 and R3 | $0: write and score one on 379–390 (a session that did not write the bed) | F1 admission |
| T8 | final configs and test-split arm hashes (static defs change with T2, `scriptSha` with T5) | `parseArm(spec, normalizeConfig(cfg))` at F2 | F2 |
| T9 | per-bed ledger rows for `wbed-heldout-a` and `-b` | the launch commit of each rung (§2.4) | P5, P7 |
| T10 | R3 shape (d3/d4 or d4/d5) | P0's shape rule (§4.1) | P7 |
| T11 | `compilerFallback: null` exercised end to end | a stub stream test; G3 | F2 |
| T12 | whether R3 runs | §9.2 at P6 | P7 |
| T13 | W, the cost of a wrong delivery (K11) | the owner; reported only if declared | — |
| T14 | latency budget (K17) | the owner; p50 and p95 reported regardless | — |
| T15 | ρ | assumed 0.1; the slice reports the observed between-lineage spread and does not amend ρ | — |
| T16 | owner confirmation of §3.2 and of this draft (the delegation's scope is [U], ATTACK §5) | the owner | F2 |
| T17 | quota readings at each paid start | G5 at each start | each P step |
| T18 | R4's CUR seed: the union of the R1 and R3 registries per lineage | a $0 tool or `library.from` as a list; R4's own pre-registration | R4 (not this slice) |
| T19 | structural-fidelity extractor (W-BED §6.3, build step 3) | reported only if it exists at F2 | — |
| T20 | the `wbed-r0` hash for the positive control | F1 | P0 |
| T21 | M2 is under concurrent edit | re-cite REPORT.md at F2 (now `722c4f0`); §5 changes only by amendment | F2 |

## 14. What remains paid

Everything below is the orchestrator's to run with the owner's token. Nothing here was run.

1. **P0 attacks:** about $4.5–5 (cap $9). This is PROOF-LEDGER B11's paid half.
2. **P1 reference validations:** about $0.5–2 (cap $4). This is B10's freeze.
3. **P2 (e) builds** for R1: about $4–9 (cap $9). This is K7.
4. **P3 G4 live smoke on E2:** about $0.04.
5. **P4 dev smoke** for R1: cap $8.
6. **P5 R1 streams** at K = 2: about $23–53 (cap $68). This covers B1 and K7.
7. **Conditional on §9.2:** R3 builds, smoke and streams: cap $109 (d3/d4) or $149 (d4/d5). This covers B3.

Later, outside the slice: R4 (H3), R2, (b), (e′), (c′), and K = 4 on held-out blocks C and D.

## Appendix A. Draft configuration (R1, lineage A), validated at $0

Seed lists are abbreviated with "…"; the config holds every seed.

```json
{
  "experiment": "wbed-s1-r1-a",
  "familyId": "wbed-r1", "split": "test", "seedPurpose": "jit-heldout",
  "segments": [ { "difficulty": 3, "seeds": [8201, "…", 8216] }, { "difficulty": 4, "seeds": [8217, "…", 8224] } ],
  "arms": [ "agent:claude-haiku-5-5", "static:beds/wbed/references/r1-reference.mjs",
            "static:<P2 build artifact, lineage A>", "jit:claude-haiku-5-5/claude-haiku-5-5" ],
  "gatewayModels": [ "claude-haiku-5-5", "claude-sonnet-5-5" ],
  "jit": { "warmup": 3, "shadowFloor": 0.25, "shadowOnFlags": true, "recompileOnDeopts": 2, "maxTraces": 8,
           "compilerFallback": null, "compare": "unordered", "preserveRefusals": true },
  "compile": { "builderEffort": "high", "builderBudgetUsd": 3, "gatewayUsd": 1.5, "checkUsd": 1.5, "minutes": 30,
               "compare": "tolerant", "relTol": 0, "absTol": 0, "acceptance": "strict", "minPartial": 0.9,
               "promptVersion": 5, "acceptanceIds": "exact" },
  "library": { "mode": "iso", "childBudgetUsd": 0.3, "concurrency": 2, "parentMarginUsd": 0.1 },
  "perTaskUsd": 1, "agentBudgetUsd": 2, "agentMinutes": 15, "compiledMinutes": 20,
  "staticFallback": "claude-haiku-5-5", "concurrency": 2,
  "spendStopUsd": 34,
  "armSpendStopUsd": { "jit:claude-haiku-5-5/claude-haiku-5-5": 20, "agent:claude-haiku-5-5": 6,
                       "static:beds/wbed/references/r1-reference.mjs": 3, "static:<P2 artifact A>": 5 },
  "persist": { "commitDir": true }
}
```

- **Variants.** Lineage B uses 8301–8324 and build B. R3 uses `familyId: wbed-r3`, `r3-reference.mjs` and the shape and
  caps of §10. The static-arm SDK option of T2 is added when it exists.
- **Validation.** `normalizeConfig` accepted all four drafts (R1/R3 × A/B) without the spend fields: the seed ledger
  checks, the library budget rule (2 × 0.3 + 0.1 = 0.7 ≤ 1), and `compilerFallback: null`. Draft arm hashes from
  `parseArm` [M]:

| config | (d) agent | (c) reference | (e) static (`scriptSha` null: no artifact yet) | (a) JIT H/H |
|---|---|---|---|---|
| wbed-s1-r1-a | `0cdf176fd8c32a2b` | `5e27f34271dbe4d5` | `73088e2313b419aa` | `6b6a722a057e2d32` |
| wbed-s1-r1-b | `0cdf176fd8c32a2b` | `5e27f34271dbe4d5` | `c4f8038cbff01cee` | `508c66bc3a8dd1e6` |
| wbed-s1-r3-a | `9610dfd5119584c3` | `9fc917ebf57c65ec` | `53014e3ac5542eb5` | `5d05166d73040d4b` |
| wbed-s1-r3-b | `9610dfd5119584c3` | `9fc917ebf57c65ec` | `8e899d47a1d97f47` | `aac4531a610ca468` |

The agent and reference hashes are equal across lineages. The JIT hashes differ only by `jit.shadowSeed` (= the
experiment name). Every hash is a draft: T2 changes the static definitions, and T5 sets `scriptSha`.

## Appendix B. $0 computations behind this draft

Scripts live in the session scratchpad (`…/scratchpad/prereg/`) and are not committed. None calls a model.

| what | script | result |
|---|---|---|
| seed check and prior-use scan (§2.2) | `seeds-check.mjs` | 0 refusals on every planned range for wbed-r1 and wbed-r3; no prior W-bed run artifact |
| static-arm SDK probe (§8.1) | `static-flow-probe.mjs` | `DEFAULT_FLOW`: crash, `TypeError: flow.phase is not a function`; `FLOW_V3`: ok |
| kill-rule behaviour (§9.1) | `planning.mjs`, `pooled-kill.mjs` | the table in §9.1 |
| R0 planning projection (§7.1) | `planning.mjs` | SS $0.118 vs $0.0614 (9 tasks), ratio 1.92; SE(log) at K = 2 0.197; 98.33% CI 1.20–3.08; MDE ≤ 0.53 or ≥ 1.89 |
| draft configs and arm hashes (Appendix A) | `draft-configs.mjs` | the table above |
| attack plans and sizes (§2.1, §4.1) | `node beds/wbed/attacks/triviality.mjs --rung r1\|r3 --difficulty 3\|4\|5` (dry run) | as cited |
| power table (§7.3) | `node experiments/jit/stats.mjs power` | as cited |
| tests at `93b27ec` | `node --test --test-concurrency=2` on `slice2-wiring`, `slice2-review`, `stream-library` and `beds/wbed/attacks/triviality.test.mjs` | 34 of 34 pass |

## Changelog

- 2026-10-14: first draft (this file). Not frozen.

## Amendments

None (nothing is frozen).
