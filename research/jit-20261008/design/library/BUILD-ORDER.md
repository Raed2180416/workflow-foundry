# BUILD-ORDER: what to build first, and why

*Library design, 2026-10-09. Goal: W-bed arm (g), library-first construction by Haiku, can run on R1–R3 within days,
alongside the W-BED first run (W-BED §9) so that its comparator arms (a) JIT H/H, (c) reference, (d) Haiku agent are
shared on the same seeds. Proposed code location: `experiments/library/` (new; nothing outside this design directory is
written by this document). Tags as in LIBRARY.md.*

## 0. Order in one paragraph

Build the parts that make library-first construction *possible and checkable* at $0 first (store, index, 12 executable
cards, code ranker, composition checker, constructor loop with a scripted model, retro sweep), then spend: a $0.1 Jev
read of the corpus retrieval test once the owner agrees, a ≈ $3 one-lineage pilot of arm (g) on R1, and then the L3 cells
with the W-BED first run. Jev ports are built as *request builders and ledger rows* immediately but gate nothing until
L4/L8 say so. Engine nodes (cross-run state first) are a separate column that the library does not block on.

## 1. $0 steps (agent-days; each ends with green tests)

| # | build | depends on | tests | why now |
|---|---|---|---|---|
| 1 | **Store and index.** Per-project library directory: `registry.jsonl` (generalised `createRegistry`: status, index, tags, provenance), `index.jsonl` (one row per item with the code-generated line, tags, shape vector, BM25 text), `revocations.jsonl`, `evidence.jsonl`, `judgments.jsonl` (`JudgmentLedger`). L1 cards loaded from `cards/Pxx/{card.json, skeleton.mjs, fixtures/}` | `call-host.mjs`, `profile.mjs`, `src/judgment.mjs` (exist) | T1, T8 | everything reads it |
| 2 | **L0 card as a prompt asset** with a token counter; the per-call cap table (LIBRARY §5.2) as code that refuses an oversized prompt | 1 | T2 (partial) | the budget is a hard rule, so it is code from day one |
| 3 | **The 12 first-slice cards as executable modules**: P01, P03, P07, P08, P09, P12, P13, P15, P16, P17, P20, P54 (L1-PATTERNS §4), each with a slot schema and positive / no-match / drift fixtures run through the flow-v2/v3 replay override and a stub gateway | 1; flow-v3 slice 1 (exists, commit 0050e1c) | T4 (36 fixtures) | these are exactly the patterns R1–R3 need (L1 §4); all tier S (L1 §7), so no engine work |
| 4 | **Composition checker** (LIBRARY §6) and the L1 §9 universal codes, run over assembled solvers | 3 | T3 (one mutant per code) | without it a filled skeleton is unchecked authoring again (C0 O4) |
| 5 | **Shape features + code ranker** (LIBRARY §4.2–4.3) incl. companions from `out/pattern-evidence.md`; the L2 harness over the corpus (gold = census `needs`) | 1, census outputs (exist) | T9; L2 arms A1–A3 | the production default until any Jev port is promoted |
| 6 | **Constructor loop** S1–S11 with a **scripted model** (canned TaskSpec, pattern plan, slot values), end to end on W-bed R1–R3 fixture tasks (seeds 373–378) | 2–5 | T2 (full) | proves the loop, budget and checker before any Haiku dollar |
| 7 | **Jev port request builders** for the five ports + failure class (JEV-PORTS §2–§7), the option audit, ledger meta fields, the `noul`/`score` answer converter for `src/judgment.mjs` | 1 | T6; unit tests of request shape (no label, no baseline verdict in state, as the J1 scorer's test) | logging must exist before the first live construction so every judgment is labelled later |
| 8 | **Retroactive sweep** over flow-v3 journals and call-host events (LIBRARY §7.5) | 1; `experiments/heal/replay.mjs` (exists, IR workflows) | T5 | the heal claim the owner named; cheap to build while nothing is in production |
| 9 | **Audits:** L1-a 60-item hand audit and detector precision; L6-a checklist-vs-known-failures | census outputs | L1-a, L6-a decisions | the coverage number must not leave this directory unaudited |
| 10 | **Quarantine baseline** (regex) and the 200-item planted set generator | 7 | T7 | needed before any skill or corpus text is indexed |

Estimate: steps 1–8 ≈ 3–5 agent-days [I]; 9–10 ≈ 1 day [I].

## 2. What is deliberately not built first

- **The other 42 cards as executable modules.** A card is made executable when a rung or a user task first retrieves it
  (L1-PATTERNS §10). A card nobody retrieves is the utility problem in miniature (THESIS P5) [M].
- **Embeddings as a dependency.** `bge-small` is an L2 arm only; the production ranker is code (LIBRARY §4.3).
- **L2 from corpus conversions** (LIBRARY §11 objection 4).
- **Skill wrapping** (LIBRARY §3.6): needs `flow.agent` (D) and the quarantine port; after R5.
- **Any engine node.** Arm (g) is solver-only (tier S); see §5 for the engine column.

## 3. Paid steps (in order; each needs its own go-ahead where it spends the owner's accounts)

| # | step | cost | gate before it | output |
|---|---|---|---|---|
| P1 | L2 arm A4: Jev stage-A re-ranking on 1,524 corpus summaries + the stripped variant subsample; arm A5 Haiku on 200 | Jev ≈ 1,700 requests (≈ $0.1) [I]; Haiku ≈ $0.3 [I] | owner OK for Jev spend (TypeSafe account); steps 5, 7 | decision on Jev ordering at S5; first L8 rows |
| P2 | **arm (g) pilot**: gP3 on R1, one lineage, 12 tasks (dev seeds 301–312), Haiku | ≈ $2–4 [I] | steps 1–8 green | does a library-built R1 solver pass the oracle; real per-call token counts vs the caps |
| P3 | L1-b executable coverage on 40 oracle-bearing corpus items | ≈ $4–8 [I] | P2 shows the loop works live | the executable coverage number |
| P4 | **L3 cells** g0, gP3, gP8, gB3 on R1–R3 × K = 2 (seeds 301–348), with the W-BED first run's (a), (c), (d) | ≈ $25–50 [I] + W-BED's own budget | prereg note for the W round (W-BED §8) amended to add arm (g) | the owner's question for library-first construction |
| P5 | L4 wrong reuse on L3's accepted solvers | ≈ $8–25 [I] | P4 | which gate may serve reuse; the kill threshold armed |
| P6 | L5 overburden, L6-b checklist ablation | ≈ $35 [I] | P4; `lib-probe` seeds 391–400 entered in the ledger by the orchestrator | default k; whether checklists stay |
| P7 | L7 utility at 50 / 500 / 1,500 | ≈ $10 [I] | P5 | library caps |

## 4. Tie to the W-bed rungs and FLOW-V3

| rung (W-BED §3) | what the library needs there | patterns (tier) | flow-v3 status | library step |
|---|---|---|---|---|
| R0 no-workflow control | `route` must answer `none`; applicability must not reuse an R1 solver on an R0 task | — | — | step 6 (S3), L4 offers R0 tasks |
| R1 ledger close | first slice: P01, P03, P13, P16, P17, P20 | S | flow-v2 + `call` (built) | steps 3–6, P2 |
| R2 inbox router | P07, P08, P09, P05; injection documents route to `ignore` | S | built; P09 wants the `flow.flagged` accessor (L0 changes note) | steps 3–6, P4 |
| R3 statement audit | P12, P14, P15, P17 | S | built | P4 |
| R4 group consolidation | P53, P54, P31 (child memo); L2 reuse of R1–R3 components (CUR) | S | `call` built (slice 1) | P4 (gB3), P5, P7 |
| R5 legacy dump | P45, P47, P35; skill wrapping | D | `flow.agent` designed (FLOW-V3 §2.2), not built | after FLOW-V3 slice 2 |
| R6 wide research table | P19, P18, P49 | D | `flow.wide` / `flow.plan` designed (FLOW-V3 §2.3–2.4) | after slice 3 |
| R7 effects, waits, approvals | P21, P26–P29, P32–P34, P37, P38, P42 | IR / HOST / N | engine (parked, W-BED §3.7) | effect-plan only; envelope patterns proposed, not run |
| R8 faults (overlay) | heal for drift (f1), env-fault classification (f2), injection (f3); **retro sweep** for latent defects | — | deopt kinds exist; local deopt `interpret-child` designed (FLOW-V3 §1.5) | steps 7–8; L6-b |
| RH held-out (kinetics) | wrong reuse across domains | — | — | L4 cross-domain uses kinetics dev 201–224; RH itself only in a prereg round |

## 5. The engine column (outside the library; ordered by corpus items unblocked)

From L1-PATTERNS §7 [M-c; census revision 1, a candidate generator, not a measurement]: items blocked only by unbuilt
engine nodes, per node. If the owner wants the buildable share to move from 48.4% (65.6% with host triggers) toward the
census ceiling of 96.9% not refused (97.8% without the dashboard criterion; the measured coverage is AUDIT-L1's 88.4%,
Wilson 75.0–95.1%), the order is:

| order | engine node (L0 row) | patterns | items unblocked (can overlap) |
|---|---|---|---|
| 1 | `state` (27): cross-run seen-set / cursor / counter, one writer, TTL | P42, P39 | 144 (+26) (157 before revision 1) |
| 2 | `wait.signal` (19) with timeout routing | P33 | 108 |
| 3 | `session` (29) with capped memory | P43 | 104 |
| 4 | `admission` (28) | P40 | 56 |
| 5 | `stream` (30) | P44 | 27 (39 before revision 1) |
| 6 | `compensate` (23), continue-as-new (P31) | P30, P31 | ≈ 9 (P30 has zero genuine support) |

This work is ROADMAP Phase 6 and breaks the engine freeze for any round in flight (W-BED §3.7, ROADMAP rule 13) [M], so
it is listed, not scheduled. In the host-harness deployment, triggers (P36–P38) are the host's and need no engine node
(LIBRARY §1).

## 6. Objections (where the evidence argues against parts of this plan)

1. **The utility problem.** Libraries slow systems down and rarely trigger on diverse work: APC "persistently low" hit
   rates, Muscle-Mem 50–67% misses, AWO only 5.6–11.9% fewer calls, GAC refusing to compile without recurrence
   (landscape R01 §1.5) [M]. Answer in this plan: L1 is small and capped, L2 grows only from verified runs, retrieval is
   capped at 20, and L7 measures the problem rather than assuming it away. Residual risk: the per-project L2 may simply
   never get reused on a diverse owner workload, in which case the library's value is L0 + L1 (template mode) alone.
2. **SkillsBench.** Curated skills +16.2 pp, self-generated −1.3 pp (v1; https://arxiv.org/abs/2602.12670) [M via
   FRONTIER-GAPS G3]. L1 is curated (good); L2 crystallised from own runs is the self-generated case unless verification
   is real. Hence verify-before-store from a reset environment and L3's gB3 cell to measure it.
3. **C0's 11/16.** Haiku authoring from a description lost to a script (11/16 vs 16/16) (W-BED §10 O1) [M]. Library-first
   construction is a different condition (choose and fill, not author), but the risk is the same skill: writing correct
   slot bodies. If L3's gP3 does not beat g0, the library is not what was missing; the slots are.
4. **The 0/21 wrong-reuse disaster** (docs/RESEARCH.md:98; THESIS §6) [M]. This is why reuse is off by default until L4
   passes, why the kill threshold is armed from the first reuse, and why the sweep relabels admits retroactively.
5. **Jev is not independent of Claude** (φ 0.61 with Haiku, 36 of 40 shared errors on the same wrong option;
   independence README) [M], and a $0 probe beat it in-family on two J1 ports [M]. Jev therefore starts as a logged shadow
   signal, cannot serve as a verifier, and must beat code baselines per port (JEV-PORTS §1.4) before it orders or gates
   anything.
6. **The Haiku context price cliff.** Haiku costs 5× above a 100K-token prompt (`policy/models.json`) [M], and context rot
   hits small models hardest (THESIS P8) [M]. The design never comes near it: the largest call is 8,000 tokens by
   construction (LIBRARY §5.2), and T2 asserts it. The real risk is the other direction: caps too tight for a hard slot,
   which L5 measures.
7. **Buildable ≠ explained.** 48.4% of corpus items are buildable on today's engine (L1-PATTERNS §7) [M-c]. "Replaces
   n8n" is a claim about the solver half for now; the envelope half waits on §5.

## Implementation status

Steps 1–4 of §1 are built in `experiments/library/` (2026-10-09; commits 88473c7, f22f1a3, 7a11979, 297c3f6 on
`claude/intelligent-hamilton-vg1f9a`), step 9 (the audits) was run (0d9d329, AUDIT-L1; both decisions FAIL), on
2026-10-14 the L1 revision and the L0 card fit were applied (below), and on 2026-10-14 steps 5, 6, 7, 8 and 10 were built
(6fbfa54, 76fb7e3, d8f73ef, 2dd6ace, f39ac21; "Steps 5–8 and 10" below). All of it cost $0: no model or Jev calls, no
network, and nothing under `src/`, `experiments/jit/` or `experiments/lib/` changed. Tests:
`node --test --test-concurrency=2 experiments/library/test/*.test.mjs` runs 90 tests, all green (about 25 s on 4 vCPU).

| step | files | tests |
|---|---|---|
| 1 store and index | `store.mjs` (registry, revocations, evidence, judgments and index JSONL; the §7.1 states and transitions; verify-before-store and keep gates; circuit breaker; requalify; retire), `index.mjs` (code-generated index lines ≤ 30 tokens, `shape/1` features, `buildIndex`), `cards.mjs`, `schema.mjs` (validation through `src/validate.mjs`; conservative subsumption), `tokens.mjs`, `tools/build-catalog.mjs` → `cards/catalog.json` (54 entries; rebuilt from census revision 1), `tools/calibrate-tokens.mjs` → `fixtures/token-calibration.json` | T1 4, T8 7, counter 3 (14) |
| 2 L0 and caps | `context.mjs`: the §5.2 cap table as code; `assemblePrompt` refuses with `CONTEXT_OVER_CLASS_BUDGET` (or `CONTEXT_PART_NOT_ALLOWED`) and never truncates; `l0Card()` | T2 partial 4 (the L0 card now fits; the full T2 is step 6) |
| 3 cards | `cards/P01 P03 P07 P08 P09 P12 P13 P15 P16 P17 P20 P54/{card.json, skeleton.mjs, fixtures/{positive,no-match,drift}.json}`, `skeletons/helpers.mjs`, `assemble.mjs` (typed slot checks, `fn:pure` lint, `solve.mjs` assembly), `run.mjs` ($0 runner) | T4 17 (all 36 fixtures pass; every drift fixture deopts with its expected kind and name) |
| 4 checker | `check.mjs` (`checkTree` / `checkSolver`) | T3 28: the clean reference tree and the 12 card examples fire nothing; 24 mutants cover all 18 codes and each fires exactly its own code |
| 5 retrieval | `retrieve.mjs` (§4.3 steps 1–6: hard filters, `shape/1` feature rules, BM25, top companion by lift, profile pre-check beside L2/L4 candidates, cut to 20 by 2 × rules + BM25 rank-normalised + 0.5 × companion, order logged), `l2.mjs` + `tools/l2-harness.mjs` → `out/L2-code-arms.{json,md}` (arms A1, A2 and a popularity floor on the corpus, the stripped variant and the W-bed fixtures; platform-clustered bootstrap CIs); `index.mjs` `shape/1` reads tabular text as item lists | T9 8 (no threshold; numbers below; the L2 falsifier is met) |
| 6 constructor | `construct.mjs` (S1–S11, `scriptedModel`), `fixtures/construct-scripts.mjs` (R0–R3 scripts), `run.mjs` `solverStub`, `store.mjs` `bindStub` | T2 full 8: 24 constructions on W-bed R0–R3 fixture tasks (seeds 373–378), every prompt within its cap; oversized prompts refused, never cut; S1, S5, S8, S9, S3, S11 paths |
| 7 Jev ports | `jev.mjs` (request builders for applicability, pattern choice A/B, slot completeness, risk class, quarantined read, failure class; code baselines; decision rules; option audit; `portVersionOf`; `ledgerRows`; `fromJevAnswer` noul / score / choice) | T6 + request shape 5: no label, src or target in a question; no hash, name, evidence, verdict, rank or score in any state; every backticked path resolves; 17 choice questions pass the audit |
| 8 sweep | `sweep.mjs` (§7.5 steps 1–7, `latentDefectSignal`, run log `runs.jsonl` / `child-journal.jsonl` / `sweeps.jsonl`, `runsFromCallLog` for a stream `calls.jsonl`), `run.mjs` journal replay override, `store.mjs` suspect-aware evidence | T5 4: suspect set = brute-force set (8 of 24) on a two-level `flow.call` tree; callers marked; 8 ledger rows relabelled; $0 |
| 9 audits | `research/…/design/library/AUDIT-L1.md`, `out/L1-audit*`, `out/L6-audit.json`, `out/audit-scripts/` | L1-a FAIL (coverage 88.4%, Wilson 75.0–95.1%; rule precision 0.73); L6-a FAIL (6 of 21 recorded failures named) |
| 10 quarantine | `quarantine.mjs` (regex baseline b1, `screenOutsideText`, `plantedSet`, `evaluateBaseline`), `tools/quarantine-baseline.mjs` → `out/T7-quarantine-baseline.json` | T7 2 (no pass rule): recall 0.39, false positives 0.07 |

**L1 revision 1 (2026-10-14; PAUSE-20261009 §4 step 4, AUDIT-L1 §8).** The census tool
(`design/library/tools/pattern-census.mjs`) now defaults to revision 1; `REVISION=0` reproduces the 2026-10-09 outputs
byte for byte (checked). (1) The six support-only detectors with hit precision below 0.5 (P02 0.23, P16 0.31, P17 0.08,
P18 0.18, P30 0.00, P49 0.31) are off: their patterns stay in the catalog with no census evidence (evidence grade U,
P30 D). (2) P37 split: GitHub Actions and GitLab CI push, pull-request and other repository-event starts, and those
platforms' `webhook-trigger` token, are P38; P37 282 → 163 items, P38 252 → 350. (3) Owner decision PAUSE §5.8
(taken: both readings, the conservative one first): Node-RED items with ≥ 20 `ui_*` widgets are refused as
"interactive dashboard state" (14 items), and the run writes the reading without the criterion beside it. (4) The 15
L6-a lines are in L1-PATTERNS §4, §5 and §9 and in the `card.json` checklists of P03, P09, P16 and P20 (each with its
failure id and `repo:` source); the eight §9 codes need run-time evidence and are **not** enforced by `check.mjs` yet.
(5) Every statement of 97.8% as coverage in L1-PATTERNS, LIBRARY, LIBRARY-TESTS, this file and the library README now
gives the audited 88.4% (75.0–95.1%), or 96.1% (85.2–99.1%) with dashboard apps explained, and says that the census
counts "not refused".

**Census revision 1, NOT a measurement** (a candidate generator; `out/pattern-census.json`, `.md`,
`out/pattern-evidence.md`): not refused 1,510 of 1,559 (96.9%; 1,524, 97.8%, without the dashboard criterion); flat
within the 5-pattern budget 1,276 (81.8%; was 1,281, 82.2%); hierarchical 234 (15.0%); refused 49 (35 by the corpus IR
verdict + 14 by the criterion); greedy 90% at k = 38 (was 37); buildable S / +IR / +HOST / +D 26.9 / 48.4 / 65.6 /
73.8% (unchanged). Per-pattern support (items / platforms; removed detectors 0): P01 744/32 (support-only), P38
350/20, P08 229/14, P54 217/21, P27 214/24, P05 212/25, P45 209/26, P07 193/32, P06 172/26, P37 163/16, P36 154/15,
P20 144/28, P42 144/19, P32 135/24, P21 115/9, P29 112/9, P12 109/12, P34 109/11, P10 108/13, P33 108/6, P03 106/18,
P43 104/15, P14 100/20, P26 96/4, P55 91/15, P41 88/2, P04 75/19, P56 68/2, P13 66/18, P40 56/1, P53 53/20, P46 52/13,
P51 47/22, P28 44/14, P25 43/5, P47 41/17, P19 33/12, P15 31/4, P44 27/8, P39 26/5, P09 20/10, P57 20/2, P35 15/12, P50
12/10, P22 10/1, P31 9/6, P48 6/4; P02, P16, P17, P18, P23, P30, P49 0. `cards/catalog.json` was rebuilt from it, so
index lines carry the revised support.

**L0 card fit (owner decision PAUSE §5.10, taken 2026-10-14: cut the card, keep the allocation).** Before: 3,643 tokens
by the bound (point estimate 3,167; compact 3,406 / 2,962), over its 3,000 S6 allocation, so S6 refused it. After:
**2,962 by the bound** (point 2,576; compact 2,899 / 2,521); the S6 allocation stays 3,000 and S6 assembles the card
with every other part at its full allocation inside 8,000. The cut moved provenance, file paths and citations out of the
prompt into the card's outside-budget preamble, turned the two tables into one line per construct, and dropped the
duplicate `retry` field from row 15's example. All 30 constructs (number, status, meaning, canonical example) and every
rule the constructor contract and the checker rely on remain; T2 asserts each construct and each rule by phrase. One
rule was added because the checker enforces it already (`ENUM_NO_NONE`).

**Token counter (it replaces T1's chars/3.5).** No Claude tokenizer is available offline. The counter was fitted on
1,243 real Haiku 5.5 calls, using total input tokens from three local journals and a per-journal intercept for CLI
overhead of about 990–998 tokens. The fit is tokens ≈ 0.94·letter-runs + 0.22·letters + 0.87·digits + 0.61·punctuation,
with rmse 18.7; a chars-only fit gives 2.73 chars/token with rmse 37.8. `countTokens` uses (1.0, 0.22, 0.9, 0.65) × 1.15
as an upper bound. On those calls it undercounts 1 of 1,243, and its ratio to the measured count has min 0.98, median
1.19 and max 1.27. chars/3.5 undercounts nearly every call (median 0.74, min 0.54), so it is not a safe cap check.
Caveat: the bound counts whitespace as free; the card fit did not rely on that (no alignment padding was added).

**Findings that still need work.**
- Index lines of ≤ 30 tokens hold only an id, a name and a 2–4 word gist. The LIBRARY §4.1 example line measures 62
  tokens. `fitLine` drops fields by priority (gist, tier, grade, family, version, slots, support) and never truncates
  silently.
- The expanded cards fit: 309–642 tokens against 1,200 (P03, P09, P16 and P20 grew with their L6-a lines; the largest is
  still P54 at 642). `expandedCard()` renders the card head, J questions, slots and checklist; it leaves out the
  skeleton and the worked example.
- L1-a stays failed until a re-audit of the revised census on a fresh 60-item draw, with the owner's 10-item blind check
  done or waived (AUDIT-L1 §7). AUDIT-L1 §8 item 4 (step-level tag rules, tool nodes tagged `model`, P15 / P20 scope,
  P33 regex) and the `/form/` part of item 3 are open.

**Deviations and stubs.**
- The runner is a plain child process over the real flow-v3 SDK, `startServices` gateway and `createCallHost` in stub
  mode. This is the arrangement of part 1 of `flow-v3-call.test.mjs`, not the B1 sandbox. Judges are answered by the
  `tools/flow-override.mjs` hook. The model port throws `NO_LIVE_MODEL`, so an unanswered judge deopts and costs nothing
  (tested).
- S8 is allocated 2,000 tokens for "the slot only". §5.2 leaves that cell blank; the 2,000 comes from §5.1.
- PROFILE_UNREACHABLE: §6 requires `onDeopt: 'interpret-child'`, which flow-v3 slice 1 does not have. The checker accepts
  the slice-1 fallback `onRefuse: 'value'`, where the caller handles the refusal (P54 `ON_REFUSE`).
- CALL_TYPE is shown statically where a site declares its argument type: P54 `ARG`/`READS`, and in P01 the previous
  stage's `out`. P54 arguments are also computed from sample tasks and validated against the contract and profile. P07
  map handlers declare no argument type. They are listed as `unchecked` and left to the host's run-time `input-schema`
  check, not passed.
- Some cards add slots or guards that L1-PATTERNS §4 does not list:
  - P03: `ROW_SCHEMA`, `CONCURRENCY`
  - P16: a `blockable` guard
  - P17: `AMOUNT`, `CONCURRENCY`, a `unique-ids` guard
  - P54: `ARG`, `READS`, `CONCURRENCY`
  - P01: judge stages take an optional `merge`
  - P08: `MIN_KEEP` is optional
- P12 `BODY` is fn only.
- P09 votes in code, because the SDK has no `flow.flagged`.
- The registry implements the full §7.1 state set, a superset of the call host's shadow / kept / revoked.
- Steps 5–8 and 10: see the next section.

### Steps 5–8 and 10 (2026-10-14, $0)

**Step 5, retrieval (T9; LIBRARY-TESTS L2 code arms; `out/L2-code-arms.md`).** Gold is census revision 1's `needs` (a
candidate generator, not a measurement): 1,277 scored corpus items (of the 1,510 not refused, 233 need only L0
constructs and have no L1 gold). Recall@5 with platform-clustered 95% CIs: A1 BM25 0.194 (0.145–0.249), A2 code ranker
0.172 (0.127–0.221), and the popularity floor 0.267 (0.178–0.368), which beats both. Recall@20 is 0.354 for A1, 0.370
for A2 and 0.718 for the floor. With structural words stripped, A2 recall@5 drops to 0.110. On the 18 W-bed R1–R3
fixture tasks (gold = the §4 table's patterns, since no reference workflow exists yet), A2 recall@5 is 0.361 (0.25–0.50)
and recall@20 is 0.778. **The L2 falsifier is met: A2 recall@5 < 0.7 on W-bed tasks.** As built, the code ranker does
not find the needed patterns at k = 5. It does better at 20 (the size of the S5 list), and on the corpus it is worse than
ranking by popularity. Nothing was fitted to raise these numbers. What this means is a decision for the owner: show
the constructor more of the index (all 54 L1 lines are about 1,620 tokens against S5's 600-token index allocation), or
change the ranker and measure it again. A3 (bge-small) is not built because the repo has no local embedder.

**Step 6, constructor loop (T2 full).** With the scripted model, R0 tasks route `none` after intake. R1–R3 tasks
register L2 candidates: R1 runs one S8 repair (ENUM_NO_NONE), R2 one S1 rejection (a span that is not verbatim), and R3
builds a decomposed child called 16 times. Highest prompt token counts (bound): S1 3,183, S5 1,605, S6 5,544, S8 419,
against caps of 4,000, 4,000, 8,000 and 4,000. The scripted slot values are mechanical. They are not R1–R3 solutions,
and no oracle was run on them. Registration stops at `candidate`: verify-before-store needs live probes, an independent
verifier and a profile learned from accepted tasks, all paid steps.

**Step 7, Jev ports (T6).** Request shapes only; no Jev call. Two designed texts failed the option audit (Jaccard over
content words > 0.5, or no discriminating word) and were revised; `jev.mjs` `AUDIT_REVISIONS` keeps the originals:
- JEV-PORTS §5 `internal-reversible` / `internal-irreversible` share 56% of their content words.
- Card P01 J2 `one-pass` had no word its sibling lacks.

**Step 8, sweep (T5).** A P16 dedupe component, called two levels down a `flow.call` tree, was journaled on 24 seeded
dev fixtures. Its v1 has a latent BAND defect: pairs at similarity 0.3–0.6 are never judged. An independent check on one
task, whose input is inside the profile, confirms the defect; v2 fixes it. The sweep marks the same 8 of 24 runs that a
brute-force v2 re-run changes, with 12 judge answers from the journal and 8 re-asked at $0 through the stub. It marks
each stub child span and root run, relabels 8 ledger rows and moves the evidence. Without a $0 stand-in for the changed
judge sites, the sweep counts those runs as unresolved. It never passes them silently.

**Step 10, quarantine (T7; `out/T7-quarantine-baseline.json`).** Baseline b1, the regex list written from JEV-PORTS
§6's wording before the planted set existed and not tuned on it, scores:

| measure | value | Wilson 95% CI |
|---|---|---|
| recall on the 100 planted items | 0.39 | 0.30–0.49 |
| false-positive rate on the 100 clean items | 0.07 | 0.03–0.14 |
| false-positive rate on the hard negatives | 0.21 | — |

It catches all credential URLs (12/12) and most role changes (10/13). It misses every exfiltration, reuse-hijack and
tool-coercion line (0/38). This is the bar the port and baselines b2 and b3 must beat (JEV-PORTS §6: recall ≥ 0.95 at
≤ 5% false positives).

**Deviations (steps 5–8, 10).**
- **S4 always offers P01** (`construct.mjs` `ALWAYS`). The §4.3 ranker never surfaces P01 on R1. Slot paths are
  accessors and cannot reshape inputs, so a plan cannot begin without the spine. The L2 A2 arm does not include this
  rule.
- **S5b inserts P54 by code.** One `call-<child>` role is added per child, after the role the child names; §5.1 makes
  the join code's. The ranker does not retrieve P54 on R3.
- **S5 J1 questions.** S5 shows the J1 questions of as many top-ranked candidates as fit 600 tokens: 14 of the 18–20
  shown on the W-bed fixtures.
  §5.1 says "each of ≤ 20" and §4.4 says "the top 8"; showing J1 for all 20 does not fit.
- **S1 renders the task.** The request goes in verbatim, followed by a code-rendered input sample that counts its
  left-out lines. A request that alone exceeds 3,000 tokens is refused, never cut.
- **S3 `none` rule thresholds [I].** The rule routes `none` for size band S, no list over 3 items, one source and no
  effects. Reuse is off by default (LIBRARY §9).
- **S9 and S10.** S9 runs no live probes, so S10 registers L2 candidates, not `shadow` entries.
- **`shape/1` extension.** Tabular text (≥ 5 lines, ≥ 60% of them in one delimited line family) counts as an item list,
  with its header cells as keys. "JSON of the form" counts as verifiable.
- **P54 card.json** said tier `M` and constructs [12, 6, 3]. It now says `S` and [11, 6, 5, 7], matching L1-PATTERNS
  §7 and the skeleton. Under `M` the card was dropped by every tier filter. A2's corpus numbers moved slightly when this
  was fixed (out/L2-code-arms regenerated).
- **Companions come from the data.** §4.3's example says P45 → P46; revision 1's top companion of P45 by lift is P35.
- **The noul / score answer converter** is `jev.mjs` `fromJevAnswer`, not a change to `src/judgment.mjs`, which is
  under the E1 freeze.
- **Stage-A J1 rewrites.** Only P07, P09, P12 and P13 have the §3 state-path rewrites. Other J1s are wrapped and marked
  `rewritten: false`.
- **Sweep versioning and re-asks.** A byte fix is a new hash, so "v+1" is the fixed hash, named in `defect.fixedBy`.
  Live re-asks are refused (`liveUsdCap` 0; the design default is $1, then owner approval). In T5 a $0 stub table
  stands in for them.
- **The sweep reads the library run log** (`runs.jsonl`, `child-journal.jsonl`) or a stream `calls.jsonl`
  (`runsFromCallLog`). No paid run with `flow.call` exists yet to read.
- **Observed, not root-caused: a Node 24.21 computed-key anomaly.** After `clusterMean` had first run on rows of
  another shape, the computed-key load `r.m[metric]` in its loop returned another metric's value: recall@20 came back as
  precision@5. The function now reads metrics through arrays, and a regression test covers it. The step-5 numbers in
  6fbfa54 were unaffected (checked by regeneration). Other analysis code that loads metrics by computed key in hot loops
  may be worth checking.

**Not built or not run, and why.**
- **A3 embedding arm:** no local embedder; a model download would need its own pinning and acquisition record.
- **Live S9 probes, shadow admission and any Jev call:** paid steps (P1, P2).
- **The applicability thresholds τ:** no labelled rows exist yet.
- **T10 / the L6-a re-run:** a hand audit (step 9). A mechanical check that the 15 new lines carry their failure ids
  would confirm only that they were added.
- **P2–P7:** paid steps.

### M4 typed enumeration, coverage half (2026-10-14, $0; ATTACK-20261014 §3 M4, PROOF-LEDGER K6)

**Decision under the M4 rule: KILL, on the count clause.** At depth ≤ 4, with types and the declared temporal
constraints, all 33 tasks have more than 100 type-valid compositions:
- 2,000 on each W-bed rung (R1, R2, R3 × seeds 373–378);
- 2,000–12,308 on the 15 card fixtures (2,000 on P01's fixture, whose inputs hold no list, like the W-bed tasks).

Coverage is 33/33, so the correct composition is always in the set. Read over the 18 distinct type problems (15 fixtures
plus three rungs, since the TaskSpec types are per rung), the result is the same. The M4 kill mode holds: the cards'
types are too coarse to prune, so the composer question stays "not now". The g vs g-enum Haiku comparison is not worth
its $5–15 as specified. No model, Jev or network call was made. Output: `out/M4-enumeration.{json,md}`.

**Why the counts are large** [M].
- Card inputs are free text ("any (ITEMS reads it)"). The only typing the cards carry is that a `path` reader needs a
  list, and that a fixed `fragment.out` must be compatible with the goal.
- Three cards are universal adapters: P01 (any value to a slot-typed output), P54 (`fn` PARTS to a slot-typed COMBINE)
  and P20 (a judge to an untyped `result`).
- The W-bed inputs are text and maps of text, with no list. So types fix only the first position {P01, P20, P54} and
  the last {P01, P12, P54}: 3 × 15 × 15 × 3 = 2,025 at depth 4, and 2,171 in all.
- The ten temporal pairs remove 171 of these (7.9%).
- With the schemas exactly as declared, the counts are 54,240 (every sequence) or 50,624.

**Gold** (`fixtures/enumerate-gold.mjs`, sha256 `29f28d00…`). It was committed in `e9868ec` at 14:30 UTC, before
`enumerate.mjs` existed.
- Card fixtures: exactly [card].
- W-bed: the judged steps of the bed's reference outline, mapped to cards, as an ordered subsequence. R1 is [P03, P16];
  R2 is [P07, P09] in either order; R3 is [P17, P15 or P12].
- The W-bed golds need depth 4 (R1, R2) or 3 (R3). Under a fixed code order (length, then S4 rank) the first correct
  candidate ranks 163 (R1), 212 (R2) and 16 (R3), against Haiku's planned top 20.
- Secondary gold, the BUILD-ORDER §4 sets: the best single candidate holds 4 of 6 (R1; six cannot fit in four
  positions), 2 of 3 (R2) and 3 of 3 (R3).
- Soundness (tested): each card's own fixture and the three step-6 scripted plans are enumerated.

**Sensitivities** (diagnostic, not the rule; all over 33 tasks). None passes both halves.

| setting | tasks over 100 | coverage |
|---|---|---|
| each card at most once | 33 | 33/33 |
| alphabet = the S4 code ranker's shown set | 29 | 27/33 |
| depth ≤ 3 | 33 | 21/33 |
| all three | 3 | 15/33 |

**Files.**
- `enumerate.mjs`: types derived from card.json, the layers raw / typed / temporal, the DFS, and the rule.
- `m4.mjs`: the task sets and the measurement.
- `tools/m4-coverage.mjs`: writes the outputs.
- `fixtures/enumerate-gold.mjs`: the gold.
- `test/enumerate.test.mjs`: 8 tests. They cover the interfaces; the closed-output assumption, against 24+ fixture
  outputs; the type predicates; temporal semantics; DFS = brute force; soundness; the rule; and reproduction of the
  committed result.
- The library suite runs 127 tests, all green (26 s at `--test-concurrency=2`).

**Card change.** A `temporal` field was added to P03, P07, P16, P17 and P54. Each rule quotes its source line: J1 of
P03, P17's checklist, the companions of P54 and P58, and the ATTACK's "dedupe before aggregate". P58–P60 are frozen by
hash, so the rule P58 < P60 lives in `enumerate.mjs` `FROZEN_TEMPORAL`. "Validate before act" declares nothing, because
a tier-S solver performs no effect.

**Deviations.**
- No type field was added. Readers and list needs are derived from slot types.
- Outputs are closed at the top level, because skeletons return exactly the declared keys (tested).
- The goal check is compatibility, not subsumption.
- P54 children and P07 handler hashes are not enumerated, so a decomposed solution does not cover a core.
- The six W-bed seeds give identical counts, so the effective n is 3.
- A card-fixture gold is one card, so fixture coverage checks the typing more than composition.
- The readings of P03's "calculation" and of "aggregate" are [I].
- The W-bed gold is this author's mapping of the bed outlines [I]. No reference workflow (arm c) exists yet.
- Type-valid is not data-flow-valid. Each card returns only its own output, so for example [P01, P17, P15, P12] is
  type-valid although P12 cannot see P15's report. The counts are upper bounds for a data-flow typing that the cards do
  not declare.

**Not done.**
- Haiku ranking of the top 20, and g vs g-enum on R1–R3 dev: paid, and moot after the kill.
- S9 probe filtering: live.
- FD, key and conservation constraints mined from accepted interpreter outputs: no accepted W-bed outputs exist.

**What would change the answer** [I]. Each is a design change, not a tuning:
- a per-card data-flow contract (fields read, fields passed through);
- slot types known before S6;
- per-task constraints from the TaskSpec (APE's mechanism).

*Qualified by the verifier and by M4b below:* the first cannot work on its own. Under the strictest input typing the
verifier found, W-bed still has 520 candidates per task, and M4b shows that the four catch-all cards alone give 191.
Only the second and third act on the catch-alls.

### M4b precise types for the catch-all cards (2026-10-14, $0; PROOF-LEDGER K6)

**Decision under the unchanged M4 rule: KILL again, on the count clause. M4 does not pass.** P01, P12, P20 and P54 were
re-typed by what their skeletons read, check and return. No count changes: all 33 tasks keep M4's numbers.
- W-bed: 2,000 per rung.
- Card fixtures: 2,000–12,308.
- Coverage: 33/33.

The precise derivation confirms what M4 assumed: the four cards are polymorphic by design, not under-typed. Output:
`out/M4b-enumeration.{json,md}`. M4's code, gold and outputs are unchanged. No model, Jev or network call was made.

**What the skeletons say.** Each claim cites a line, and a test checks that the cited text is still on that line
(`card-types.mjs` PRECISE).
- **P01: any value in, a declared type out.**
  - x enters unchecked (`cards/P01/skeleton.mjs:8`). Only the stages read it: a step fn of v, a judge on the previous
    value, or a call (10–12).
  - Every stage output is checked against that stage's `out` schema slot (13), and the last one is returned (16). So the
    output type is STAGES[−1].out, which the constructor fixes at S6.
  - P01 never reads `task`.
- **P54: any value in, an unchecked value out.**
  - It reads (task, x) only through the fn PARTS (7).
  - ARG checks the part inputs (8) and READS checks the child outputs (13), but neither checks P54's own output.
  - COMBINE(kids, parts) is returned unchecked (14). No slot declares its schema.
- **P12: a list of non-null items in, an unchecked value out.** ITEMS must be a list of non-null items (5–9).
  REDUCE(results) is returned unchecked (10).
- **P20: any value in, a closed union out.**
  - GEN reads {input: x, problem} (9).
  - The output is {result, tries} or {result: null, review: {problem, tries}} (14).
  - `result` is a GEN value requested under the GEN.schema slot (`experiments/jit/flow.mjs:144`).
- **None of the four is type-preserving.** In each card's own positive fixture the output has a different shape from
  the input; for example P01 maps {csv, note} to {currency, count, totalMinor}.

**Why typing the other cards cannot pass the rule** [M].
- Compositions built only from the four catch-alls type-check whatever types the other eleven cards get.
- On a W-bed task there are 2 + 9 + 36 + 144 = 191 of them:
  - the first card is P01, P20 or P54;
  - the last card is P01, P12 or P54;
  - any of the four can stand in between.
- On the fixtures there are 191–340 (191 on P01's fixture, whose inputs hold no list, like the W-bed tasks).
- So the count clause fires on all 33 tasks under any typing of the other eleven.
- The verifier's strictest input typing for those eleven leaves 776 per W-bed task here. Its own run gave 520 because it
  read P20's `result` as a fixed key; here it is a declared slot type that a list reader can follow.

**Diagnostics** (not the rule; over 33 tasks).

| setting | tasks over 100 | coverage | W-bed per task |
|---|---|---|---|
| checked hand-offs: an unchecked output (P12, P54) feeds no list reader | 33 | 33/33 | 1,250 |
| the four catch-alls alone, checked hand-offs | 33 | — | 138 |
| P01 and P54 type-preserving (counterfactual; contradicts P01:13–16 and P54:14) | 33 | 31/33 | 306 |
| both | 33 | 31/33 | 275 |
| M4's sensitivities on the M4b layer (distinct; S4 alphabet; depth ≤ 3; all three) | 33, 29, 33, 3 | 33, 27, 21, 15 | — |
| distinct + depth ≤ 3 (the verifier's row) | 14 | 21/33 | 98 |

Under the type-preserving counterfactual, P01 and P54 can no longer produce their own fixture outputs. That is the
evidence that they are adapters.

**Checks.**
- The new walk with M4's interfaces returns exactly `enumerate.mjs`'s candidates (tested).
- An independent recount (`test/m4b-indep.test.mjs`) agrees on 126 of 126 numbers (18 distinct problems × 7
  settings). It imports neither `enumerate.mjs` nor `card-types.mjs`.
- The verifier's own scripts still reproduce M4.
- `tools/m4-coverage.mjs --dry` regenerates `out/M4-enumeration.md` byte for byte.

**Files.**
- `card-types.mjs`: the cited precise table, the interfaces, array locations with item requirements, and the walk.
- `m4b.mjs`: the measurement. It reuses `m4.mjs`'s task sets and the frozen gold.
- `tools/m4b-coverage.mjs`: writes the outputs.
- `test/m4b.test.mjs` (6 tests) and `test/m4b-indep.test.mjs` (1 test).
- `test/enumerate.test.mjs` no longer skips its reproduction check when a card.json digest changes. It recomputes the
  numbers and compares them (verifier finding 5). The E-bed agent's concurrent edits to P59 and P60 had made it skip.
- M4b pins its result on interface digests (what the type model reads), so a doc edit does not break it, and an
  interface change fails the test rather than skipping it.

**Deviations.**
- No card was edited. The precise interfaces live in `card-types.mjs`, for two reasons:
  - P58–P60 are frozen by hash;
  - a `fragment.out` on P01 would change what `run.mjs` validates fixtures against.
- Only the four catch-alls were re-derived. The other eleven keep M4's interfaces; the bound makes their typing
  irrelevant to the decision.
- P12's non-null item requirement changes no count (tested).
- P20's `result` is marked "declared" because flow.judge passes GEN.schema to the model. That the model port enforces it
  is [I].
- The checked reading is a diagnostic. The rule keeps M4's reading, that a slot can be filled to fit, so the rule is
  unchanged.

**What would change the answer** [I]. Only changes to the catch-alls' own contracts could, and each is a change to what
the cards mean:
- declare P12's and P54's outputs as schema slots that the skeleton checks, as P01 does at line 13;
- have S5 fix every declared output type before enumeration (slot types known before S6);
- per-task constraints from the TaskSpec.

Even P01 and P54 typed as type-preserving would leave 306 candidates per W-bed task.
