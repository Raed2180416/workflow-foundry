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

From L1-PATTERNS §7 [M-c]: items blocked only by unbuilt engine nodes, per node. If the owner wants the universality
claim to move from 48.4% (65.6% with host triggers) toward 97.8%, the order is:

| order | engine node (L0 row) | patterns | items unblocked (can overlap) |
|---|---|---|---|
| 1 | `state` (27): cross-run seen-set / cursor / counter, one writer, TTL | P42, P39 | 157 (+26) |
| 2 | `wait.signal` (19) with timeout routing | P33 | 108 |
| 3 | `session` (29) with capped memory | P43 | 104 |
| 4 | `admission` (28) | P40 | 56 |
| 5 | `stream` (30) | P44 | 39 |
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

Steps 1–4 of §1 are built in `experiments/library/` (2026-10-09; commits 88473c7, f22f1a3, 82bd36f, 85e5229 on
`claude/intelligent-hamilton-vg1f9a`). They cost $0: no model or Jev calls, no network, and nothing under `src/`,
`experiments/jit/` or `experiments/lib/` changed. Tests: `node --test --test-concurrency=2 experiments/library/test/*.test.mjs`
runs 63 tests, all green.

| step | files | tests |
|---|---|---|
| 1 store and index | `store.mjs` (registry, revocations, evidence, judgments and index JSONL; the §7.1 states and transitions; verify-before-store and keep gates; circuit breaker; requalify; retire), `index.mjs` (code-generated index lines ≤ 30 tokens, `shape/1` features, `buildIndex`), `cards.mjs`, `schema.mjs` (validation through `src/validate.mjs`; conservative subsumption), `tokens.mjs`, `tools/build-catalog.mjs` → `cards/catalog.json` (54 entries), `tools/calibrate-tokens.mjs` → `fixtures/token-calibration.json` | T1 4, T8 7, counter 3 (14) |
| 2 L0 and caps | `context.mjs`: the §5.2 cap table as code; `assemblePrompt` refuses with `CONTEXT_OVER_CLASS_BUDGET` (or `CONTEXT_PART_NOT_ALLOWED`) and never truncates; `l0Card()` | T2 partial 4 |
| 3 cards | `cards/P01 P03 P07 P08 P09 P12 P13 P15 P16 P17 P20 P54/{card.json, skeleton.mjs, fixtures/{positive,no-match,drift}.json}`, `skeletons/helpers.mjs`, `assemble.mjs` (typed slot checks, `fn:pure` lint, `solve.mjs` assembly), `run.mjs` ($0 runner) | T4 17 (all 36 fixtures pass; every drift fixture deopts with its expected kind and name) |
| 4 checker | `check.mjs` (`checkTree` / `checkSolver`) | T3 28: the clean reference tree and the 12 card examples fire nothing; 24 mutants cover all 18 codes and each fires exactly its own code |

**Token counter (it replaces T1's chars/3.5).** No Claude tokenizer is available offline. The counter was fitted on
1,243 real Haiku 5.5 calls, using total input tokens from three local journals and a per-journal intercept for CLI
overhead of about 990–998 tokens. The fit is tokens ≈ 0.94·letter-runs + 0.22·letters + 0.87·digits + 0.61·punctuation,
with rmse 18.7; a chars-only fit gives 2.73 chars/token with rmse 37.8. `countTokens` uses (1.0, 0.22, 0.9, 0.65) × 1.15
as an upper bound. On those calls it undercounts 1 of 1,243, and its ratio to the measured count has min 0.98, median
1.19 and max 1.27. chars/3.5 undercounts nearly every call (median 0.74, min 0.54), so it is not a safe cap check.

**Findings that need an owner decision.**
- The L0 card does not fit its S6 allocation. As written (the "Changes since draft" block excluded) it measures 3,643
  tokens (point estimate 3,167) against 3,000. The compact form measures 3,406 (2,962). S6 refuses it. Either cut the card
  by about 650 tokens or raise the S6 L0 allocation to about 3,700, which still keeps S6 under 8,000 (asserted in T2).
- Index lines of ≤ 30 tokens hold only an id, a name and a 2–4 word gist. The LIBRARY §4.1 example line measures 62
  tokens. `fitLine` drops fields by priority (gist, tier, grade, family, version, slots, support) and never truncates
  silently.
- The expanded cards fit: 309–642 tokens against 1,200. `expandedCard()` renders the card head, J questions, slots and
  checklist; it leaves out the skeleton and the worked example.

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
- Steps 5–10 are not started.
