# Pre-registration: W-bed ladder slice 1 (`wbed-s1`): R1, then R3 (DRAFT, not frozen)

*Draft written 2026-10-14 (about 16:00–17:00 UTC) on branch `claude/intelligent-hamilton-vg1f9a` at `93b27ec`. **$0**: no model
call of any kind (no `claude` CLI, no Jev, no paid stream), `beds/sealed/` not read, no credential read. Inputs:
ATTACK-20261014 §0, §3 (M1, M2, M10), §4, §5; PROOF-LEDGER §B and §K; design/W-BED.md (all); design/FLOW-V3.md;
design/FLOW-V3-SLICE2.md (§1–§17); PAUSE-20261009 §4–§6; SEED-LEDGER.json; ENGINE-FREEZE §5–§6; PREREG-stream §0;
analysis/verify-economics/REPORT.md (at `722c4f0`); DEV-NOTES D22, D25, D27, D30. Paths are relative to the repository root.
Every number tagged **[M]** was computed at $0 by the scripts listed in Appendix B (some committed with the revision below).
Tags: **[M]** measured here; **[code]** read in code; **[doc]** a claim made by a repo document; **[I]** inference; **[U]**
unverified.*

*Revised the same day (about 18:30–19:45 UTC, at `928e27fa`) after an adversarial review of this draft (`d5d9902`), of M1
(`ab256d5`) and of the arm (c) references (`f237e0f`): 2 P0, 4 P1 and 10 P2 findings. §15 gives each finding, its check and
what was done. The fixes that belong to other owners (the R3 bed, the references, M1) landed in `8fcf344`, `928e27fa` and
the autosaves before them; this revision adopts them. Two code changes come with it: the static-arm SDK option
(`static@v3:`, T2; `experiments/jit/stream.mjs`, tests in `experiments/jit/test/static-flow.test.mjs`) and rule CR-W in
code (`analysis/wbed-s1/crw.mjs`, tests in `crw.test.mjs`), which also recomputes every planning number of §7 and §9.1.
Still $0: no model call, `beds/sealed/` not read, no credential read.*

*This is the first paid slice of the W-bed ladder (ATTACK §4.2 days 4–7; W-BED §8–§9). It is a draft: fields marked
**TBD** are listed in §13 with what resolves each. There are two freeze points. **F1** freezes §2 (seeds), §4 (the paid
pre-steps and their rules) and the pre-step caps of §10, before the first pre-step spends anything. **F2** freezes the rest,
with the E2 record of §8, before the first held-out task runs. After a freeze, changes go only in Amendments. This document
makes no comparative claim.*

| Field | Value |
|---|---|
| Experiment id | `wbed-s1` (configs `wbed-s1-r1-a`, `wbed-s1-r1-b`; `wbed-s1-r3-a`, `wbed-s1-r3-b` if R3 runs) |
| Claim tested | Per rung r ∈ {R1, R3}, three steady-state cost ratios are **decided** by rule CR-W (§7.1), in two readings: *conditional* (about the builds the two lineages produced) and *process* (about building with Haiku, with a declared lineage-variance floor). CR1 (a) JIT H/H against (d) the Haiku agent; CR2 (a) against (c) the frozen reference workflow; CR3 (e) Haiku-built-once against (a). Success comparisons are **reported directionally** (§7.3): at K = 2 the decision rule's minimum detectable effect is 39 points at ρ = 0.1. Rung kill rules (§9) are programme switches, not claims |
| Evidence class | Held-out **seeds** of synthetic, Claude-written beds (W-BED O10): not a held-out family, not a sealed bed |
| Rungs | R1 "ledger close" (`wbed-r1` 1.0.0); R3 "statement audit" (`wbed-r3` **1.1.0**; 1.0.0's oracle cannot be passed from the task and is never run) only under the §9.2 gate |
| Arms | (a) `jit:claude-haiku-5-5/claude-haiku-5-5` (no `library`); (e) a Haiku-built-once B1 script as a `static:` arm; (c) the frozen reference workflow as a `static@v3:` arm (flow-v3); (d) `agent:claude-haiku-5-5` |
| K | 2 lineages (streams A and B), 24 tasks each |
| Engine freeze point | **E2, TBD** (§8). The static-arm SDK gap of §8.1 is closed in code (`static@v3:`, T2). E2 still waits for T11 and the stamp itself |
| Freeze commits | F1 TBD; F2 TBD |
| Date | TBD at F2 |

## 0. Summary

- **What runs.** R1 at K = 2: arms (a) H/H, (e), (c) and (d) on held-out seeds 8201–8224 (stream A) and 8301–8324
  (stream B), 16 tasks at d3 then 8 at d4 (W-BED §2.5, §5). R3 runs only if R1 yields an accepted H/H solver in **both**
  lineages, the weekly envelope covers R3's caps, and the quota gates hold (§9.2).
- **Paid pre-steps** (§4), each with its own rule: P0 the triviality/necessity attack (PROOF-LEDGER B11) with an R0
  positive control; P2 the (e) builds; P3 the E2 stamp with G1–G6; P1 a report-only live-judge measurement of the frozen
  references (no revision: the one revision is spent); P4 a capped dev smoke on E2. No held-out seed is touched before
  F2.
- **What is decided.** Three steady-state cost ratios per rung under rule CR-W (§7.1): the structure of `stats.mjs`
  `DECISION_RULE` (validity, K ≥ 2, direction in every stream, a CI that excludes 0) applied to log cost ratios, with
  Bonferroni over the three (98.33% CIs). At K = 2 the between-lineage variance of a lineage-built arm cannot be seen, so
  each ratio gets two verdicts (review finding 4):
  - **conditional**, about the two builds the lineages produced: decidable beyond about 0.53 or 1.87 at 80% power;
  - **process**, about building with Haiku, with a declared floor σ_L = 0.5 per lineage-built arm: decidable beyond about
    0.27 or 3.7 for CR1 and CR2, and 0.18 or 5.7 for CR3.

  Both are projections from R0 records [M, approximate; `crw.mjs plan`]. Only a process verdict may be read as a claim
  about Haiku construction. **Construction cost is not decidable by any test at K = 2** (one lump per lineage). This
  corrects M10 / PROOF-LEDGER K7 ("construction cost ratio, which is decidable"); it is read by a declared dominance rule
  instead (§7.2).
- **What is directional.** Every success comparison, including W-BED H1 (non-inferiority to the reference at δ = 10). The
  rule is computed and printed, and power is declared (§7.3).
- **A blocker found at $0, now fixed in code.** A `static:` arm runs its script on `flow.mjs` v1, because only `JitRun`
  defined `flowPath` [code]. The R1 reference crashes there with `TypeError: flow.phase is not a function` and the R3
  reference on `flow.wide`; both run `ok` on flow-v3 [M]. In a stream, every (c) task would have crashed and fallen back to
  the Haiku interpreter, so arm (c) would silently have become a second Haiku agent. **T2 landed in this revision:** a
  `static@v3:<solve.mjs>` arm runs on flow-v3, and a plain `static:` arm keeps its definition and hash (§8.1 item 1).
- **A bed defect, fixed by its owner.** On `wbed-r3` 1.0.0 the R3 oracle's US-cent totals could not be derived from the
  task: rates were stored at six decimals and printed at four. One-call answers would have failed on totals whatever their
  content, so the R3 attack could never drop R3, and every R3 arm would have failed. `wbed-r3` 1.1.0 fixes it (`8fcf344`;
  PROOF-LEDGER B3). This draft names 1.1.0, and F1 checks the oracle against the frozen reference (§2.6).
- **Shadow floor** (§5, citing M2): `shadowFloor` 0.25 with `shadowOnFlags: true`, the engine as built. M2 shows that at
  24 tasks the floor bounds nothing (39–62% Wilson upper bound at 0 detected), so here it is an unbiased sample for the
  system-view miss estimate, and cost is decided at the realized shadow rate.
- **Spend.** R1 path, pre-steps included: expected about $37–77 list, hard cap $114.5 (§10; the (a) and (d) caps were
  raised after review finding 9). R3: hard cap $121 (shape d3/d4) or $149 (shape d4/d5). The R3 caps fit the $150 weekly
  envelope only in a fresh week (ATTACK §5 decision 6: "R3 is the item that waits").
- **Open.** 23 TBDs (§13), of which T2 is resolved and T3 and T4 are resolved in part. F1 waits for its checklist (§2.6),
  whose open item is T7 (the ≤ 20-line script). F2 waits for T1 (E2 stamp), T4 (the live-judge measurement P1 and the
  freeze record's gaps) and T11.

## 1. Scope

**In the slice:** R1 (and R3 under the gate), arms (a), (e), (c), (d), K = 2, the B11 attack as a paid pre-step, a
report-only live-judge measurement of the frozen references, and the (e) builds.

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

### 2.1 Beds (hashes at `928e27fa`; re-taken at F1 and confirmed at F2)

| bed | version | `index.mjs` sha256 | tree |
|---|---|---|---|
| `wbed-r1` (`beds/wbed/r1/`, shim `beds/wbed-r1/index.mjs`) | 1.0.0 | `b962e4e7140f3a6d…` | `a480061859285ee07c4c2dd30261f4bfd414ea47` (moved from `45ab60fa…` by the M1 review's `invariance.mjs` edits only) |
| `wbed-r3` (`beds/wbed/r3/`, shim `beds/wbed-r3/index.mjs`) | **1.1.0** (`world.mjs` `VERSION`) | `01354fd2225316bf…` | `2316a3a086c7bbbaebef230c045cb8405972658d` |
| shared world `beds/wbed/lib/` | — | — | `00b6c28e4dc57b4044b62a1a821ae7d3b601689a` (`fx.mjs` quantizes the stored rates) |
| `wbed-r0` (P0 positive control only) | 1.0.0 | `2be212715b0d6856…` | `86d047bfe125d3bdb3359a6acc5ef81112375481` (T20: confirmed at F1) |

**R3 is `wbed-r3` 1.1.0, never 1.0.0** (review finding 1, P0). On 1.0.0, `lib/fx.mjs` stored USD-per-unit rates at six
decimals while `lib/domain.mjs` printed four, so the oracle's US-cent totals and `by_reason` amounts could not be derived
from the task. The reviewer found hidden digits in 32 of 32 multiplied quotes, and a different answer from the printed
quotes on 12 of 12 dev tasks; the bed owner counted 70 of 106 non-USD quotes on dev 301–312 and 373–378. One-call answers
would have failed on totals whatever their content, so the R3 attack could never drop R3 and every arm would have failed
R3. The bed owner fixed it in 1.1.0: worlds, statements and reasons are unchanged, and only the printed quotes and the
US-cent totals move. Regression tests in `beds/wbed/lib/lib.test.mjs` and `beds/wbed/r3/r3.test.mjs` check that every
stored rate is its printed line and that the spec's rule at the printed quotes reproduces `by_reason` and the totals.
F1 re-checks this on the slice's own seeds (§2.6). R1 is unaffected (the reviewer: 810 of 810 quotes clean on dev
301–390). R4 1.0.1 and R5 1.0.1 follow for their R3 packs (not in this slice).

R1 task sizes (inline tokens, means over seeds 301–310): 10.0K at d2, 13.9K at d3, 17.7K at d4, 24.1K at d5
(W-BED-R1-NOTES §2) [doc]. On the attack seeds, the driver's dry run gives d3 13,532–15,257 (mean 14,257) and d4
16,819–19,130 (mean 18,184) [M]. R3 on the attack seeds: d3 12,810, d4 39,165, d5 63,163 (means) [M]; every d4 and d5
task is above 32K tokens (W-BED-R2R3-NOTES §6) [doc].

### 2.2 Seeds (SEED-LEDGER W-bed blocks), verified unused

| use | bed(s) | split | seeds | ledger row (status) | purpose | `seedRefusals` |
|---|---|---|---|---|---|---|
| stream A (lineage 1) | wbed-r1, wbed-r3 | test | **8201–8224** | `wbed-heldout-a` (reserved) | `jit-heldout` | 0 of 24 per bed [M] |
| stream B (lineage 2) | wbed-r1, wbed-r3 | test | **8301–8324** | `wbed-heldout-b` (reserved) | `jit-heldout` | 0 of 24 per bed [M] |
| P0 attack (and the $0 oracle-health check of §2.6) | wbed-r0, wbed-r1, wbed-r3 | dev | 379–390 | `wbed-dev` (fresh) inside `kev-probe-pilot` | `jit-dev` | 0 of 12 [M] |
| reference fixtures (seen with labels by the reference author); (e) examples (inputs only) | wbed-r1, wbed-r3 | dev | 373–378 | `wbed-dev` | `jit-dev` | 0 of 6 [M] |
| the references' revision set (R1 development seeds; FROZEN.json `protocol`) | wbed-r1, wbed-r3 | dev | 301–312 | `wbed-dev` | `jit-dev` | not used here |
| P1 reference measurement (report-only, live judges) | wbed-r1, wbed-r3 | dev | **313–324** | `wbed-dev` | `jit-dev` | 0 of 12 [M] |
| P4 dev smoke | wbed-r1 (wbed-r3 if R3 runs) | dev | 325–328 | `wbed-dev` | `jit-dev` | 0 of 4 [M] |

**The records family is coupled to these seeds** (review finding 11). `wbed-r1` builds its customer export from the
records world at the same (seed, split, difficulty): `beds/wbed/r1/world.mjs:51` calls `buildCustomerWorld`, which is
`beds/records/world.mjs` `buildWorld` (`beds/wbed/lib/domain.mjs:10`, `:14`). So `records` at test 8201–8224 and
8301–8324 (and at dev 301–390) is the same world an R1 task embeds. The ledger's W-bed rows do not list `records`, and
`records` at test ≥ 7200 falls in the `test-clean` row, so nothing would refuse a later records stream on these seeds.
T9 adds `records` to the split-out `used` rows at the R1 launch commit (§2.4). R3 does not embed records (its world
imports only `beds/wbed/lib` and its own vocabulary). R4's children use seeds ≥ 1,000,000.

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
   **One exception, disclosed by the review and recorded here for F1.** The reviewer's $0 probe `r3q.mjs` built `wbed-r3`
   1.0.0 worlds at held-out seeds 8201, 8202, 8203 and 8301 to check quote precision. It read only `w.quotes` (the FX quote
   table), saved nothing, and no arm, builder or reference author saw anything. The quotes it read are the 1.0.0 ones, which
   1.1.0 changed. The seeds stay in the plan: no task text, label or outcome was read, and dropping them would move the
   stream's seed blocks for no gain. Any later generation of a W-bed task at a held-out seed before F2 is recorded at F2,
   and a seed whose task text, labels or outcome anyone read is replaced from block C by an amendment.
4. The reference-author tables contain the string `QP-8301` (`beds/wbed/references/author/fixture-answers.json:541`). It is
   a document id in a dev fixture, not a seed.

**Caveat on the dev seeds.** 301–324 and 341–346 were used at $0 to tune the R4 input profile (FLOW-V3-SLICE2 §2.2).
301–312 are the references' revision set, so they are R1 development seeds (FROZEN.json `protocol`). 313–324 were used
at $0 by the references' review for an out-of-sample measurement with generator-world judge readings (refs README "Out of
sample"). 379–390 were used at $0 for the oracle-health check of §2.6 (the frozen references with world readings; no
attack, no model call). All of that is development use of dev seeds, and none of it is evidence here.

### 2.3 Stream shape

- **R1:** idx 0–15 at d3 on seeds base+0…base+15, then idx 16–23 at d4 on base+16…base+23. The base is 8201 (A) or 8301
  (B), as in Appendix A. This holds if P0 admits d3 and d4 (§4.1). Otherwise the §4.1 shape rule applies.
- **R3:** shape d3/d4 or d4/d5, chosen by the §4.1 shape rule from P0's R3 attack before any R1 outcome is read.
- **Second half:** idx 12–23 (12 tasks: 4 at the first difficulty, 8 at the drift difficulty).
- **Steady-state window:** idx 3–23 (21 tasks; warmup 3) for every arm, so that pairs match; a pair's tasks are the rows
  both arms have (§7.1 V).

### 2.4 Ledger edits at launch (TBD T9)

The held-out rows cover all eight W-bed beds, and `jit-heldout` needs fresh seeds. Flipping a whole row to `used` would
refuse R3 and every later rung with `SEED_REFUSED`, the same trap as `jit-r0-fresh` (ATTACK §5 decision 12). So:
- at the R1 launch commit, split `wbed-r1` out of `wbed-heldout-a` and `-b` into rows with status `used`, and list
  `records` in those rows too, because R1 embeds the records world at the same seed (§2.2);
- do the same for `wbed-r3` at R3's launch (R3 embeds no other family);
- do this in the same commit as the configs (the ledger's own rule).

### 2.5 Order of execution

| step | what | split | gate to start |
|---|---|---|---|
| F1 | freeze §2, §4 and the pre-step caps | — | this draft reviewed and the F1 checklist passes (§2.6) |
| P0 | attacks: R0 control; R1 at d3, d4, d5; R3 at d3, d4, d5 (§4.1) | dev 379–390 | F1; quota (§9.6) |
| P2 | (e) builds, two per rung (§4.3) | dev 373–378, inputs only | P0 admitted the rung |
| P3 | stamp E2 (T2 has landed; T11), G1–G6 (§8) | — | P2 done |
| P1 | report-only live-judge measurement of the frozen references, no revision (§4.2) | dev 313–324 | P3 (it runs as a dev config with arm (c) alone on E2) |
| P4 | dev smoke on E2 (§4.4) | dev 325–328 | P3 |
| F2 | freeze the rest: configs, arm hashes, E2 record, reference and (e) shas, `crw.mjs` sha | — | P1 and P4 done, P4 passed |
| P5 | R1 stream A, then stream B (serial) | test | F2; quota; envelope |
| P6 | read R1's gates (§9.1–§9.2) | — | P5 done |
| P7 | R3: P2 builds, P4 smoke, then streams A and B | dev, then test | §9.2 gate |

The R3 attack, measurement and stamp items run with R1's (P0, P1, P3), so R3's shape and admission are fixed blind to
every R1 outcome. R3's builds and smoke wait for the gate, so that no money is spent on a rung that may not run. P1
decides nothing (§4.2), so it is not a gate for anything; it runs before F2 so that its numbers are on record before the
first held-out task.

### 2.6 The F1 checklist (review finding 6)

F1 is not taken, and no pre-step spends anything, until every item holds at the F1 commit. Each item is $0.

1. **Bed versions and the R3 oracle.** `wbed-r1` is 1.0.0 and `wbed-r3` is 1.1.0 or later. The bed regression tests that
   pin the P0 fix pass: every stored rate equals its printed line (`beds/wbed/lib/lib.test.mjs`), and the spec's rule at
   the printed quotes reproduces `by_reason` and the totals (`beds/wbed/r3/r3.test.mjs`). The §2.1 hashes and trees are
   re-taken.
2. **Oracle health of every rung in the slice, against its frozen reference.** On the attack seeds 379–390 at the attack
   difficulties d3–d5, the frozen reference with correct judge readings (policy `world`: each judge answered from the
   generator world, analyst-side) must reproduce the bed oracle's pass. Each failure is classified:
   - a **reference defect** (the oracle accepts the bed's own answer and the reference's differs) is recorded and does not
     block;
   - an **oracle defect** (the task does not determine the oracle's truth) blocks that rung's P0.

   Measured for this revision [M]: R1 36/36 and R3 36/36 pass, with R3's statements and totals equal to the bed
   reference's in 36/36 (`node beds/wbed/references/validate.mjs --rung r1,r3 --seeds 379-390 --difficulties 3,4,5
   --policies world --labels`, 18.6 s, $0, wbed-r3 1.1.0). Out of sample on 313–324 the references' review measured R1
   34/36 (two reference defects: a typo'd name particle outside the reference's fixed list deopts on 320 d4, and gives a
   silent wrong answer on 322 d4) and R3 36/36 (refs README "Out of sample"). So no oracle defect is open. On wbed-r3
   1.0.0 the same kind of check failed the R3 reference on totals in 36/36 tasks (fixtures and 301–312 with author
   readings; FROZEN.json `bedFinding`), which is the defect this item exists to catch.
3. **T7 is done:** a ≤ 20-line deterministic script, written by a session that did not write the bed, scored on
   379–390 at the attack difficulties, fails R1 and R3 (W-BED §2.4 item 2). Open.
4. **Findings 1 and 5 of the review are resolved in this text:** R3 is 1.1.0 (§2.1), and P1 is a report-only measurement
   with no revision (§4.2). Done in this revision.
5. **Seeds.** `seedRefusals` refuses none of the planned seeds, and the prior-use scan of §2.2 is re-run, the review's
   probe disclosure included. At `928e27fa`: 0 refusals for wbed-r1 and wbed-r3 on 8201–8224, 8301–8324, 313–324,
   325–328 and 379–390 [M].
6. **The attack instrument.** The triviality driver's sha256 is re-taken, its dry run names wbed-r3 1.1.0, and the
   `wbed-r0` hash is recorded (T20).
7. **M1 stays off** (§3.2 item 10).

## 3. Arms and configuration

### 3.1 Arms

| arm | builds | runs | construction | lineage |
|---|---|---|---|---|
| **(a) JIT H/H** `jit:claude-haiku-5-5/claude-haiku-5-5` | Haiku interprets warmup tasks 0–2; the Haiku builder compiles flow-v3 from traces (prompt v5; with no library its text is v4's byte for byte, FLOW-V3-SLICE2 §4 item 1 [doc]) | compiled solver on flow-v3; deopt → Haiku interpreter; shadows and adjudication by the arm's interpreter (Haiku); **no Opus fallback** (`compilerFallback: null`); **no `library`** (§3.2 item 6) | warmup interpreter $ + every compile (builder + gateway + host check), recompiles included | the stream |
| **(e) B1 built once, scoring disabled** `static:<build artifact>` | one Haiku 5.5 builder session per lineage (`experiments/c0/construct.mjs`, arm `B1`, the script kit), from the spec and 3 example tasks' **inputs**; `scoreChecks: 0`, so no labels and no traces. This is a variant C0 never measured (§4.3, review finding 13) | the built `solve.mjs` on the default SDK (a B1 script imports only `tools/model.mjs`); deopt, crash, timeout or invalid output → Haiku interpreter (`static:` semantics, `stream.mjs` header) | the build record's `constructionCostUsd` (builder + gateway), cap $3 + $1.5 | the build; build A runs on stream A, build B on stream B |
| **(c) reference** `static@v3:beds/wbed/references/<rung>-reference.mjs` | written once per rung from the rung spec and the labelled fixtures 373–378, plus the bed's exported descriptors (refs README "Protocol" item 5); **frozen by sha256** (FROZEN.json: R1 `b267498f…`, R3 `61e6e623…`); the one revision per rung is spent | the frozen script on flow-v3 (`static@v3:`, T2), judges Haiku first, escalating to Sonnet on a failed check; crash or deopt → Haiku interpreter | authoring cost as recorded (FROZEN.json `authorship`: in-session, about 690K session tokens for both rungs, an estimated $3–6 list, a lower bound); never added to per-task cost | one script for both streams; clustered by stream |
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
6. **(a) runs without `library`** (review finding 12; the first draft made it a library arm in mode `iso`). A library arm
   sends every compiled run through the call host and the run-level resume port, which have never run paid, and the
   dev smoke P4 reaches one compiled task with no deopt, adjudication or recompile. Its only benefit here was to register
   the adopted version with the whole stream's input profile for R4's CUR seed (FLOW-V3-SLICE2 §17 T1), and R4 is outside
   this slice. That profile is a deterministic function of the stream's task inputs (`learnProfile`, §17 T1's test), so
   R4's seed can be registered later at $0 from the committed run directories (T18). Without `library`, (a) at R1 and R3
   is ISO by construction, so B3 measures Haiku building R3 from scratch. W-BED §5's CUR chain through R3 is not run
   (deviation §12 item 9).
7. **(e) uses the C0 B1 script kit, not flow-v3** (deviation §12 item 3). M10 says "Haiku builds B1 once"; C0 measured
   it (B1-haiku 16/16, $2.21 per build, `REPORT-dev.md:26`) [doc]; its kit hash is frozen in E1c (`6bc6b06eccf45cae`,
   ENGINE-FREEZE §6) [doc]. A B1 script imports only `tools/model.mjs`, so it runs in a `static:` arm today. The builder
   may run its script on the 3 unlabelled examples through the gateway (cap $1.5). W-BED §4 says "no runs"; M10 says "no
   traces". This draft adopts M10's reading: no labels, no score and no interpreter answers reach the builder.
   **C0's number is not this arm's basis** (review finding 13): C0's B1 16/16 at $2.21 had 12 oracle-scored checks.
   With `scoreChecks: 0` the kit is unchanged, so the builder prompt still says "You have at most 0 score checks"
   (`experiments/c0/prompts.mjs:12`) and `tools/score.mjs` is still shipped (`construct.mjs:108`), while the service
   refuses every call (`scoreLimit: 0`, `construct.mjs:103`). (e) is therefore a new, unvalidated variant; §4.3 records
   what the build did with the score tool.
8. **Example seeds for (e):** build A gets 373–375 and build B gets 376–378, at the stream's first difficulty. Two
   different example sets make the lineages more independent.
9. **Shadow floor:** §5.
10. **`jit.invariance` (M1) is off.** Its adoption rule has not passed: PROOF-LEDGER K4 is open on (i) and (ii). The
    first entry's "N on (i) for records' in-distribution relations" was withdrawn after the same review (its finding 3:
    a partly measured relation counted as "not caught"). The relation labels were corrected by M1's owner (records and
    R1 `duplicate-row` are now `out`; PROOF-LEDGER K4 "Review fixes").
11. **Concurrency 2, streams serial** (A then B), and each stream runs alone with at most one $0 agent beside it
    (ATTACK §4.1 items 4–5, §4.3).

## 4. The paid pre-steps and their rules

### 4.1 P0: triviality and necessity attack (PROOF-LEDGER B11), a paid gate with its own rule

**Plan.** `beds/wbed/attacks/triviality.mjs` (sha256 `726c187e…` at `93b27ec` and at `928e27fa`): 12 attack seeds
(379–390) × effort `none` and `medium` × one `claude-haiku-5-5` call with the task inline (B0-call system prompt), through
the in-repo route: `b0Call` arms in `runExperiment` with a journaled `createModelPort` and `envFaultRule: true` (driver
output) [code]. The driver records each bed's `family.version`; **an R3 attack row on `wbed-r3` 1.0.0 is void**, because
that oracle fails every answer on totals (§2.1). The R3 sizes were first taken on 1.0.0; the dry run on 1.1.0 gives the
same means (12,810 / 39,165 / 63,163 tokens at d3 / d4 / d5) [M], so the costs below stand.

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
   - W-BED §2.4 item 2, a ≤ 20-line deterministic script, must also fail. It is $0, not yet built, and an F1 item
     (§2.6 item 3; T7).
5. **Validity.** A call that ends in an environment fault (`ENV_FAULT_CODES`) is retried once. A difficulty with more than
   25% of its calls still impaired is re-run at the next quota window; it is never read. Schema-invalid output is a fail,
   not a fault.

The attack's outcomes are dev evidence. They gate admission and fix the shape, and they enter no claim.

### 4.2 P1: a report-only measurement of the frozen references (arm c; W-BED §2.3; review finding 5)

The first draft planned a paid validation on dev 301–312 with one revision below 10/12. That plan conflicts with the
freeze and is withdrawn:
- **The one revision is spent.** The stub validation on 301–312 met W-BED §2.3's "< 10/12" trigger (stub judges answer
  wrongly by construction), and each rung got its one revision (FROZEN.json `protocol`; refs README "Protocol followed"
  items 2–4).
- **301–312 are development seeds.** The author saw their inputs, every judge question (to write author readings), and,
  analyst-side, pass/fail and per-part comparisons with `referenceSolve` (FROZEN.json `authorship.seen`). R1's three
  revision fixes came from 311 d3, 308 d4, 301 d4 and 303 d3.
- **"One revision" is a window, not a single edit.** The autosave history shows R1's birth-date reader in three states:
  v1 (`history/r1-reference.v1.mjs`, sha256 `9e3f36b3…`) `/birth|dates?\b/i`; autosave `b1135cd` (15:51 UTC) `/birth/i`;
  the frozen file (`f030fbc`, 15:56; sha256 `b267498f…`) `/birth|numeric dates?/i` [M, `git show`]. Whether the
  intermediate state was run against 301–312 is not recorded, and v1's raw validation output was not committed. So the
  revision count is "one revision window with at least one intermediate state", and the in-sample numbers are in-sample
  in the strongest sense. FROZEN.json does not list the intermediate state; that record is the references' owner's (T4).
- **The authoring route is now recorded** (FROZEN.json `authorship`): Claude Opus 5.5 as a subagent of this
  workflow-orchestrated session, not a `claude -p` builder session, with no model call during authoring or validation;
  about 1 hour; about 690K session tokens for both rungs, an estimated $3–6 at list price, and a lower bound only. The
  author also saw the beds' exported `difficulty` descriptors, which list the generator's trap catalogue and rates (refs
  README "Protocol" item 5; §11 item 2).

**What is measured, at $0, so far.** In sample (fixtures 373–378 and 301–312, d3–d4, author readings): R1 36/36 and R3
36/36 on wbed-r3 1.1.0. Out of sample (313–324, d3–d5, judges answered from the generator world): R1 34/36, with a deopt
on 320 d4 and a silent wrong answer on 322 d4 (both a typo'd name particle outside the reference's fixed list); R3 36/36.
On the attack seeds 379–390, d3–d5, with world readings: R1 36/36, R3 36/36 (§2.6 item 2). These measure the frozen code
with correct readings. They do not measure live judges.

**P1, the paid part: report-only.**
- **What runs.** Each frozen reference, as arm (c) alone in a dev stream config on E2 (`static@v3:`, so P1 also exercises
  T2), on dev 313–324 at the stream's two difficulties (24 tasks per rung), with live judges: Haiku first, Sonnet on a
  failed check. Scoring is by the oracle, analyst-side. Cap $2 per rung.
- **Rule.** No revision, whatever the score. Nothing from P1 or P5 reaches the author. P1 reports: the live pass rate per
  difficulty, the deopt and fallback share, the judge calls and dollars per task, and the Sonnet share. Its numbers are on
  record before F2.
- **What it changes.** Nothing in this pre-registration. A low live pass rate makes KR-1 (§9.1) lenient, not invalid:
  "H/H more than 10 points below the reference" is harder to reach against a weak reference. That is reported beside KR-1
  and S1.
- **Authoring cost** (the human-curation proxy) is the FROZEN.json estimate above, labelled a lower bound. It is reported
  beside (c) and never added to per-task cost.

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
  - **The score tool** (review finding 13). The kit still ships `tools/score.mjs` and the prompt says "at most 0 score
    checks". The build record's `scoreLog` must be empty or hold only refusals; any refused attempt is counted and
    reported. A score that reached the builder would void the build (it would be a label). The kit is not edited, so its
    E1c hash (`6bc6b06eccf45cae`) stands; a prompt without the score lines would be a kit change and is the owner's call
    (T23).
- **Never shown to the builder:** oracle output, labels, interpreter answers or any held-out input.
- **Its basis.** (e) is "B1 with scoring disabled", which C0 never ran; C0's 16/16 at $2.21 had 12 oracle-scored checks.
  Nothing in this slice reads C0's number as (e)'s expectation.

### 4.4 P4: dev smoke on E2 (engine validity, not evidence)

- **What runs.** One stream config per rung, cloned from Appendix A with `split: dev`, seeds 325–328 at the first stream
  difficulty, `seedPurpose: jit-dev`, from the E2 worktree. Every arm runs. (a) runs through its first compile and one
  compiled task. Cap $8 per rung.
- **Pass condition, all required:**
  - every arm writes 4 rows and no harness error;
  - (c) delivers `compiled` (not `fallback`) on at least 3 of 4, and its compiled trace shows flow-v3 events, which
    tests T2 live;
  - (e) runs its build artifact (`scriptSha` matches P2);
  - (a)'s first prompt-v5 compile completes, accepted or not, and its compiled run executes on flow-v3;
  - no row has `costUnknown` except one booked at its bound and explained;
  - no unexplained environment fault.
- **On failure.** Any engine fix re-stamps E2 (§8) and re-runs P4. Smoke rows are dev, never pooled and never read for
  outcomes.
- **What P4 does not cover.** (a) reaches one compiled task, so a deopt, a flagged shadow, an adjudication and a
  recompile on E2 are covered only by the stub stream tests. That is one reason (a) runs without `library` (§3.2 item
  6): the call host and the resume port would add paths that neither P4 nor any paid run has reached.

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
  - computed over idx 3–23, on the tasks both arms of a pair have (§7.1 V);
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

**Rule CR-W** (two-sided; `DECISION_RULE`'s structure applied to cost; PREREG-stream rule CR made two-sided). It is in
code: `research/jit-20261008/analysis/wbed-s1/crw.mjs` (`crw`, and `decideRuns` over the stream run directories), with
tests in `crw.test.mjs`; its sha256 is frozen at F2 (T3).
- **V (validity):** neither arm is invalid in either stream by the env-fault rule (`stats.mjs` `envFaultCheck`) or the
  truncation rule (§9.4: rows missing without a fault line on more than 25% of planned tasks). The pairs of a stream are
  the **intersection** of the idx 3–23 rows both arms have, and every stream must keep at least 16 of its 21 planned
  steady-state tasks (75%). The first draft required identical task sets, so any spend stop voided all three ratios even
  below the truncation limit (review finding 9).
- **K:** K = 2 streams (lineages).
- **F (direction):** each stream's ratio (Σ SS of X over Σ SS of Y on its pairs) is on the same side of 1 as the pooled
  ratio.
- **C (conditional CI):** the 98.33% CI of the pooled log ratio excludes 0. The CI is the wider of two:
  - a two-stage cluster bootstrap (streams, then tasks within each stream);
  - the paired-task bootstrap (stratified by stream) widened by √Deff, with Deff = 1 + (m − 1)ρ, ρ = 0.1 (`RHO_PREREG`),
    m = the mean pairs per stream (21 when complete), so Deff = 3.0. This applies when a lineage-built arm is in the pair.
- **P (process CI):** C's CI with a declared lineage floor added in quadrature to each half-width:
  half-width_P = √(half-width_C² + (z · σ_P)²), σ_P = σ_L · √(n_L / K), σ_L = **0.5**, where n_L is the number of
  lineage-built arms in the pair: 1 for CR1 ((a) vs (d)) and CR2 ((a) vs (c), whose script is the same in both streams),
  2 for CR3 ((e) and (a) are both built per lineage).
- **Verdicts.** For each of C and P: "X cheaper than Y" (V, K, F hold and the CI lies below 0), "X dearer than Y" (above
  0), otherwise "directional, no decision"; or "invalid" when V fails on validity.
  - A **conditional** verdict is a statement about the solver versions and builds the two lineages produced: "on these
    builds, X ran cheaper than Y".
  - A **process** verdict is the only one that may be read as a claim about building with Haiku.
  - Every report prints both, with the realized ratio per stream.

**Why two verdicts** (review finding 4, P1, confirmed). At K = 2 the between-lineage variance of a lineage-built arm's cost
cannot be estimated: each lineage is one compiled solver lineage or one (e) build, and W-BED O4 records compiled cost
varying 20–40× within one compiler. A task-only CI is therefore valid for the realized builds but not for the process
that made them. The reviewer's null simulation, with a lineage effect on the JIT arm that K = 2 cannot see, gave false
decisions on 6–21% of trials at σ_L = 0.5 and 25–35% at σ_L = 1.0, against a nominal 1.67% per ratio (`crw-sim.mjs`,
reproduced here). The same null through the committed rule (`node …/crw.mjs oc`, 1,000 trials per cell, 300 bootstrap
draws, σ_task 0.5 / 0.75) [M]:

| lineage-built arms | true σ_L | task-only CI decides (all false, read as process claims) | task-only CI decides with the wrong sign for the realized builds | process verdict (floor 0.5) decides (all false) |
|---|---|---|---|---|
| 1 | 0 | 0.0% / 0.2% | 0.0% / 0.2% | 0.0% / 0.0% |
| 1 | 0.25 | 3.6% / 1.1% | 0.0% / 0.0% | 0.0% / 0.0% |
| 1 | 0.5 | 18.0% / 8.1% | 0.0% / 0.0% | 0.5% / 0.9% |
| 1 | 1.0 | 33.1% / 21.6% | 0.0% / 0.0% | 11.7% / 7.8% |
| 2 | 0.5 | 23.1% / 13.6% | 0.0% / 0.0% | 0.6% / 0.3% |
| 2 | 1.0 | 36.8% / 28.4% | 0.0% / 0.0% | 11.2% / 11.3% |

Rates are shares of all trials. So the task-only CI is right about the builds (wrong sign ≤ 0.2%), and the process
verdict holds its level up to the declared floor and is anti-conservative beyond it. That residual is declared, not fixed: K = 2 cannot test it.

**Why σ_L = 0.5** [M, from committed rows; `node …/crw.mjs anchors`, pinned by `crw.test.mjs`]. The steady-state log
cost ratio of a JIT arm against the Haiku agent, for the same arm on the same family in two runs: records H/H 0.43 (dev 201–224) and 0.65 (R0,
225–236), a difference of 0.23; kinetics O/H 1.52 (dev) and 2.31 (R0-K), a difference of 0.79. Across three compilers on
the same records seeds the log ratios span 0.39–0.55, and on kinetics 1.49–1.53. Each difference also holds task noise and
config changes, so it overstates σ_L, and a difference of d between two lineages corresponds to σ_L ≈ d/√2: about 0.16
(records) and 0.56 (kinetics). 0.5 covers both. A larger σ_L cannot be ruled out at K = 2 (T15).

**Not taken.** "Reserve CR decisions for K ≥ 4" (the reviewer's third option): K = 4 is a later owner decision (held-out
blocks C and D stay reserved, §2.2), and the conditional verdict is worth having at K = 2 as long as it is labelled.

**Clustering.** Pairs that involve (a), (e) or (c) are clustered by lineage (stream). `crw.mjs` clusters by stream for
every pair, and `decideRuns` takes n_L from the declaration above (`--lineage-arms`), because a `static:` spec cannot say
whether its script was built per lineage. `stats.mjs` `pairRows` would cluster static arms by task
(`experiments/jit/stats.mjs:143`) [code]; it is not used for cost.

**Planning power** [M, approximate; method of PREREG-stream §0.2; `node research/jit-20261008/analysis/wbed-s1/crw.mjs
plan`, pinned by `crw.test.mjs`]:
- **Data.** R0 records (dev 225–236, K = 1, records not R1), H/H against the Haiku agent on idx 3–11 (9 paired tasks):
  SS $0.118 vs $0.0614 per task, ratio 1.92.
- **Projection.** The task-bootstrap SD of the log ratio, 0.242, is scaled to K = 2 × 21 tasks and widened by √3.0. That
  gives a conditional SE of 0.194. The first draft's 0.246 and 0.197 came from a different bootstrap generator.
- **CIs at the R0 ratio:** conditional 98.33% CI 1.21–3.06 (95% CI 1.31–2.81); process (n_L = 1) 98.33% CI 0.73–5.05.
- **Power** at 80% with Bonferroni:
  - conditional: decides ratios ≤ 0.53 or ≥ 1.87;
  - process, CR1 and CR2: ≤ 0.27 or ≥ 3.69 (SE 0.403);
  - process, CR3: ≤ 0.18 or ≥ 5.67 (SE 0.536).

  The first draft's "decides ≥ 1.89" was the conditional figure, stated as if it were a process claim.
- **Reading.** If R1 behaves like records (ratio about 1.9), CR1 is likely decided "dearer" for the realized builds and
  left undecided at the process level [I]. CR2 and CR3 compare an unshadowed static arm with a shadowed JIT arm, so large
  ratios are likely, and a process decision needs one beyond about 3.7× (CR2) or 5.7× (CR3) [I]. No ratio from W-bed data
  exists yet.

### 7.2 Construction cost: a dominance reading, not a test

Construction spend is one lump per lineage: two numbers per arm at K = 2. No test at α = 0.05 exists on two paired
lumps; the exact sign test's smallest one-sided p is 0.25. So M10 / PROOF-LEDGER K7's "construction cost ratio, which is
decidable" does not hold (deviation §12 item 7).

**Declared reading,** (e) against (a), per rung:
- **"(e) dominates on construction"** if (e)'s construction spend is at most half of (a)'s **in each lineage**;
- **"(a) dominates"** if the reverse holds;
- otherwise "mixed".

It is labelled "dominance, not a test" wherever it is reported. Three things are reported beside it: both lineages'
lumps, the (e) build success, and the 24-task CPS (which includes construction). Like a conditional CR verdict, it
describes the two builds and two compile histories this slice produced, not construction by Haiku in general (§7.1).

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

1. **Static arms on flow-v3 (T2): landed in this revision.**
   - **Measured** [M]: the R1 reference under `DEFAULT_FLOW` (`flow.mjs`, the SDK a `static:` arm gets) ends `crash`,
     `SCRIPT_ERROR`, `TypeError: flow.phase is not a function`, $0. Under `FLOW_V3` it ends `ok` (stub gateway policy A,
     dev seed 325 at d3, $0.0031 stub cost).
   - **Coverage gap.** Of the three primitives the references use beyond v1, `flow.mjs` v1 defines none (`flag`, `phase`,
     `wide`) and flow-v2 defines `flag` only [code]. So R3's reference (`flow.wide`) fails the same way.
   - **Fix** (`experiments/jit/stream.mjs`). A `static@v3:<solve.mjs>` spec parses to a static arm with `sdk: 'v3'`, and
     `ArmRun.flowPath` passes flow-v3 to `runCompiled` for it. `sdk` enters the arm definition (so the hash) and the slug
     (`…-v3`) only when given. A plain `static:` arm passes no `flowPath`, exactly as before, so its definition and hash
     are unchanged. Any other `static@…` form is refused as an unknown arm kind.
   - **Tests** (`experiments/jit/test/static-flow.test.mjs`, 4 tests; all 4 fail on the pre-fix tree with "unknown arm
     kind" and pass after):
     - the R0/dev static arm keeps `ca4f763d5d03568e`, and `static@v3:` differs only by `spec` and `sdk`;
     - through `runStream` with fakes, the v3 arm passes `flowPath` = flow-v3 and the plain arm passes none;
     - end to end, sandboxed, with the real `runCompiled`, the real bed tasks and oracle and the references' stub
       gateway (author fixture 373, d3): the R1 and the R3 references each `crash` as a plain static arm (and fall back)
       and run `ok`, delivered `compiled`, as `static@v3:`.
   - The existing pins stay green: the JIT suite is 359 tests, 358 pass and 1 todo (`V1_HASHES`, `slice2-review` T5).
2. **Rule CR in code (T3): landed, outside `stats.mjs`.** `research/jit-20261008/analysis/wbed-s1/crw.mjs` implements
   §7.1: the SS definition of §6, the intersection and 75% rule of V, a CI `level` (98.33%), the two-stage cluster
   bootstrap and the √Deff widening, the lineage floor, two-sided conditional and process verdicts, and `decideRuns` over
   the stream run directories (env-fault and truncation rules). `crw.test.mjs` has 8 tests. It imports `stats.mjs`
   (`envFaultCheck`, `designEffect`, `normQuantile`, `RHO_PREREG`) without changing it, so PREREG-stream's hash of
   `stats.mjs` is untouched. Its sha256 is frozen at F2. A port into `stats.mjs` as `decideCost` is optional and shared
   with PREREG-stream §0.6 item 2.
3. **(a) without a fallback compiler.** `compilerFallback: null` normalizes (Appendix A), and the compile path skips the
   fallback when `fb` is null (`stream.mjs:1124`) [code]. A stub stream test must confirm that no fallback compile is
   attempted (T11).

### 8.2 The record (each value from the launch commit)

| item | candidate value at `93b27ec` (re-taken at the stamp) | source |
|---|---|---|
| commit, root tree; pushed or tagged (an unpushed kit commit is a single copy, ATTACK §0) | TBD | `git rev-parse` |
| `experiments/jit` tree | `249226da1da504c5e84f65a76bbce420f86915f5` at `93b27ec`; moved since by the M1 review and by T2 (`stream.mjs`, `test/static-flow.test.mjs`) | — |
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
| analysis scripts: `research/jit-20261008/analysis/wbed-s1/crw.mjs` (rule CR-W, T3), `stats.mjs` (imported by it), `report.mjs` `ff586a40…`, `durability.mjs` `527ee6e1…`, triviality driver `726c187e…` | re-hash | `sha256sum` |
| arm hashes of the 8 (or 16) test-split arms; every static arm's `scriptSha` non-null and equal to the frozen file | T8 | `parseArm(spec, normalizeConfig(cfg))` |
| unchanged pins: `V1_HASHES` (dev-records-1, dev-kinetics-1), R0 records and R0-K arm hashes (`slice2-review` T5) | green | test suite |

### 8.3 Gates at the stamp (as E1c's, ENGINE-FREEZE §6)

- **G1 engine:** the table above; frozen paths clean.
- **G2 suites:** `node --test --test-concurrency=2 experiments/jit/test/*.test.mjs` (332 tests at FLOW-V3-SLICE2 §17.7;
  359 at this revision, T2's 4 in `static-flow.test.mjs` among them), `crw.test.mjs` (8), the main suite,
  `experiments/lib`, the `beds/wbed` R1/R3 tests and `beds/wbed/references`.
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
- **The R3 reference's `wide` has never met live judges** (refs README "What remains paid"). P1 is its first live run,
  on E2, before any R3 stream; its wall-clock and the first-item-alone latency are reported there.
- **Not exercised here:** the registry and the call host (item 6, item 7: no arm has `library`, §3.2 item 6); D10's
  `textLabel` (no agent nodes); C9 stall restarts (`stallMs` off, §17.3); I2's bed side (R5 only); env faults inside a
  library child during the compile host check (§17.3).

## 9. Kill rules, stop rules and validity

### 9.1 Rung kill rules (programme switches, read at P6 and after R3; W-BED §3, PAUSE §6)

**KR-T, triviality** (§4.1): the shape rule admits no stream shape, because one Haiku call passes ≥ 3/12 at either effort
at some difficulty of every allowed shape. The rung is dropped before any arm runs.

**KR-1, rung negative for Haiku construction.**
- **Rule** (PAUSE §6). H/H's second-half success (idx 12–23) is more than 10 points below the reference's in **both**
  lineages, which means at least 2 of 12 tasks in each.
- **Pooled reading.** W-BED §3.1's "over both streams" reading (at least 3 of 24 pooled) is reported beside it.
- **Measured behaviour** [M], from independent binomials (an upper bound on false kills under positive pairing;
  `crw.mjs kill`, pinned by `crw.test.mjs`):

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

R3 runs only if all five hold:
1. R1 adopted an accepted H/H version in **both** lineages (stricter than W-BED §8; with exactly one, R3 waits and the
   split is reported);
2. P0 admitted an R3 shape, on `wbed-r3` 1.1.0;
3. week-to-date list spend plus R3's caps (§10) is ≤ the $150 weekly envelope (ATTACK §5 decision 6);
4. the quota gates of §9.6 hold;
5. the R3 oracle is still reproducible at the R3 launch commit (review finding 1): `wbed-r3` is the version F1 froze, its
   regression tests of §2.6 item 1 pass, and if any `beds/wbed/lib` or `beds/wbed/r3` path moved since F1, the §2.6
   item 2 oracle-health check is re-run on 379–390 and on the stream's two difficulties.

If 3 or 4 fails, R3 waits for the next window under this unchanged pre-registration. If 5 fails, R3 does not run until
the bed owner fixes the bed and this document is amended.

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

- **Spend stops** (§10) are hard: `armSpendStopUsd` per arm and `spendStopUsd` per stream. An arm stops *starting* tasks
  once its recorded spend exceeds its cap (`stream.mjs` `begin`), so the task in flight, a compile included, can overshoot
  by up to one compile ($6 at the caps, $9 with a recheck).
- **Truncation rule.** An arm truncated by its cap on more than 25% of planned tasks is "invalid: truncated" (ATTACK §5
  decision 11; `crw.mjs` `decideRuns`: rows missing without a fault line). Below that, the cost ratios are decided on the
  paired tasks that remain (§7.1 V), and the truncation is reported beside them.
- **No raises, ever, once P5 starts** (review finding 10). The first draft allowed a raise between streams A and B "made
  without reading any outcome"; once stream A has run, nobody can show that, so the caps of §10 are fixed at F2 for both
  streams. A cap that turns out wrong is a finding, reported with the truncation.

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
| (d) Haiku agent | R0 records: $0.104 per task, max $0.244 [M]; R1 is about 2× the inline tokens; R1-NOTES §5 gives $0.12–0.18 [I]; R3: $0.25–0.50 at d3–d4 [I] | $2.9–4.3 | **$10** | $18 | $24 |
| (c) reference | stub-gateway token estimate $0.0028–0.0035 per R1 task and $0.001–0.014 per R3 task, plus about $0.0001 per judge call for the `claude-cli` overhead (refs README "Stub gateway"; D22); plus Haiku fallbacks at about $0.15 each (the out-of-sample deopt share was 1/36 on R1) | $0.1–1 | **$3** | $3 | $4 |
| (e) runs | static C0 on records: $1.21 for 24 tasks (D25); plus fallbacks | $0.5–3 | **$5** | $6 | $8 |
| (a) H/H | R0 records, 12 tasks: $6.62, of which compile $5.41 in 2 compiles ($3.83, $1.59), steady state $0.118 per task [M]; dev H→H, 24 tasks: $6.12 measured + $2.00 imputed, 4 versions (D25); W-BED §9: $6–20 | $8–18 | **$24** | $25 | $30 |
| `spendStopUsd` (per stream) | sum of the arm caps | — | **$42** | $52 | $66 |
| (e) build (per lineage, P2) | $3 builder + $1.5 gateway; C0 B1-haiku $2.21 (with scoring, §4.3) | $2–4.5 | **$4.5** | $4.5 | $4.5 |

**How the caps were set** (review finding 9). A cap stop truncates an arm, and the first draft's V clause then voided all
three cost ratios. V now decides on the paired tasks that remain while each stream keeps ≥ 75% (§7.1), and the caps sit
where a stop means something:
- **(d)** at about 2.3× the R1 upper expectation (the first draft's $6 was 1.4×, and R0's most expensive agent task was
  2.3× its mean). A (d) stop would be an accident, not a finding. R3's (d) cap is 1.5× the [I] upper expectation at
  d3/d4 (24 × $0.50 = $12); at d4/d5 it is what the $150 envelope allows ($24), against an expectation nobody has
  measured.
- **(a)** at a declared compile allowance: warmup about $1.5, four compiles at about $4.5 (R0's were $3.83 and $1.59;
  the per-compile cap is $6, $9 with a recheck), and 21 steady-state tasks at about $0.25 with flags shadowing every run.
  An (a) stop therefore means more than about four compiles, which is itself a construction-cost finding (KR-2, KR-3).
  The engine has no compile-count bound (`stream.mjs` recompiles every `recompileOnDeopts` deopts until the cap); a
  `jit.maxCompiles` knob would change (a)'s semantics against W-BED §4 and is the owner's call (T22).

**Totals:**

| item | expected | hard cap |
|---|---|---|
| P0 attacks (R0, R1, R3; §4.1) | $4.5–5 | $9 |
| P1 reference measurements, report-only (R1, R3; §4.2) | $0.5–2 | $4 |
| P2 (e) builds, R1 × 2 | $4–9 | $9 |
| P3 G4 smoke | $0.04 | $0.45 |
| P4 dev smoke, R1 | $5–8 | $8 |
| P5 R1 streams, K = 2 (sum of the per-stream expectations above, × 2) | $23–53 | $84 |
| **R1 path** | **≈ $37–77** | **$114.5** |
| R3 (P2 builds + P4 smoke + streams), d3/d4 | ≈ $35–70 [I] | $9 + $8 + $104 = $121 |
| R3, d4/d5 | ≈ $50–100 [I] | $9 + $8 + $132 = $149 |

The expectations sit in ATTACK §4.2's range for days 4 and 6–7 ($15–35 plus $25–60); the caps are stop-losses above
them. R3 cannot share a week with R0-K and R1 under the $150 envelope at either shape. That is the gate in §9.2 item 3.

## 11. Threats to validity

1. **Authorship correlation** (W-BED O10). Claude wrote the beds, oracles, references, prompts and thresholds, and
   Claude models fill every role. A shared misreading can sit in generator, oracle and reference at once.
2. **Arm (c) is ceiling-like, and more so than W-BED §2.3 allows.** Its author saw labelled fixtures (373–378), one
   revision window on 301–312 with per-part comparisons against `referenceSolve` (§4.2), and the beds' exported
   `difficulty` descriptors, which list the generator's trap catalogue and rates (refs README "Protocol" item 5). The JIT
   and (e) see no labels (W-BED §2.3).
3. **The reference is template-aware, and its independence from the generator is unverified** (review finding 14).
   `r1-reference.mjs:443–452` hard-codes the system notes' fixed sentences as regular expressions: the records system-note
   templates (`beds/records/render.mjs:550–567`) and one `FLAG_NOTE` template (`:385–406`, "Nobody ever bought anything
   through a row marked …, so it is void"). The author could read them in the fixtures, but matching them verbatim works
   only because the generator never rewords them. Its comment at `:614–617` states the generator's namesake design ("the
   export plants namesakes whose dates agree only under the wrong reading"), which the records README describes and which
   is not on the
   author's "seen" list. A reference that knows the templates is a stronger ceiling than "a spec and a few labelled
   examples". The file's header (`:12–13`, "unanimous evidence … overrides a contradicting answer") contradicts its code
   (`:614–617`: evidence never overrides the notes; a contradiction gets one Sonnet second opinion). The header is inside
   the frozen bytes, so it is recorded here, not edited; the refs README describes the code.
4. **Arm (c)'s ceiling, measured at $0.** With correct judge readings, the frozen R1 reference deopts or answers wrongly
   on 2 of 36 unseen tasks (313–324; Wilson 95% 1.5–18%), one of them silently (refs README). With live judges it can only
   be lower. P1 measures it (§4.2).
5. **The static arms are unverified.** (c) and (e) carry no shadows, so their cost advantage is partly the absence of
   verification. §5 item 4 and §7.4 report L1 so that this is visible.
6. **Fallbacks blur the static arms.** A crash in (c) or (e) delivers a Haiku agent answer. The fallback share is
   reported, and a high share means the arm measured the agent.
7. **K = 2, ρ and σ_L unmeasured.** ρ = 0.1 and σ_L = 0.5 are assumed (T15). With two clusters, between-lineage variance
   is unobservable: construction cost is not tested (§7.2), and a cost ratio is read as a claim about Haiku construction
   only through the process verdict, whose level holds up to σ_L = 0.5 and not beyond (§7.1).
8. **The same seeds across rungs and families.** R1 and R3 share held-out seed numbers, but they generate different
   worlds. R3 reuses R1's billing dialects (R2R3-NOTES §8 item 10). R1 embeds the records world at the same seed (§2.2).
9. **Profile tuning on R1 dev seeds** (301–324) affects R4's reuse fence, not R1 itself. It is irrelevant here.
10. **Quota attribution.** The meter is shared, so arms are priced in list dollars, not in meter ticks (W-BED O5).
11. **Platform drift.** The claude CLI version (2.1.299) and the cloud host are recorded. Laptop rows are not mixed in.
12. **Selection.** R3's existence depends on R1's accepted-solver gate. R3's rules, shape and admission are fixed blind
    to R1's outcomes (§2.5), so the gate selects on a design property, not on R3 data.
13. **The planning projection is from records**, not R1, and from 9 tasks of one lineage.
14. **(e) is a new variant** (§4.3): C0 never ran B1 without scoring, and its builder is told about a score tool that
    refuses every call.

## 12. Deviations from W-BED, ATTACK and M10

1. Slice = R1 (+R3), not R1–R4. There is no CUR/ISO pair, so H3 is not tested (ATTACK §4).
2. No R0 interleave in the streams: not built (§1).
3. (e) is built with the C0 B1 script kit, not on flow-v3 (W-BED §4 (e)), its builder may run unlabelled examples
   (§3.2 item 7), and the kit's score lines stay in its prompt with scoring disabled (§4.3).
4. (e) has no input-profile fence. M10's "runs under the profile" is not built for static arms; (e) has `static:`
   semantics only.
5. (c) and (e) are not shadowed (static arms).
6. Bonferroni over three decided cost ratios, each with a conditional and a process verdict (§7.1). W-BED §8 decided
   success; ATTACK decides only cost.
7. Construction cost is read by dominance, not tested (§7.2). This corrects M10 and PROOF-LEDGER K7.
8. W-BED §3.1's falsifier is applied in PAUSE §6's per-lineage form, with the pooled form reported (§9.1).
9. (a) runs without `library` at both R1 and R3, so it is ISO by construction. W-BED §5's CUR chain through R2 and R3
   is not run, and R4's CUR seed is registered later at $0 (§3.2 item 6; T18).
10. `gatewayModels` are {Haiku, Sonnet} for every arm. W-BED §4 (a) says "Haiku judges"; this draft matches the
    reference's escalation tier instead (§3.2 item 2).
11. The first W-bed streams run on held-out seeds, after a dev smoke on E2 (§2.2, §4.4).
12. The references were authored in-session by an Opus 5.5 subagent, not in one `claude -p` Opus session, with no model
    call; the author also saw the beds' `difficulty` descriptors (FROZEN.json `authorship`; §4.2, §11 items 2–3).
13. P0 attacks three difficulties per rung, not one, and adds an R0 positive control (§4.1).
14. The references get no paid validation with a revision (W-BED §2.3): their one revision was spent on the stub
    validation, so P1 is a report-only measurement on unseen dev seeds (§4.2).
15. The rule's V clause decides on the intersection of paired tasks, not on identical task sets (§7.1).

## 13. TBDs and what resolves each

| id | TBD | resolved by | blocks |
|---|---|---|---|
| T1 | E2 record values (§8.2) | stamping from the launch commit in a frozen worktree after T11, with G1–G6 | F2 |
| T2 | static arms on flow-v3 | **resolved in this revision**: `static@v3:` (§8.1 item 1), 4 tests; P1 and P4 test it live | — |
| T3 | rule CR-W in code | **resolved in part**: `analysis/wbed-s1/crw.mjs` (`crw`, `decideRuns`), 8 tests; its sha256 at F2. A port into `stats.mjs` (`decideCost`) is optional and shared with PREREG-stream §0.6 item 2 | F2 (the sha) |
| T4 | reference freeze record | **resolved in part**: FROZEN.json and the README exist (shas, authorship, protocol, $0 measurements in and out of sample). Open: the intermediate revision state (`b1135cd`) in FROZEN.json, which is the references' owner's (§4.2); P1's live-judge numbers | F2 |
| T5 | (e) artifacts and build records (2 per rung), the score tool's log included (§4.3) | P2 | F2 |
| T6 | attack outcomes: admission and shapes for R1 and R3; the R0 control | P0 | P2 |
| T7 | W-BED §2.4 item 2: a ≤ 20-line deterministic script fails R1 and R3 | $0: write and score one on 379–390 (a session that did not write the bed) | **F1** (§2.6 item 3) |
| T8 | final configs and test-split arm hashes (`scriptSha` with T5; the drafts of Appendix A already use `static@v3:` and no `library`) | `parseArm(spec, normalizeConfig(cfg))` at F2 | F2 |
| T9 | per-bed ledger rows for `wbed-heldout-a` and `-b`, with `records` listed in the R1 rows (§2.2, §2.4) | the launch commit of each rung | P5, P7 |
| T10 | R3 shape (d3/d4 or d4/d5) | P0's shape rule (§4.1) | P7 |
| T11 | `compilerFallback: null` exercised end to end | an explicit stub stream assertion that no `fallback-compile` event occurs. Today it is checked only implicitly: `refusals.test.mjs` sets `null` and counts 2 compiles where a fallback compile would make 3; G3 | F2 |
| T12 | whether R3 runs | §9.2 at P6 | P7 |
| T13 | W, the cost of a wrong delivery (K11) | the owner; reported only if declared | — |
| T14 | latency budget (K17) | the owner; p50 and p95 reported regardless | — |
| T15 | ρ and σ_L | assumed 0.1 and 0.5 (§7.1); the slice reports the observed between-lineage spread and does not amend either | — |
| T16 | owner confirmation of §3.2 and of this draft (the delegation's scope is [U], ATTACK §5) | the owner | F2 |
| T17 | quota readings at each paid start | G5 at each start | each P step |
| T18 | R4's CUR seed: register each lineage's adopted R1 and R3 versions with the whole stream's input profile | a $0 tool over the committed run directories (`learnProfile` on the stream's task inputs, as `relearnLibrary` does), or `library.from` as a list; R4's own pre-registration | R4 (not this slice) |
| T19 | structural-fidelity extractor (W-BED §6.3, build step 3) | reported only if it exists at F2 | — |
| T20 | the `wbed-r0` hash for the positive control | F1 (candidate in §2.1) | P0 |
| T21 | M2 is under concurrent edit | re-cite REPORT.md at F2 (now `722c4f0`); §5 changes only by amendment | F2 |
| T22 | a compile-count bound for (a) (`jit.maxCompiles`) | the owner: it would change (a)'s semantics against W-BED §4; without it the $24 cap is the bound (§10) | — |
| T23 | a B1 prompt without the score lines for (e) | the owner: a kit change (the E1c B1 kit hash moves); without it (e) is "B1 with scoring disabled" (§4.3) | — |

## 14. What remains paid

Everything below is the orchestrator's to run with the owner's token. Nothing here was run.

1. **P0 attacks:** about $4.5–5 (cap $9). This is PROOF-LEDGER B11's paid half.
2. **P1 reference measurements:** about $0.5–2 (cap $4), report-only, on dev 313–324 (§4.2). This is B10's live-judge
   number; the freeze itself is done.
3. **P2 (e) builds** for R1: about $4–9 (cap $9). This is K7.
4. **P3 G4 live smoke on E2:** about $0.04.
5. **P4 dev smoke** for R1: cap $8.
6. **P5 R1 streams** at K = 2: about $23–53 (cap $84). This covers B1 and K7.
7. **Conditional on §9.2:** R3 builds, smoke and streams: cap $121 (d3/d4) or $149 (d4/d5). This covers B3.

Later, outside the slice: R4 (H3), R2, (b), (e′), (c′), and K = 4 on held-out blocks C and D.

## 15. Review round (2026-10-14): findings, checks and outcomes

The review read M1 (`ab256d5`), the arm (c) references (`f237e0f`) and this draft (`d5d9902`) at $0 and reported 2 P0, 4
P1 and 10 P2. Each finding was checked here before acting on it: by re-running the reviewer's script where there was one,
by reading the cited code, or by a test that fails on the pre-fix tree. Findings in other owners' files were left to them
and are reported with their status at `928e27fa`. Nothing was rejected outright. Where a finding offered several fixes,
the one taken and the reasons for the others are given.

| # | rating | finding | check here | outcome |
|---|---|---|---|---|
| 1 | P0 | The R3 oracle cannot be passed from the task (rates stored at 6 decimals, printed at 4), the draft never gates on it, and the R3 attack can never drop R3 | FROZEN.json `bedFinding`; bed tests at `928e27fa`; the frozen reference with world readings on 379–390 d3–d5 passes R3 36/36 on 1.1.0 | **Fixed.** Bed: `wbed-r3` 1.1.0 by its owner (`8fcf344`, with regression tests). Here: §2.1 names 1.1.0; an attack row on 1.0.0 is void (§4.1); F1 checklist items 1–2 (§2.6); R3 gate item 5 (§9.2). The reviewer's interim "do not run the R3 attack" is moot on 1.1.0 |
| 2 | P0 | A `static:` arm runs flow.mjs v1, so arm (c) silently becomes a Haiku agent | `stream.mjs` read; the reviewer and the first draft's probe agree | **Fixed in code** (T2): `static@v3:`; `experiments/jit/test/static-flow.test.mjs`, 4 tests, all failing on the pre-fix tree; the JIT suite 359 tests, 358 pass, 1 todo, pins green (§8.1 item 1) |
| 3 | P1 | M1's "upper bound 0%" counted a partly measured relation as "not caught"; PROOF-LEDGER K4's "N on (i)" is unsupported | `eval-invariance.mjs` `rowFlags` at `928e27fa`: a relation is pending when any variant is unmeasured | **Owned by M1** and fixed there (K4 now "open on (i) and (ii)"). Here: §3.2 item 10 no longer cites the withdrawn N |
| 4 | P1 | CR-W is anti-conservative at K = 2: unseen lineage variance gives 6–21% (σ_L 0.5) and 25–35% (σ_L 1.0) false decisions against 1.67% | the reviewer's `crw-sim.mjs` re-run: 21.0 / 6.0% and 34.5 / 25.5%; the committed rule's own null table in §7.1 | **Fixed** (§7.1): two verdicts (conditional on the realized builds; process with a declared floor σ_L = 0.5 per lineage-built arm, anchored on committed runs), restated power (conditional ≥ 1.87; process ≥ 3.69 or ≥ 5.67). In code with tests: `analysis/wbed-s1/crw.mjs`, `crw.test.mjs`. The third option, "decide only at K ≥ 4", was not taken: K = 4 is a later owner decision, and a labelled conditional verdict is worth having |
| 5 | P1 | P1's "validation" with a revision is not one: the revision is spent, 301–312 were seen, R1's reader passed through an intermediate state, and the draft called FROZEN.json missing | FROZEN.json `protocol` and `authorship`; `git show` of the reference's history (three reader states) | **Fixed** (§4.2): P1 is a report-only live-judge measurement on unseen dev 313–324 with no revision; the $0 out-of-sample check the reviewer asked for exists (the references' owner, policy `world`: R1 34/36, R3 36/36); the revision window and the authoring route are recorded. **Deferred to the references' owner:** the intermediate state `b1135cd` in FROZEN.json (T4) |
| 6 | P1 | Nothing in F1 checks the bed, the unvalidated path or T7 | — | **Fixed** (§2.6): the F1 checklist, with the oracle-health check measured (R1 36/36, R3 36/36 on 379–390) and T7 now blocking F1 |
| 7 | P2 | M1 distribution labels: kinetics `shuffle-documents` and records/R1 `duplicate-row` mislabelled `in` | PROOF-LEDGER K4 "Review fixes" (2) | **Owned by M1**, fixed there (labels audited by `beds/lib/metamorphic.test.mjs`). M1 is off in this slice |
| 8 | P2 | M1 relation checks stricter than the oracles; the synthetic panel counts a crash as a flag | `beds/records/invariance.mjs:42` (`compareRecords`) still compares the fields exactly at `928e27fa` | **Owned by M1**, open there at `928e27fa`. M1 is off in this slice, so nothing here depends on it |
| 9 | P2 | Any spend stop voids all three cost decisions; (d)'s $6 and (a)'s $20 are tight | `stream.mjs` `begin` (an arm stops starting tasks above its cap) and `worstCase` | **Fixed:** V on the intersection with ≥ 75% per stream (§7.1, tested); (d) $10, (a) $24 as a declared compile allowance (§10). The "bound (a) by compile count" option needs an engine knob that changes (a)'s semantics: left to the owner (T22) |
| 10 | P2 | A cap raise between streams A and B cannot be shown to be outcome-blind | — | **Fixed:** no raises once P5 starts (§9.4) |
| 11 | P2 | `wbed-r1` embeds the records world at the same seed; the ledger rows do not list `records` | `beds/wbed/r1/world.mjs:51` → `beds/wbed/lib/domain.mjs:10,14` → `beds/records/world.mjs` `buildWorld`; records test ≥ 7200 is in `test-clean` | **Recorded** (§2.2, §11 item 8). **Deferred to T9:** `records` is listed in the R1 `used` rows at the launch commit, where the ledger's own rule puts ledger edits |
| 12 | P2 | (a) as `library: iso` sends every compiled run through paths never run paid, for R4's benefit only | FLOW-V3-SLICE2 §17 T1 (the stream profile is `learnProfile` on the stream's inputs); the drafts validate without `library` | **Fixed:** (a) runs without `library` (§3.2 item 6); R4's seed is registered later at $0 (T18). The alternative "widen P4" was not taken: it costs more and still covers one stream's paths |
| 13 | P2 | (e)'s basis is not comparable: with `scoreChecks: 0` the prompt says "at most 0 score checks" and `tools/score.mjs` ships | `experiments/c0/prompts.mjs:12`, `construct.mjs:103`, `:108` | **Recorded** (§3.2 item 7, §4.3, §11 item 14): (e) is "B1 with scoring disabled", a new variant; its score log is a build-record item. **Deferred:** a prompt without the score lines is a kit change (T23) |
| 14 | P2 | The reference is template-aware (hard-coded note sentences, the namesake design) and its header contradicts its code | `r1-reference.mjs:12–13`, `:443–452`, `:614–617`; `beds/records/render.mjs:385–406`, `:550–567` | **Recorded** (§11 items 2–3, deviation 12). The header is in the frozen bytes and is not edited; the refs README describes the code |
| 15 | P2 | PROOF-LEDGER K7 still says construction cost is "decided at K = 2" | — | **Fixed** in PROOF-LEDGER K7 (this commit) |
| 16 | P2 | The new defaults might move existing arm hashes | the pins (`V1_HASHES`, `slice2-review` T5) green after T2 | **No change needed**, as the reviewer found |
| — | disclosure | The reviewer's probe built R3 worlds at held-out 8201–8203 and 8301 (quotes only) | — | **Recorded** for F1 (§2.2 check 3); the seeds stay |

**Counts.** Fixed here: 2, 4, 5 (in part), 6, 9 (in part), 10, 12, 15, and 1 (this document's part). Fixed by their owners:
1 (the bed), 3, 7. Recorded: 11, 13, 14. Deferred, with reasons: 5's FROZEN.json item (T4), 9's compile-count knob
(T22), 11's ledger edit (T9), 13's kit change (T23). Open with M1's owner: 8. No change needed: 16.

## Appendix A. Draft configuration (R1, lineage A), validated at $0

Seed lists are abbreviated with "…"; the config holds every seed.

```json
{
  "experiment": "wbed-s1-r1-a",
  "familyId": "wbed-r1", "split": "test", "seedPurpose": "jit-heldout",
  "segments": [ { "difficulty": 3, "seeds": [8201, "…", 8216] }, { "difficulty": 4, "seeds": [8217, "…", 8224] } ],
  "arms": [ "agent:claude-haiku-5-5", "static@v3:beds/wbed/references/r1-reference.mjs",
            "static:<P2 build artifact, lineage A>", "jit:claude-haiku-5-5/claude-haiku-5-5" ],
  "gatewayModels": [ "claude-haiku-5-5", "claude-sonnet-5-5" ],
  "jit": { "warmup": 3, "shadowFloor": 0.25, "shadowOnFlags": true, "recompileOnDeopts": 2, "maxTraces": 8,
           "compilerFallback": null, "compare": "unordered", "preserveRefusals": true },
  "compile": { "builderEffort": "high", "builderBudgetUsd": 3, "gatewayUsd": 1.5, "checkUsd": 1.5, "minutes": 30,
               "compare": "tolerant", "relTol": 0, "absTol": 0, "acceptance": "strict", "minPartial": 0.9,
               "promptVersion": 5, "acceptanceIds": "exact" },
  "perTaskUsd": 1, "agentBudgetUsd": 2, "agentMinutes": 15, "compiledMinutes": 20,
  "staticFallback": "claude-haiku-5-5", "concurrency": 2,
  "spendStopUsd": 42,
  "armSpendStopUsd": { "jit:claude-haiku-5-5/claude-haiku-5-5": 24, "agent:claude-haiku-5-5": 10,
                       "static@v3:beds/wbed/references/r1-reference.mjs": 3, "static:<P2 artifact A>": 5 },
  "persist": { "commitDir": true }
}
```

- **Variants.** Lineage B uses 8301–8324 and build B. R3 uses `familyId: wbed-r3`, `static@v3:…/r3-reference.mjs` and
  the shape and caps of §10.
- **Validation.** `normalizeConfig` accepted all four drafts (R1/R3 × A/B) with the spend fields: the seed ledger checks,
  `compilerFallback: null`, prompt version 5 without `library`, and `armSpendStopUsd` keyed by the `static@v3:` spec.
  Draft arm hashes from `parseArm` at this revision [M]:

| config | (d) agent | (c) reference, `static@v3:` | (e) static (`scriptSha` null: no artifact yet) | (a) JIT H/H, no `library` |
|---|---|---|---|---|
| wbed-s1-r1-a | `0cdf176fd8c32a2b` | `5f0afedce5ba6602` | `73088e2313b419aa` | `89c1c741913b6ad9` |
| wbed-s1-r1-b | `0cdf176fd8c32a2b` | `5f0afedce5ba6602` | `c4f8038cbff01cee` | `3a2a29e14e5232ae` |
| wbed-s1-r3-a | `9610dfd5119584c3` | `621adc5e2e8bb308` | `53014e3ac5542eb5` | `8f09e3914328f7dd` |
| wbed-s1-r3-b | `9610dfd5119584c3` | `621adc5e2e8bb308` | `8e899d47a1d97f47` | `01580249e92c2a63` |

The agent and reference hashes are equal across lineages. The JIT hashes differ only by `jit.shadowSeed` (= the
experiment name). The first draft's (c) and (a) hashes (`5e27f342…`, `9fc917eb…`; `6b6a722a…`, `508c66bc…`, `5d05166d…`,
`aac4531a…`) belonged to the plain `static:` reference and the `library: iso` JIT arm, both withdrawn. Every hash is a
draft: T5 sets `scriptSha`.

## Appendix B. $0 computations behind this draft

None calls a model.

**Committed** (this revision):

| what | script | result |
|---|---|---|
| rule CR-W, both verdicts, V on the intersection, `decideRuns` (§7.1, §9.4) | `analysis/wbed-s1/crw.mjs`; `crw.test.mjs` (8 tests) | the rule as written |
| R0 planning projection (§7.1) | `crw.mjs plan` | SS $0.118 vs $0.0614 (9 tasks), ratio 1.92; conditional SE(log) at K = 2 0.194, 98.33% CI 1.21–3.06, decidable ≤ 0.53 or ≥ 1.87; process ≤ 0.27 or ≥ 3.69 (CR1, CR2), ≤ 0.18 or ≥ 5.67 (CR3) |
| operating characteristics under the null (§7.1) | `crw.mjs oc` | the table in §7.1 |
| the σ_L anchors (§7.1) | `crw.mjs anchors` | records H/H 0.43 and 0.65; kinetics O/H 1.52 and 2.31 |
| kill-rule behaviour (§9.1) | `crw.mjs kill` | the table in §9.1 (unchanged) |
| static arms on flow-v3 (§8.1) | `experiments/jit/test/static-flow.test.mjs` (4 tests) | plain `static:` R1 and R3 references crash; `static@v3:` runs them `ok` |

**Run, not committed** (session scratchpad):

| what | script or command | result |
|---|---|---|
| seed check and prior-use scan (§2.2, §2.6 item 5) | `prereg/seeds-check.mjs` (first draft), `prereg2/seeds-313.mjs` (this revision) | 0 refusals on every planned range for wbed-r1 and wbed-r3; no prior W-bed run artifact |
| static-arm SDK probe (§8.1) | `prereg/static-flow-probe.mjs` | `DEFAULT_FLOW`: crash, `TypeError: flow.phase is not a function`; `FLOW_V3`: ok |
| oracle health on the attack seeds (§2.6 item 2) | `node beds/wbed/references/validate.mjs --rung r1,r3 --seeds 379-390 --difficulties 3,4,5 --policies world --labels` | R1 36/36, R3 36/36 (statements and totals 36/36) |
| the review's CR-W null simulation (§7.1) | the reviewer's `review/crw-sim.mjs`, re-run | 0–0% at σ_L 0; 3.3/0.5% at 0.25; 21.0/6.0% at 0.5; 34.5/25.5% at 1.0 (σ_task 0.5 / 0.75) |
| draft configs and arm hashes (Appendix A) | `prereg2/draft-configs2.mjs` | the table above |
| the R1 revision window (§4.2) | `git show <commit>:beds/wbed/references/r1-reference.mjs` over its history | three birth-date reader states |
| T2 against the pre-fix tree (§8.1) | `static-flow.test.mjs` on a `git archive` of `928e27fa` | 4 of 4 fail ("unknown arm kind") |
| attack plans and sizes (§2.1, §4.1) | `node beds/wbed/attacks/triviality.mjs --rung r1\|r3 --difficulty 3\|4\|5` (dry run) | as cited |
| power table (§7.3) | `node experiments/jit/stats.mjs power` | as cited |

## Changelog

- 2026-10-14: first draft (this file). Not frozen.
- 2026-10-14, later the same day: revised after the adversarial review (§15). Not frozen.

## Amendments

None (nothing is frozen).
