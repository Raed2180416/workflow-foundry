# Pre-registration: `rs-streams-1` (DRAFT, not frozen)

*Draft written 2026-10-09 alongside [DESIGN-STREAMS.md](DESIGN-STREAMS.md). It is not frozen, and no RS world has
been generated or run. Fields marked **TBD** are fixed at freeze step F6 (DESIGN-STREAMS §11). That happens after the
dev worlds and before any test world is generated. When frozen, the commit SHA goes in the table and later edits go
only in Amendments. Section numbers "§n" without a file name refer to this document; "D-§n" refers to
DESIGN-STREAMS.md.*

| Field | Value |
|---|---|
| Experiment ids | Per item `<i>` ∈ {invoice, shop, quote} and test world `w` ∈ {71, 72, 73, 74}: `rs-<i>-w<w>-main`, `-static`, `-static-r2`, `-haiku`, `-frozen`, plus `rs-<i>-w71-tf`. Exact list TBD by O-2 |
| Claims tested | **Primary:** P-H1, P-H2, P-H3 (§6). **Secondary, directional:** verdicts V3–V7 and V-H (§7) |
| Claim wording | "On published n8n templates selected for documented defects and complexity, replicated as logic against mocks, …". No production, commercial-parity or worst-case-correctness claim |
| Evidence class | Held-out worlds (fresh test seeds nobody has generated or inspected) of a development-class harness. The drift families of epochs E2 and E3 are **sealed**. Not a sealed family. Harness, ports and arms come from the same agent pool |
| Pre-registration commit | TBD |
| Date | TBD |
| Owner sign-offs | O-2 (programme size): TBD. **O-6(a)** (declassify spec-A, rule cards, port, canary prompts): TBD, **required before any executor runs**. O-6(b) (port as compiler input): TBD. O-7 (engine lane): TBD. O-9 (JIT version): TBD |
| Spend | Per-config stops (§9). Programme total ≤ the O-2 amount: TBD (minimum viable ≈ $500–980; full ≈ $970–1,910) |

## 1. Items, worlds and splits

### 1.1 Items

| Item | Upstream | Role | Raw gz sha256 | Revision | Status |
|---|---|---|---|---|---|
| RS-INVOICE | n8n:13115 | pathfinder | `31b8fcaac51d0e1d939061ef1fd1d626b49da92a5af87245003134cbb3cf2314` | template 13115; createdAt 2026-01-30; sha256:b83b291bb1a5bbce | held-out |
| RS-SHOP | n8n:20421 | complexity ceiling | `3a29fdca559c6a1f605709d62a80552358e93c173be0284752f0b119029b71aa` | template 20421; createdAt 2026-10-05; sha256:0e52b46e3f6eff59 | held-out |
| RS-QUOTE | n8n:12285 | most judgment, approvals | `e97c60fa4e91dfccbc3331937755721e2d6757c4ace22110b76370453190db8e` | template 12285; createdAt 2025-12-29; sha256:e742437573fd50d8 | held-out if O-2 funds it |
| RS-SRE | n8n:19463 | optional fourth item | `46d6d34e4cabe60a741f6786059b8de3bd61d818d018ccec9a5678a1a28915c3` | template 19463; createdAt 2026-09-11; sha256:d46ed9693b8bc624 | optional |
| RS-SUPPORT | n8n:11807 | reserve, substitutes for RS-QUOTE | `7822a7ab6b53bf7d4fe58ef026b381ef0815be2da80eceae0647cffcb1c2ebbd` | template 11807; createdAt 2025-12-15; sha256:ba8b1f6047b94782 | reserve |

Per item, recorded at freeze:
- URL and API endpoint.
- A timestamped `retrievedAt`.
- sha256 of the raw (decompressed) bytes and of the gz bytes.
- `updatedAt`: absent. Checked 2026-10-09: none of the five records carries the field.
- The sha256 of every file below:

| File | INVOICE | SHOP | QUOTE |
|---|---|---|---|
| `experiments/replicate/streams/<i>/index.mjs` | TBD | TBD | TBD |
| `gen.mjs`, `oracle.mjs`, sealed plug-in (`*.sealed`) | TBD | TBD | TBD |
| `spec-A.md` | TBD | TBD | TBD |
| `port/solve.mjs`, `port/solve-tier.mjs` (local, gitignored) | TBD | TBD (no tier file: H-tier ≡ H) | TBD |
| `port/rule-cards.md`, `port/coverage.md`, `port/semantics-ledger.md` | TBD | TBD | TBD |
| `construct-haiku/w71..w74/solve.mjs` | TBD | TBD | TBD |
| author-statement registry, family list, intent rules | TBD | TBD | TBD |

**Substitution and exclusion (frozen at F0):**
- An item that fails K1, K2 or K4 (§9) is excluded and reported as "excluded: reason".
  - RS-QUOTE excluded → RS-SUPPORT substitutes.
  - RS-SHOP excluded → no substitute; the ceiling is reported missing.
  - RS-INVOICE excluded → the programme pauses for the owner.
- A K3 item ("no headroom") still runs H, JIT-O/H and the Haiku tier, and is labelled.

### 1.2 Worlds, seeds and epochs

- Each tick's seed = `world × 1000 + tick`, for ticks 1..80.

  | Worlds | Split | Use |
  |---|---|---|
  | 71–74 | **test** | held-out; seeds 71001–74080 |
  | 1 | dev | free world (bed health at d1–d5) |
  | 2–3 | dev | dev streams |
  | 4 | dev | calibration |
  | 8 | dev | construct-once examples, ticks 1–3 |
  | 9 | dev | spec-explicitness and canary instances |
  | 10–29 | dev | bed-health and trigger assertions |

- Burned and avoided: single seeds 0–27, 5001–5006 and 6001–6004; worlds 0, 5 and 6 unused. Any test world inspected
  by a person or an agent is recorded here as burned.
- Canonical epoch schedule (identical across items; no arm sees epoch labels):

  | Epoch | Ticks | Level | Content |
  |---|---|---|---|
  | E0 | 1–16 | 3 | base; no family triggers (asserted); no faults |
  | E1 | 17–40 | 4 | one counted family instance per tick: ≤ 12 a-family ticks (≤ 3 families × ≥ 4 instances), ≥ 12 s-family or neutral-probe ticks; first instances in 17–28; same-family instances ≥ 2 ticks apart |
  | E2 | 41–56 | 5 | sealed format drift |
  | E3a | 57–64 | 5 | persistent d-class change + sealed world families |
  | E3b | 65–72 | 5 | E3a + fault ramp 0 → 15% (sealed schedule) |
  | E4 | 73–80 | 3 | E0 distribution again |

- **Mode.** Closed loop (`chain: true`) is primary. Teacher-forced (TF) is a diagnostic on world 71 only.

## 2. Gates before any arm (by code; only counts are printed on test worlds)

1. **Bed health** (dev worlds):
   - determinism;
   - the reference chain passes every tick;
   - every bad control fails on ≥ 20 worlds:
     - empty;
     - shuffled or corrupted;
     - per-item near misses (INVOICE: subtotal for total, no dedupe, sum ignoring FX, alert on every invoice; SHOP:
       no re-pricing, two live links, reply while paused; QUOTE: `attendees[0]` as client, deposit as discount, an
       extra SKU, a missed retraction);
   - schema-invalid output is rejected;
   - no truth leaks into the inputs;
   - `generate` and `oracle` each take < 2 s at d5.
2. **Triggers:** empty on every E0 and E4 tick, exactly the assigned family on every E1 tick, the d-family on every E3
   tick (dev worlds 10–29).
3. **Twins:** the truth differs only on the mutated record, for 20 worlds per family.
4. **H\* gates** (closed loop, dev worlds 2–3):
   - core ≥ 95% on E0;
   - each a- and d-family fails 100% of its instances;
   - each s-family passes 100%.
5. **Port acceptance** (D-§5.4):
   - coverage audit;
   - one unit test per defect and per defence;
   - no `recalled` semantics on a graded path;
   - adapters reproduce H\* outputs 100%;
   - engine diff 100% on non-LLM nodes if O-7 is approved;
   - secret scan;
   - sandbox cannot read `port/`.
6. **Text gates and O-6:**
   - 5-gram overlap with upstream ≤ 2% and no shared run of 40 or more characters (spec-A, rule cards);
   - "no family named" checker;
   - intent-parity audit;
   - independent class audit (a disagreement demotes the family to b);
   - **O-6(a) signed**.
7. **Spec-explicitness labels**, frozen (D-§3.3): Haiku 5 samples (≥ 4/5 means spec-evident); Opus 3 samples (3/3).
8. **On each test world, before its arms run:**
   - `oracle-controls` passes for the reference chain, the H\* chain and all bad controls;
   - triggers match the schedule.

   If more than 1 of an item's 4 worlds fails, the item is excluded (K1).

## 3. Arms (definition hashes TBD from `armHash`)

| Arm | Spec string | Tier | Mode | Worlds | Config |
|---|---|---|---|---|---|
| H | `static:experiments/replicate/streams/<i>/port/solve.mjs` | human, Haiku nodes | closed | 71–74 | `-static` |
| H run 2 | same, fresh run ids | human | closed | 71–74 | `-static-r2` |
| H-tier | `static:…/port/solve-tier.mjs` | human, tier-matched | closed | 71–72 (not SHOP) | `-static` |
| H\* | in-process, perfect judges | — | closed + TF | all ($0) | oracle-controls |
| construct-once | `static:…/construct-haiku/w<w>/solve.mjs` | Haiku only | closed | 71–74 | `-static` |
| JIT-H/H | `jit:claude-haiku-5-5/claude-haiku-5-5`, `compilerFallback: null` | Haiku only | closed | 71–74 | `-haiku` |
| JIT-O/H | `jit:claude-opus-5-5/claude-haiku-5-5` | Haiku + rare frontier | closed | 71–74 | `-main` |
| JIT-O/H-frozen | same, `recompileOnDeopts: 999, shadowEvery: 0` | Haiku + rare frontier | closed | 71–72 | `-frozen` |
| jit-seed:H | `jit-seed:…/port/solve.mjs/claude-opus-5-5/claude-haiku-5-5` | human + JIT | closed | 71–72 (needs O-6b) | `-main` |
| jit-seed:construct-once | `jit-seed:…/construct-haiku/w71/solve.mjs/claude-opus-5-5/claude-haiku-5-5` | Haiku + rare frontier | closed | 71 (full programme only) | `-main` |
| agent-haiku | `agent:claude-haiku-5-5` | Haiku only, no artifact | closed | 71–72 | `-main` |
| agent-opus | `agent:claude-opus-5-5` | frontier ceiling | TF, ticks ≡ 0 mod 4 | 71 (full programme only) | `-tf` |
| JIT-O/H-TF, H-TF | as above | — | TF | 71 (full programme only; H-TF always) | `-tf` |

In the minimum viable programme, the secondary arms (H-tier, JIT-O/H-frozen, jit-seed:H, agent-haiku) run on world 71
only.

**Common settings:**
- `staticFallback: null`.
- `perTaskUsd` 1.
- Agent budget $2 and 15 min per session; compiled runs 20 min.
- H caps and timeout = 2× H's dev p99: TBD.
- JIT: warmup 3, shadowEvery 4, shadowOnFlags true, recompileOnDeopts 2, maxTraces 8, `maxFallbacks` 2 (O/H arms),
  `compare: 'family'`.
- Compile: promptVersion 3, builder effort high, builder $3, gateway $1.5, check $1.5, 30 min.
- **JIT version: v2.2 + v2.1 family compare + prompt v3 with the entrypoint/manifest addendum. Hash TBD; identical for
  all items.**
- Model ids only from `policy/models.json` (policyVersion TBD). Every fallback is logged.

**construct-once build:**
- the C0 B1 builder on `claude-haiku-5-5`, $1.5 cap, no probes;
- spec-A + 3 E0 worked examples from dev world 8, ticks 1–3 (task hashes TBD);
- one independent build per test world.

## 4. Families (frozen list per item; classes per D-§4.2)

The classes below are provisional and are fixed at F1 after the independent class audit. "Inst./world" is the number
of counted instances per test world.

**RS-INVOICE**

| Id | Class | Epoch | Inst./world | Pointer (RFC 6901) | H\* fails |
|---|---|---|---|---|---|
| F4 stale budget | a, state | E1 | ≥ 4 | TBD (`CalcSummary`) | TBD/TBD |
| F5 re-scan / re-export | a (pending audit) | E1 | ≥ 4 | TBD (`Crypto`, `StorageInput`) | TBD |
| F9 duplicate within one poll | a (pending audit + source semantics) | E1 | ≥ 4 | TBD (`CheckInvoiceExists`, `SaveInvoice`) | TBD |
| F1 foreign currency | d, shared logic | E3 | 16 | TBD (`CalcSummary`, `AlertMessage`) | TBD |
| s: unauthorised chat; first-run `/start`; non-invoice skip (bundle, contract, quote, bank statement); OCR failure → review; off-list category → Other | s | E1 | equal to the a-family count | TBD | passes 100% |
| F6, F2, F3 | b | dev only | — | — | — |
| F7 | cost | — | — | — | — |
| F8 | j | — | — | — | — |

**RS-SHOP**

| Id | Class | Epoch | Inst./world |
|---|---|---|---|
| SH1 open-cart selection (`Find Open Cart`) | a, state (pending) | E1 | ≥ 4 |
| SH2 inventory read-modify-write in one batch | a (pending source semantics) | E1 | ≥ 4 |
| SH3 burst across the debounce window | a (pending) | E1 | ≥ 4 |
| second Meta channel shape | d | E3 | 16 |
| s: Stripe redelivery; forged signature; price change before checkout; sold out at checkout; second checkout expires the old link; admin takeover pause; duplicate message id | s | E1 | equal count |

**RS-QUOTE**

| Id | Class | Epoch | Inst./world |
|---|---|---|---|
| Q2 organiser listed first | a (pending) | E1 | ≥ 4 |
| Q3 meeting-title variants | a (pending) | E1 | ≥ 4 |
| s: approval gate; 3-line cap; catalogue-only pricing with margin; rejection → feedback → revision | s | E1 | equal count |
| Q1 | cfg (filled in H-configured) | — | — |
| Q4, Q8 (fault, E3b) | b | reported | — |
| Q5, Q9 | j | — | — |

At most 3 a-families per item enter E1, in a priority order frozen at F1. Sealed families and the fault schedule: sha
TBD (F2); their content stays unknown until F7.

## 5. Measurements

- **Primary:** core pass per tick for every arm. Δ_w per test world:
  - drift ticks (E1 + E2 + E3a, 48);
  - base ticks (E0 + E4, 24);
  - comparator H-best = max(H run 1, H-tier) per tick (H for RS-SHOP).
- **Secondary:**
  - `succ_intent`, `succ_intent+prose` and `score` per epoch;
  - per-family `handled`, `exceeds`, `discovered`, `healed`, `durable`, `run_attributable`, seed-repaired;
  - spec-evident and demonstrator-given splits;
  - `heal_propagation`, `forgetting`;
  - TTD_e, $TTD_e and held rate (W = 6);
  - ss$_e, amortised $/success, maintenance$_e, break-even ticks, p50/p95 wall time per tick, calls per tick;
  - $ and tokens by model;
  - H$ and H$-graded;
  - silent rate; `carry-schema-break` and `carry-lost` counts;
  - fidelity; H − H\*;
  - fault metrics on E3b (exactly once, no lost event);
  - per-tick vs compounding defect (world 71 TF minus closed loop);
  - the share of JIT-O/H deliveries by Haiku-written version, Opus-fallback version and interpreter.
- All definitions as in D-§7. Every metric is recomputed offline from `outputs/<idx>.json`, `results.jsonl`,
  `events.jsonl` and the version matrix.

## 6. Hypotheses and analysis

| Id | Hypothesis | Arms | Ticks | Test |
|---|---|---|---|---|
| P-H1 | JIT-O/H core success > H-best | JIT-O/H vs H-best | drift (48 per world) | exact one-sided Wilcoxon signed-rank on {Δ_w}, pooled over every test world of every built item |
| P-H2 | JIT-O/H non-inferior to H-best, margin δ | same | base (24 per world) | same test on {Δ_w + δ} |
| P-H3 | JIT-H/H core success > H-best | JIT-H/H vs H-best | drift | as P-H1 |

- **Multiplicity:** Holm across P-H1 to P-H3, family-wise one-sided α = 0.05.
- **Wilcoxon details:** zero differences dropped (reported); ties get average ranks; exact null by enumeration.
- **Unit:** the world. Ticks in a closed-loop world are dependent and are never the unit of a primary test.
- **Sensitivity** (reported, not decisive):
  - a world-cluster bootstrap, B = 10,000, of each Δ and of TTD;
  - a stratified exact McNemar test on TF ticks of world 71.
- **Scripts:** `experiments/replicate/streams/analyze-streams.mjs` (sha TBD), the `durability.mjs` extension (sha TBD),
  the version-matrix runner (sha TBD).

## 7. Verdict rules (secondary; directional)

| Verdict | Rule |
|---|---|
| V1 equivalent on base | P-H2 holds |
| V2 more robust under drift | P-H1 holds |
| V3 finds flaws | For an item: ≥ 1 a-family with exceeds ∧ run_attributable ∧ durable, in ≥ 3 of 4 worlds. Reported split: run-attributable, spec-evident, demonstrator-given, seed-repaired |
| V4 adapts to world change | d-family handled ≥ 0.75 over E3a in ≥ 3 of 4 worlds. "Unknown" only from sealed families |
| V5 durable-equivalent | Post-drift (E3) TTD < ∞ in ≥ 3 of 4 worlds, and over the last 6 ticks of E3: core ≥ H-best, and intent ≥ 5 of 6 |
| V6 efficiency | ss$ JIT-O/H / H$-graded on E0 and on E4: ≤ 1.25 "almost", ≤ 1.0 "more efficient", in ≥ 3 of 4 worlds. Also reported against H-tier and H$ |
| V7 human better | exceeds(H-best over arm, f) for each s-family, plus P-H1 and P-H2 read in reverse |
| V-H Haiku by itself | P-H3, plus V1 and V3–V6 recomputed for JIT-H/H and for construct-once. The owner-facing sentence names the tier |

A headline sentence obeys D-§8.4. Before any claim, an independent agent re-classifies each claimed a-family from only
its registry entry and one failing instance. A demoted family is withdrawn from V3.

## 8. Power and noise

- **n:** 8 worlds in the minimum viable programme (2 items × 4), 12 in the full one.
- **Minimum attainable one-sided p:** 1/256 (n = 8), 1/4096 (n = 12).
  - At the first Holm step (α = 0.0167), n = 8 needs every world positive except at most one, of rank ≤ 2.
  - n = 12 allows W⁻ ≤ 11.
- **δ** = max(1 tick of 24 = 4.2 points, the H run 1 vs run 2 paired disagreement on base ticks of dev worlds 2–3,
  the JIT-O/H lineage spread between dev worlds 2 and 3) = **TBD**.
- The study is not powered for per-item inference. Every per-item result is directional and is reported only when it
  holds in ≥ 3 of 4 worlds.

## 9. Stop and kill rules

| Level | Rule |
|---|---|
| K1 | Oracle health fails, an alternative design fails, or more than 1 of 4 test worlds fails its controls → exclude the item |
| K2 | H\* core < 95% on E0 after 2 spec-A revisions (before F4) → exclude or rescope |
| K3 | Calibration on dev world 4 (TF, n = 4 per cell): agent-haiku ≥ 90% on E0 and E1 → "no headroom" label (still run). Agent-opus ≤ 25% on E0 → fix before F6 |
| K4 | Harness spend > 2× estimate (INVOICE $190, SHOP $260, QUOTE $210) → stop; report partial |
| Run | Any oracle control fails → stop all. An arm over 2× its estimate → stop that arm. Environment faults > 25% of an arm's ticks → that arm is invalid. A harness error twice → exclude that arm. An H cap hit, timeout or 429 → `ENV_FAULT`, retried once with a fresh run id, counted |
| Spend stops (per config, per world) | `-main` $90; `-static` $40; `-static-r2` $10; `-haiku` $25; `-frozen` $20; `-tf` $70 |
| Programme | Gate after RS-INVOICE dev world 2 (D-§11). The global stop at the O-2 total. The owner is notified before each item's held-out runs start |

## 10. Preconditions (each a checkbox at freeze)

| Gate | Requirement |
|---|---|
| G1 | P1–P16 merged and tested (D-§10). In particular: `staticFallback: null` is honoured (today `stream.mjs:72` turns null into Haiku); world segments; chain mode; `/svc` with provisional ledgers; bed contract v1.1; per-row output artifacts; version matrix; `jit-seed` arm |
| G2 | JIT v2.2 (#41) and v2.1 family compare merged; prompt v3 plus addendum frozen; one hash |
| G3 | `.gitignore` covers `experiments/replicate/streams/*/port/` before any port file exists; sandbox read test passes |
| G4 | Redacting reader committed with its sha; n8n source pinned as a research import (URL, SHA, date, licence) |
| G5 | Semantics ledger complete for every graded path; flip runs listed. A3 is decided if RS-SRE is built |
| G6 | Gates of §2 passed; O-6(a) signed (O-6(b) if jit-seed:H runs) |
| G7 | Sealed drift authored by an isolated session; hash recorded |
| G8 | Dev streams on worlds 2–3 completed for every arm at the frozen versions; δ, H caps and spend stops recorded |
| G9 | Contamination canary run (dev only); per-item labels recorded |
| G10 | Engine lane run and passed, **or** O-7 declined and the claim wording set to "source-pinned semantics" |

## 11. Cost (list-price lower bounds; the allowance binds)

| Component | Minimum viable (INVOICE + SHOP) | Full (3 items) |
|---|---|---|
| Prerequisites P1–P16 | $50–90 | $50–90 |
| Harness (build, port, verify, spec, sealed, calibration, dev) | $140–225 | $210–330 |
| Held-out (D-§13 per-world table) | $308–667 | $712–1,488 |
| **Total** | **≈ $500–980** | **≈ $970–1,910** |

Measured dev costs replace these estimates at F6 (TBD). Each item's held-out runs are their own experiment and need
the O-2 approval. Opus interpreter sessions dominate allowance use, so held-out runs are scheduled after a reset.

## 12. Threats to validity

These are as in D-§16, each with its residual:
- Spec rigging despite intent parity and s-families.
- Port fidelity, if O-7 is declined.
- Circular mocks.
- H on Haiku (mitigated by H-tier).
- Deopt rollback is a harness abstraction.
- Prose graded only by claim checks.
- Single annotator for allowed-set labels.
- Taint and declassification.
- Contamination of the three pre-cutoff items.
- Selection for documented defects.
- Lineage variance.
- Simulated time and tick granularity.
- Only script-form construction.
- Prompt-cache dependence of costs.
- Same agent pool for harness and arms.

## 13. Hash registry (filled at freeze)

| Object | sha256 |
|---|---|
| `stream.mjs`, `run-compiled.mjs`, `compile.mjs`, `interpret.mjs`, `flow-v2.mjs`, `prompts.mjs` (JIT freeze) | TBD |
| `services.mjs`, `beds.mjs`, `b0-agent.mjs`, `oracle-controls.mjs` | TBD |
| `analyze-streams.mjs`, `durability.mjs`, version-matrix runner | TBD |
| `policy/models.json` | TBD |
| Per-item files of §1.1 | TBD |
| Configs (every `rs-<i>-w<w>-*`) | TBD |
| Construct-once example task hashes (dev world 8, ticks 1–3) | TBD |
| Spec-explicitness results, class-audit results, canary results | TBD |

## Amendments

(none yet)
