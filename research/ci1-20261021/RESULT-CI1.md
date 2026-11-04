# CI-1 result: building real corpus workflows from a description, checked by running them

*2026-10-22 (bed, freeze, test runs) and 2026-11-04 (every failure root-caused, post hoc oracle v2, attribution, wave 2). Owner asks
E6 ("corpus-based construction tests: build X from a description, check by execution") and A8 ("give the builder templates and the
hardest enterprise patterns from the corpus"). Plan: [DOSSIER.md](DOSSIER.md). Preregistration: [PREREG-CI1.md](PREREG-CI1.md), frozen
by [MANIFEST.json](MANIFEST.json) (sha256 `39bf40bd…`, commit `b41910d7`) before the first test-split builder call; attribution addendum
[PREREG-CI1-ATTR.md](PREREG-CI1-ATTR.md); wave 2 [w2/PREREG-CI1-W2.md](w2/PREREG-CI1-W2.md). Dev evidence is labelled `dev*`; the test
split (19 items) and wave 2 are held out from builder development but written by the same author, so they are **not sealed**. Run
summaries: `runs/<label>/summary.json` and `rescore-v2.json` (records with built workflows stay outside git).*

## 0. Result

**Capability table** (wave 1 test split: 19 held-out n8n.io items × K = 3 builds per arm, Haiku 5.5 unless stated; pass = the built
workflow's effects equal the reference's in every hidden world; 95% item-bootstrap intervals):

| Arm | What | pass@1, oracle v1 (preregistered) | pass@1, oracle v2 (post hoc, §4) | pass^3 (v2) | $ / build | $ / verified build (v2) |
|---|---|---|---|---|---|---|
| **A0** | one-shot (the simple baseline) | 64.9% (45.6–82.5) | 80.7% (63.2–94.7) | 73.7% | $0.0052 | $0.0064 |
| A0t | one-shot, thinking on | 73.7% (57.9–87.7) | 80.7% (68.4–91.2) | 57.9% | $0.0061 | $0.0075 |
| A1 | BUILDER-1 templates, frozen | 0.0% | 0.0% | 0.0% | $0.0004 | – |
| A1c | compose path: worked examples, practice run, self-review, ≤ 3 repairs | 73.7% (57.9–87.7) | 82.5% (66.7–96.5) | 73.7% | $0.0091 | $0.0111 |
| **A2** | A1c + leave-one-out corpus pattern retrieval | **80.7% (63.2–94.7)** | **93.0% (80.7–100)** | 89.5% | $0.0089 | $0.0095 |
| A2-M | A2 on Mercury 3 (5 items × 1, exploratory) | 2/5 | 3/5 | – | $0 (listed free) | – |

- **Primary test (preregistered, v1): A2 − A0 = +15.8 points (95% CI 0.0 to 31.6), A2 better on 7 items, A0 on 1, sign test p = 0.07.**
  Retrieval, A2 − A1c: +7.0 (0.0 to 14.0); the park rule (≤ 3 points and upper bound < 10) does not trigger. All five preregistered
  predictions held (A1 ≤ 5%: 0%; A0 45–70%: 64.9%; A1c 60–85%: 73.7%; A2 − A1c in −5..+10: +7.0; A2 − A0 in +5..+25: +15.8).
- **The preregistered oracle was wrong on 25 of the 64 failing builds (39%)**, all false failures, in five defect classes found by
  root-causing every failure (§4, §5). Post hoc oracle v2 corrects exactly those five; every one of the 25 flips is explained by one of
  them; a label audit of the oracle's known blind spot found 0 false passes in 21 builds. Under v2: A2 − A0 = +12.3 (1.8 to 26.3,
  +4/−0 items, p = 0.125); A2 − A1c = +10.5 (1.8 to 22.8).
- **Wave 1's items are near ceiling.** Two descriptions turned out ambiguous (§5); without them (17 items, v2) one-shot Haiku passes 90.2% and
  A2 passes **51 of 51 builds**. Under v2, A2 had **no** builder failure in 57 builds; A0 had 5, all one class (a reference to the output
  of a branch that was skipped), which a practice run catches. The descriptions are complete specifications, so these items test
  translation of a stated procedure, not intent recovery: the gain left to measure here is a few items wide.
- **Templates do not transfer:** no BUILDER-1 template's data contract can bind any of the 33 admitted items (0/24 and 0/9, measured
  at $0 before any call), so A1 refuses 54 of 57 builds and its 3 others send nothing. BUILDER-1's 18/21 was on items made for its
  templates.
- **Which retrieved patterns helped** (§6): on one item (17878), the cards carried the effect (A2 3/3; exemplars without cards 1/3;
  A1c 0/3), P42 "cross-run state" most (1/3 without it); every other gain is within one build in three. 18 attribution builds, $0.32.
- **Thinking buys nothing** (A0t − A0 = 0.0 under v2) and brings new failures (double-escaped code, invalid workflows after repair).
- **Mercury 3** in the A2 harness: 3/5 against Haiku A2's 14/15 on the same 5 items (v2): not competitive in this harness.
- **Wave 2** (§9; 9 larger, newer items, preregistered with oracle v2 frozen as primary): A0, A1c and A2 all **40.7%**, A0t 48.1%;
  **A2 − A0 = 0.0 (−22.2 to 22.2)**. Two predictions missed (A0 and A2 lower than predicted). Root-causing all 62 failing builds found
  40 that fail only on new oracle defects or ambiguous descriptions; with those neutralised post hoc (w2x): A0 70.4%, A1c 81.5%, A2
  85.2%, A2 − A0 = +14.8 (0.0 to 29.6).
- **Pooled, 28 items, oracle v2 (the number to quote): A2 76.2% vs A0 67.9%, A2 − A0 = +8.3 points (−2.4 to 19.0), 5 items vs 1,
  p = 0.22; retrieval A2 − A1c = +7.1 (0.0 to 16.7).** With every root-caused oracle and description artefact removed (post hoc, 26
  items): A2 94.9% vs A0 83.3%, +11.5 (3.8 to 21.8), 6 items vs 0, p = 0.031.
- **Cost:** the whole item spent **$3.43** of Haiku (cap $10: dev $0.18, wave-1 test $1.69, attribution $0.32, wave 2 $1.24) and about
  0.34M Mercury tokens (cap 0.5M). A2 costs about 1.4–1.7× A0 per build.

## 1. What was built

| Path | What it is |
|---|---|
| `app/importers/n8n.mjs` (S0) | envelope fix: all 594 local n8n.io templates now parse (was 0) |
| `experiments/ci1/sim/n8n-sim.js`, `sim/run.mjs` | n8n-sim: the original corpus graph on stand-in nodes (~35 node types, v1 execution order, paired items, frozen clock, seeded random), corpus code only inside `src/sandbox.mjs`; Luxon 3.5.0 vendored (MIT, integrity-checked). HTML mail now keeps link targets (§2.3) |
| `experiments/ci1/canon.mjs` | oracle v1: behavioural equivalence on effects (facts, leaks, counts, sheets, JSON answers), not text similarity |
| `experiments/ci1/mutants.mjs`, `bed.mjs`, `gen-lib.mjs` | mutants of the reference, world distillation (greedy mutant cover, ≥ 6 hidden + 1 public world), two-reference admission gate, freeze |
| `experiments/ci1/foundry-world.mjs` | the same worlds for built Foundry workflows (+ `sheet.update`, `sheet.upsert`, `reply.send`) |
| `experiments/ci1/prompt.mjs`, `builders.mjs`, `library/` | the arms: A0/A0t one-shot, A1 (frozen BUILDER-1), A1c compose path (data-contract template filter, 2 frontier-written worked examples, practice in the public world, self-review, ≤ 3 repairs), A2 = A1c + retrieval |
| `experiments/ci1/retrieve.mjs`, `library/pattern-hints.json` | leave-one-out corpus retrieval: 479 model-free n8n templates as structure-only skeletons, WL structure hash, exclusion of target / same hash / Jaccard ≥ 0.6 / same author, masked-request BM25 + shape rerank, draft rerank, 16 pattern cards with IR hints |
| `experiments/ci1/run-arm.mjs`, `run-detached.sh`, `test-run.sh` | runner (question loop, scoring, env-fault exit, cost caps, address scrub), detached wrapper with the 30-minute fault rule |
| `experiments/ci1/manifest.mjs`, `gates.mjs`, `fit.mjs` | freeze gate, description leakage gates, template coverage |
| `experiments/ci1/report.mjs`, `failures.mjs`, `bed-summary.mjs` | analysis (pass@1, pass^K, item bootstrap, sign test, failure classes); outside the manifest |
| `experiments/ci1-posthoc/` | written after the freeze, outside the frozen tree: **post hoc** oracle v2 (`oracle-v2.mjs`, five declared changes) and `rescore.mjs` (§4); `diag.mjs` (rerun one build in one world beside the reference, used to root-cause every failure, §5); `label-audit.mjs` (false-pass audit of the label blind spot, §4.4); `audit-print.mjs`, `fp-audit-print.mjs`, `categorical-report.mjs`; `retrieval-report.mjs` (§2.4), `pattern-association.mjs` and `attribution-run.sh` (§6), `loop-stats.mjs` (§3.3) |
| `experiments/ci1-w2/` | wave 2 (§9): `bed2.mjs` (same protocol, oracle v2 primary and frozen), `run-w2.mjs`, `manifest-w2.mjs`, `survivor-audit.mjs` (survivors split by reachability from the item's trigger), `show-mutant.mjs`, `agree-why.mjs`, `retrieval-w2.mjs`, `fit-w2.mjs` |
| tests | `experiments/ci1/test/{sim,oracle,builders,report}.test.mjs`, `experiments/ci1-posthoc/test/{oracle-v2,effects-only}.test.mjs`, `experiments/ci1-w2/test/w2.test.mjs`, `app/test/n8n-import.test.mjs` |

## 2. The bed

### 2.1 Items

24 n8n.io templates (CI-1 pool census: 101 non-trivial items n8n-sim can run, 57 post-cutoff; the bed author built 24 of them, 15
in the earlier session of this item and 4 more here; 5 more were triaged and dropped: random assignment (9409), an inverted branch
and locale date parsing (18927), a 59-line scoring function a description could only transliterate (19945), a self-contradictory
upsert (7987), a vendor-keyed update that writes one row per vendor (14440)).

| Item | Split | Trigger | Created | Nodes (code) | Patches | Hidden worlds (no effect) | Effects in hidden worlds (mail / chat / answers) | Mutants killed / killable / total | Two-reference agreement |
|---|---|---|---|---|---|---|---|---|---|
| 18832 | dev | schedule | 2026-08-29 | 7 (1) | 3 | 6 (2) | 4 / 0 / 0 | 25 / 25 / 28 | 32/32 |
| 17118 | dev | schedule | 2026-07-14 | 11 (2) | 2 | 6 (2) | 12 / 0 / 0 | 23 / 23 / 23 | 32/32 |
| 17618 | dev | webhook | 2026-07-29 | 11 (3) | 0 | 6 (0) | 0 / 6 / 6 | 20 / 20 / 20 | 32/32 |
| 17719 | dev | webhook | 2026-08-01 | 9 (0) | 0 | 6 (6) | 0 / 0 / 0 | 13 / 13 / 15 | 32/32 |
| 20173 | dev | schedule | 2026-09-29 | 10 (2) | 1 | 6 (2) | 13 / 0 / 0 | 31 / 31 / 37 | 32/32 |
| 14177 | test | schedule | 2026-03-19 (pre) | 7 (1) | 0 | 6 (1) | 5 / 2 / 0 | 16 / 16 / 22 | 32/32 |
| 17545 | test | schedule | 2026-07-27 | 9 (2) | 0 | 6 (1) | 5 / 0 / 0 | 18 / 18 / 19 | 32/32 |
| 16364 | test | schedule | 2026-06-15 (pre) | 9 (4) | 0 | 6 (0) | 16 / 0 / 0 | 9 / 9 / 20 | 32/32 |
| 17342 | test | webhook | 2026-07-21 | 7 (0) | 0 | 6 (0) | 0 / 4 / 6 | 16 / 16 / 16 | 32/32 |
| 17878 | test | schedule | 2026-08-06 | 7 (1) | 1 | 6 (2) | 10 / 0 / 0 | 21 / 21 / 22 | 32/32 |
| 19103 | test | form | 2026-09-03 | 8 (0) | 0 | 6 (6) | 0 / 0 / 0 | 8 / 8 / 10 | 32/32 |
| 19445 | test | sheet-rows-added | 2026-09-10 | 7 (1) | 0 | 6 (0) | 0 / 11 / 0 | 20 / 20 / 20 | 32/32 |
| 19446 | test | form | 2026-09-10 | 15 (1) | 0 | 6 (0) | 6 / 0 / 0 | 25 / 25 / 25 | 32/32 |
| 17816 | test | schedule | 2026-08-04 | 7 (0) | 0 | 6 (3) | 7 / 0 / 0 | 9 / 9 / 12 | 32/32 |
| 16904 | test | webhook | 2026-07-07 | 11 (2) | 0 | 6 (0) | 1 / 0 / 6 | 20 / 20 / 20 | 32/32 |
| 15238 | test | webhook | 2026-04-22 (pre) | 10 (0) | 1 | 6 (1) | 5 / 4 / 0 | 23 / 23 / 24 | 32/32 |
| 11679 | test | schedule | 2025-12-11 (pre) | 11 (2) | 0 | 6 (2) | 7 / 0 / 0 | 13 / 13 / 15 | 32/32 |
| 17749 | test | webhook | 2026-08-02 | 11 (2) | 0 | 6 (0) | 0 / 2 / 6 | 22 / 22 / 23 | 32/32 |
| 17624 | test | schedule | 2026-07-29 | 9 (1) | 1 | 6 (2) | 0 / 11 / 0 | 21 / 21 / 25 | 32/32 |
| 16312 | test | schedule | 2026-06-12 (pre) | 7 (1) | 3 | 6 (1) | 12 / 6 / 0 | 12 / 12 / 16 | 32/32 |
| 17811 | test | schedule | 2026-08-04 | 8 (0) | 0 | 6 (1) | 8 / 0 / 0 | 10 / 10 / 13 | 32/32 |
| 17815 | test | schedule | 2026-08-04 | 8 (0) | 0 | 6 (1) | 10 / 0 / 0 | 10 / 10 / 12 | 32/32 |
| 17807 | test | schedule | 2026-08-04 | 8 (0) | 0 | 6 (1) | 5 / 0 / 0 | 13 / 13 / 14 | 32/32 |
| 17059 | test | schedule | 2026-07-13 | 8 (2) | 1 | 6 (3) | 4 / 0 / 0 | 11 / 11 / 14 | 32/32 |

Items 24; mutants 465, killable 409, killed by hidden worlds 409; median per-item score over all mutants 0.89, over killable 1.00; patches 13 on 8 items.

Patches (13 on 8 items, each with its reason in the item's `spec.json`): placeholders the author left for the user (links, names,
sheet ids) and data-loss defects of the original (a paired-item read after a Gmail node; an inverted If branch; an empty daily
e-mail, §2.3). The reference is "corpus graph + documented patches", run by stand-ins: a **shim interpretation**, not n8n.

### 2.2 Validity gates (measured at the freeze, $0)

| Gate | Target | Measured |
|---|---|---|
| Two-reference agreement (n8n-sim graph vs Foundry transliteration) on every candidate world | all | **24/24 items, 32/32 worlds each** |
| References deterministic on rerun | 100% | **100%** (every item) |
| REF arm (the transliteration as a "built" workflow) passes the oracle | 24/24 | **24/24** (`runs/freeze-REF-*`) |
| EMPTY arm (a workflow with no effects) passes | ≤ 5% | **0/24** (`runs/freeze-EMPTY-*`) |
| Mutation score of the hidden worlds | median ≥ 0.9 | **0.89** over all 465 mutants (median per item); **1.00** over the 409 mutants any of the 32 candidate worlds can kill |
| Description leakage gates (node names, n8n vocabulary, title, 8-gram overlap ≤ 0.10) | all pass | **24/24** after two rewordings (16904 "our n8n training", 17059 a phrase equal to a node name); max overlap 0.01 |
| Template coverage (a BUILDER-1 template can bind the item's sheets and columns) | — | **0/24** (`fit.mjs`; nearest template overlaps at most 6/9 columns) |

### 2.3 Surviving mutants (56 of 465), audited

| Class | Count | Examples |
|---|---|---|
| Value never reaches an effect (sheet ids, sheet URLs, unused settings, row-index helpers, comment banners, an `exists` check's ignored right value, a recipient field the node does not read, a Set node re-typing values that already have the type) | 29 | 14177 `googleSheetId`; 16364 the config node; 17811/17815/17816 "Capture Row Index"; 18832 `sendTo` (the node reads `toEmail`) |
| Bound by the bed (channel bound by node name; an idempotent update duplicated) | 2 | 17749 Slack channel; 16312 duplicated "Mark Notified" |
| n8n semantics make the step redundant (a node with no input items does not run) | 3 | 16364 "Products Found?" (gt→gte, 0-1, skipped) |
| Wording only: the oracle leaves wording free by design (business name, plural "s", the header shown when a list is empty, which sentence about the payment link, the sender's name) | 15 | 14177 `>`→`>=` on the "Overdue Invoices" header; 16364 `count > 1`; 20173 sender names |
| **Blind spot: a category label that is pure wording** (an out-of-stock item labelled "running low" carries a superset of the out-of-stock message's facts; reminder tiers 2 and 3 carry the same facts) | 3 | 17624 `stock <= 0`→`< 0` and the out-of-stock label; 17878 `tier === 2` |
| **Boundary not sampled** by the 32 candidate worlds | 4 | 20173 aging buckets at 31 and 91 days on a Monday (2), 18832 a 91-day item on a Monday, 17545 a 4-decimal amount |

One boundary is excluded on purpose: 14177's generator never puts a due date on the run's own day, because "already behind us" is
ambiguous at 09:00 on the due date.

Bed defects found **before the freeze** and fixed: n8n-sim dropped HTML link targets, so referral and booking links were invisible to the
oracle (16364, 17118; sim fix + test); 20173's generator rarely put Monday invoices on the aging-bucket edges (generator fix); dev item
18832 sent an empty "Renewals due — ok" e-mail daily, against its author's own comment (found by dev round 1: two independent builds
failed exactly that world; patched); 17118's placeholder links became visible after the sim fix (patched, description updated). Every
item was re-frozen after these fixes.

### 2.4 Retrieval (A2), at $0 (`retrieval-report.json`)

Index: 479 model-free n8n templates (local 594 + fetched 417, minus any with a model, agent or < 3 nodes), 453 distinct WL structure
hashes. Leave-one-out excluded, beyond the target, a mean of 1.6 items per bed item: same author on 9 items (up to 9 items for 15238),
**same structure hash on 3 test items** (17811 and 17815, siblings of 17816 by the same author; 17059, sibling of 16975), no Jaccard
≥ 0.6 near-duplicate otherwise. The most retrieved cards on the test split: P12 map → code reduce (15 of 19 items), P36 scheduled batch
(11), P42 cross-run state (10), P37 webhook → validate → act → respond (5), P16 dedupe and P60 time windows (4 each). 15 of the 57 test
exemplar slots are other bed items (the bed is a dense slice of the same corpus).

## 3. Preregistered results (oracle v1, test split)

### 3.1 Capability

`node experiments/ci1/report.mjs test-A0 test-A0t test-A1 test-A1c test-A2 test-A2M --pairs ...` (10,000 item resamples, seed 20261022):

| Arm | Items × K | pass@1 (95% CI) | pass^3 (95% CI) | $ / build | $ / verified build | tokens / build | outcomes |
|---|---|---|---|---|---|---|---|
| A0 | 19 × 3 | 64.9% (45.6–82.5) | 47.4% (26.3–68.4) | $0.0052 | $0.0080 | 25,605 | ready 57 |
| A0t | 19 × 3 | 73.7% (57.9–87.7) | 52.6% (31.6–73.7) | $0.0061 | $0.0082 | 28,131 | ready 57 |
| A1 | 19 × 3 | 0.0% | 0.0% | $0.0004 | – | 3,636 | unsupported 54, ready 3 |
| A1c | 19 × 3 | 73.7% (57.9–87.7) | 57.9% (36.8–78.9) | $0.0091 | $0.0124 | 77,886 | ready 57 |
| A2 | 19 × 3 | 80.7% (63.2–94.7) | 73.7% (52.6–89.5) | $0.0089 | $0.0110 | 72,251 | ready 57 |
| A2-M | 5 × 1 | 40.0% (0–80) | – | $0 | – | 41,867 | ready 5 |

| Contrast (paired by item) | Points (95% CI) | Items better / worse | Sign test p | Items |
|---|---|---|---|---|
| **A2 − A0 (primary)** | **+15.8 (0.0 to 31.6)** | 7 / 1 | 0.070 | A2: 15238, 16364, 16904, 17545, 17811, 17815, 19446; A0: 14177 |
| A2 − A1c (retrieval) | +7.0 (0.0 to 14.0) | 5 / 1 | 0.219 | A2: 11679, 16364, 16904, 17545, 17807; A1c: 14177 |
| A1c − A1 (composition) | +73.7 (57.9 to 87.7) | 17 / 0 | < 0.001 | |
| A1 − A0 (templates vs one-shot) | −64.9 (−82.5 to −45.6) | 0 / 14 | < 0.001 | |
| A1c − A0 | +8.8 (−3.5 to 21.1) | 7 / 3 | 0.344 | |
| A0t − A0 (thinking) | +8.8 (−7.0 to 28.1) | 4 / 4 | 1.000 | |

Predictions (PREREG §5) against outcomes: template fit 0/24 and A1 ≤ 5% → **0.0%**; A0 45–70% → **64.9%**; A1c 60–85% → **73.7%**;
A2 − A1c in −5..+10 → **+7.0**; A2 − A0 in +5..+25 → **+15.8**. Park rule: not triggered (A2 − A1c = 7.0 > 3).

### 3.2 Strata (memorisation)

| Stratum (v1) | A0 | A0t | A1c | A2 | A2 − A0 |
|---|---|---|---|---|---|
| created on or after 2026-07-01 (14 items) | 71.4% | 78.6% | 83.3% | 90.5% | +19.0 (4.8 to 35.7) |
| before (5 items: 14177, 16364, 15238, 11679, 16312) | 46.7% | 60.0% | 46.7% | 53.3% | +6.7 (−33.3 to 46.7) |

The older templates, which Haiku may have seen, are not easier: every arm scores lower on them (two of the five are 14177 and 16312,
an oracle defect and an ambiguous description, §5). No sign of memorisation; 5 items cannot rule it out.

### 3.3 What the loops did (`loop-stats.mjs`)

| Arm | validation repairs | practice-run repairs (then passed) | self-review asked for a fix (then passed) | calls / build |
|---|---|---|---|---|
| A0 | 2 | – | – | 1.0 |
| A0t | 3 | – | – | 1.1 |
| A1c | 1 | 3 (2) | 3 (0) | 2.2 |
| A2 | 0 | 5 (4) | 2 (1) | 2.2 |

The practice run (the built workflow run once in the item's public world, its run errors sent back) is what does the work: 6 of its 8
repairs ended in a passing build. The self-review (the model reads what its workflow did in the public world and accepts or asks for a
fix) accepted the delivered workflow in 111 of 114 builds; its 5 fix requests produced 1 pass: it adds cost, not capability, here.

## 4. Post hoc oracle v2

### 4.1 Five oracle defects, found by root-causing every failing build

Every failing test build was rerun in its failing hidden world beside the reference (`experiments/ci1-posthoc/diag.mjs`, $0) and read
against the item's description. 25 of the 64 failing builds failed only because of one of five defects of the frozen oracle v1
(`experiments/ci1/canon.mjs`). Oracle v2 (`experiments/ci1-posthoc/oracle-v2.mjs`, outside the frozen tree, tests in
`experiments/ci1-posthoc/test/oracle-v2.test.mjs`) changes exactly these five things and nothing else:

| # | v1 defect | Example | v2 change | Builds flipped |
|---|---|---|---|---|
| 1 | Greeting the addressee by name counted as leaking a row the reference leaves out | 16364: "Hi Soren" in Soren's own newsletter | a message may mention the row that holds its own recipient's address | 6 |
| 2 | A categorical cell identified a row | 17878: "if you have already paid" matched the one row whose Status is "Paid" | columns with ≤ 6 distinct values (each seen ≥ 2× on average) over the item's frozen worlds are not row identity (`categorical-report.mjs` lists them per item; none is a name, id or address on wave 1) | 8 |
| 3 | The reference's own wording carried facts the description never asked for | 14177: e-mail section headers "Overdue Invoices (1)", "All Unpaid Invoices (4)"; the description asks for counts only in the Slack alert | per-item optional spans, each justified from the description alone (`POSTHOC_DECL`: 14177, 17545) | 6 |
| 4 | A date the reference writes as ISO, written by the build as day/month/year, did not count | 17811: shift dates as 15/06/2026 | the candidate's numeric d/m/y dates also count, under every valid reading; candidate side only | 2 |
| 5 | v1's tokenizer dropped a number followed by a prose comma ("2026," "1,") | 17807: "expires 28/07/2026, 0 days left" carried no 2026; 14177 A0t: "Overdue invoices: 1, total" | split the number from the comma before tokenizing, both sides (on the 24 frozen oracles the reference side gains no fact: measured) | 2 |
| – | (scoring environment) a trivial Code step exceeded its 10 s wall clock under host load (load average above 20 on 4 shared CPUs) | 17815 A0 k2, one world | none: the rerun passes every world; reported, not an oracle change | 1 |

### 4.2 Rescoring method

`experiments/ci1-posthoc/rescore.mjs` reruns, at $0, every v1-failing hidden world of every v1-failing build (the built workflow runs again
in that world) and judges it with v1 and v2. This shortcut is valid only when v2 can never fail what v1 passed; `monotone(item)` checks
it per item (v2's required facts equal v1's on every hidden reference message) and all 24 items pass; on a non-monotone item every world
of every ready build would be rerun. The rerun also re-checks v1: every recorded v1 verdict reproduced except 17815 A0 k2 (the timeout
above). A rerun that times out is retried twice.

### 4.3 Results under v2 (`report.mjs ... --oracle v2`)

| Arm | pass@1, all 19 (95% CI) | pass^3 | pass@1, 17 unambiguous (v2x) | pass^3 (v2x) |
|---|---|---|---|---|
| A0 | 80.7% (63.2–94.7) | 73.7% | 90.2% (76.5–100) | 82.4% |
| A0t | 80.7% (68.4–91.2) | 57.9% | 84.3% (74.5–94.1) | 58.8% |
| A1c | 82.5% (66.7–96.5) | 73.7% | 90.2% (76.5–100) | 82.4% |
| A2 | **93.0% (80.7–100)** | 89.5% | **100% (51/51 builds)** | 100% |
| A2-M (5 items) | 3/5 | – | – | – |

| Contrast | v2 (19 items) | v2x (17 items) |
|---|---|---|
| A2 − A0 | +12.3 (1.8 to 26.3), +4/−0, p = 0.125 | +9.8 (0.0 to 23.5), +3/−0, p = 0.25 |
| A2 − A1c | +10.5 (1.8 to 22.8), +4/−0, p = 0.125 | +9.8 (0.0 to 23.5), +3/−0, p = 0.25 |
| A1c − A0 | +1.8 (−14.0 to 14.0), +4/−2 | 0.0 (−15.7 to 13.7), +3/−2 |
| A0t − A0 | 0.0 (−12.3 to 15.8), +2/−5 | – |

v2 was written after seeing the test failures, so these numbers are post hoc; the preregistered ones (§3) stand as the primary result.
v2's direction is fixed (it only removes false failures), so it raises every arm; it raises A0 most (+15.8 points) because A0's
messages more often greeted by name and paraphrased "already paid".

### 4.4 Could v2 pass wrong workflows? Two audits

- **Every flip explained.** For each of the 25 builds that v2 flips to pass, the v1 reasons in every failing world are one of the five
  classes above and nothing else (listed per build in §5).
- **The known blind spot** (§2.3: a category label that is pure wording) on the two test items where it decides what the recipient is
  told, 17624 (out of stock vs running low) and 17878 (friendly / firmer / final notice): `label-audit.mjs` reran all 21 builds that
  pass v2 there in every hidden world and checked each built message's label against the reference message to the same recipient (all
  messages paired). **0 false passes.**
- A full false-pass audit of all 190+ passing builds was not done; the oracle stays blind to wrong labels on other items (§2.3 lists
  where).

## 5. Every failure root-caused

### 5.1 By cause (first cause of each v1-failing build)

| Cause | A0 | A0t | A1c | A2 | A2-M | Verdict under v2 |
|---|---|---|---|---|---|---|
| Oracle v1 defect (§4.1, changes 1–5) | 8 | 4 | 5 | 7 | 1 | pass |
| Scoring environment (Code step timeout under host load) | 1 | – | – | – | – | pass on rerun |
| Ambiguous description (16312, 17545) | 6 | 3 | 5 | 4 | 1 | fail; dropped in v2x |
| **Builder:** reads the output of a node that was skipped (`MISSING_REFERENCE`) | 5 | 3 | 1 | – | 1 | fail |
| **Builder:** code written with literal `\n` escapes (double-escaped JSON): syntax error | – | 2 | – | – | – | fail |
| **Builder:** capability argument of the wrong type | – | 1 | – | – | – | fail |
| **Builder:** read the wrong form field (its own sheet audit then failed the run, after the effects) | – | 2 | – | – | – | fail |
| **Builder:** an unstated filter or a dropped effect | – | – | 4 | – | – | fail |
| Failing builds | 20 | 15 | 15 | 11 | 3 | |
| Genuine builder failures | **5** | **8** | **5** | **0** | **1** | |

A1: 54 builds refused as unsupported (the template selector found no template that fits; correct, since no data contract binds), 3
"ready" builds on 17878 bound the invoice-chase template to its own columns and sent nothing.

### 5.2 Per build

| Item | Builds | v1 reason | Root cause | v2 |
|---|---|---|---|---|
| 14177 | A0 k2; A1c k1, k2; A2 k0–2; A2-M | e-mail lacks facts [1, 2], [1], [4] | oracle defect 3: section-header counts the description does not ask for | pass |
| 14177 | A0t k1 | chat lacks [1] | oracle defect 5: "Overdue invoices: 1, total ..." | pass |
| 15238 | A0 k0; A0t k1 | `MISSING_REFERENCE nodes.urgent_slack.posted` | builder: the acceptance reads the result of the urgent-Slack branch, skipped when nothing is urgent; the IR rules say a skipped node's output is missing and offer `default` | fail |
| 16312 | every Haiku build (15) | chat to #deadlines: 1 sent, expected 2 | **ambiguous description**: "overdue items should also be posted to #deadlines with the item name, the owner's e-mail, the due date and how many days overdue" reads as one post per item (the reference) or one post listing them (every build) | fail |
| 16364 | A0 k0–2; A1c k1, k2; A2 k0 | mentions 1 row the reference leaves out | oracle defect 1: greets the subscriber by name | pass |
| 16904 | A0 k0–2; A0t k2; A1c k1 | `MISSING_REFERENCE nodes.reply_invalid.sent`, `nodes.check.duplicate`, `nodes.mail.delivered` | builder: skipped-branch reference (A1c k1: the public world never took that branch, so the practice run could not catch it) | fail |
| 17342 | A2-M | `MISSING_REFERENCE nodes.alertAudit.pass` | builder: skipped-branch reference | fail |
| 17545 | A0 k0–2; A1c k0, k2; A2 k0; A2-M | digest-log `open_count` differs | **ambiguous description**: "at the top say how many open quotes there are" after "leave out open quotes whose sent_date is missing ...": the reference counts only the kept ones | fail |
| 17749 | A0t k2 | `MISSING_REFERENCE nodes.reply_rejected.sent` | builder: skipped-branch reference | fail |
| 17807 | A1c k1 | lacks [2026] | oracle defect 5: "expires 28/07/2026, 0 full day(s) left" | pass |
| 17811 | A0 k0; A0t k1 | lacks `D:2026-06-15` and 7 more dates | oracle defect 4: dates as DD/MM/YYYY | pass |
| 17811 | A0t k0 | `SCHEMA_MISMATCH outbox.audit` | builder: passed the planned mail objects where the audit takes addresses | fail |
| 17815 | A0 k2 | `CODE_TIMEOUT` in 1 of 6 worlds | scoring environment: a 20-line date computation timed out under host load; the rerun passes every world | pass (rescored) |
| 17878 | A0 k0–2; A0t k1, k2; A2 k0–2 | mentions 1 row the reference leaves out | oracle defect 2: "if you have already paid" | pass |
| 17878 | A1c k0–2 | (v1 as above); v2: e-mail to Talia 0 sent, expected 1 | builder: skips an unpaid invoice whose currency cell is empty (`if (... !currency ...) continue`); the description requires only status, due date and client e-mail | fail |
| 17878 | A0t k0 | `CODE_ERROR` | builder: code with 93 literal `\n` escapes and no newline: a syntax error; A0t has no practice run | fail |
| 11679 | A0t k0 | `CODE_ERROR` | builder: the same double escaping (56 literal `\n`) | fail |
| 11679 | A1c k2 | e-mail to the supplier 0 sent, expected 1 | builder: left a SKU that already has an in-progress PO out of the supplier e-mail; the description says "don't add another [line]; the supplier e-mail still lists it" | fail |
| 19446 | A0 k2 | `MISSING_REFERENCE nodes.dup_email.delivered` | builder: skipped-branch reference | fail |
| 19446 | A0t k0, k1 | `ACCEPTANCE_FAILED`; invoice-register row with an empty invoiceDate | builder: did not read the form field "Invoice Date"; its own sheet audit then failed the run, after the e-mail and the row had gone out | fail |

### 5.3 What the failures say

- **One class dominates genuine failures: reading the output of a skipped branch** (10 of 19 genuine failures over all arms). The IR
  rules state the semantics and the remedy (`{"$ref": ..., "default": x}`); Haiku ignores them in one shot. A practice run catches it
  when the public world takes the branch (A1c, A2: 1 escape in 114 builds). A static check could catch it always: a `$ref` to a node
  with a `when` (or downstream of one), in a node that is not itself guarded by the same condition, without a `default`, is a validation
  error. That is a $0 validator rule, not a model capability: it covers 8 of A0/A0t's 13 genuine failures, and parsing Code steps at
  validation would cover the 2 double-escaped ones (not built here: the engine v2 series owns the validator).
- A1c's own error class (an unstated filter: 3/3 builds of 17878 skip rows with an empty currency) did not occur in A0 or A2. The
  compose path's worked examples validate inputs strictly; retrieval's cards for 17878 (§6) may counteract that.
- Thinking (A0t) did not reduce genuine failures (8 vs A0's 5) and added two new kinds (double-escaped code, wrong argument type).

## 6. Retrieval: which patterns helped

### 6.1 Association ($0, `pattern-association.mjs`, v2x, 17 items)

| Card (shown on items) | A2 − A1c where shown | where not shown | items with a gain |
|---|---|---|---|
| P42 cross-run state (9) | +18.5 | 0.0 | 11679, 16904, 17878 |
| P36 scheduled batch (9) | +11.1 | +8.3 | 17878 |
| P08 guard → act (1) | +100 | +4.2 | 17878 |
| P37 webhook → validate → act → respond (5) | +6.7 | +11.1 | 16904 |
| P16 dedupe (4) | +8.3 | +10.3 | 16904 |
| P02 fetch → transform → write (2) | +16.7 | +8.9 | 11679 |
| P12 map → code reduce (13) | +2.6 | +33.3 | 11679 |

Association only: cards co-occur, and the gain sits on three items (11679 +1/3, 16904 +1/3, 17878 +3/3). Under v1 the association
table pointed at different cards (16364 and 17807, both oracle artefacts), which is itself a warning about attribution on noisy verdicts.

### 6.2 Leave-one-pattern-out attribution (paid, exploratory; PREREG-CI1-ATTR.md)

A2 rebuilt with retrieved pattern cards removed (`run-arm.mjs --drop`, frozen code; the exemplar skeletons stay), K = 3, scored by
oracle v2 (`runs/test-attr-*/rescore-v2.json`). 18 builds, **$0.32** (estimate was $0.17: without their cards the builds asked the
self-review for more fix rounds and used 2–3× the tokens of the original A2 builds).

| Item | A1c (no retrieval) | A2 (3 cards + 3 exemplars) | − P42 cross-run state | − P36 scheduled batch | − P08 guard → act | − all 3 cards (exemplars only) |
|---|---|---|---|---|---|---|
| 17878 | 0/3 | **3/3** | 1/3 | 2/3 | 2/3 | 1/3 |
| 11679 | 2/3 | 3/3 | – | – | – | 3/3 |
| 16904 | 2/3 | 3/3 | – | – | – | 3/3 |

- **17878:** every failing build fails the same way as A1c's three: it skips the unpaid invoice whose currency cell is empty, an
  unstated filter. The cards carry most of the effect (3/3 with them, 1/3 with the exemplars alone, 0/3 with neither). The card whose
  removal costs most is **P42** ("cross-run memory lives in the sheet: before acting, skip rows whose marker column says it was already
  done"), which frames skipping around the explicit marker (LastReminderDate) instead of around data validity [I]. My preregistered
  guess, P08 ("treat missing values explicitly"), was wrong: removing it cost 1 of 3, as did P36. At K = 3 none of the single-card
  differences is distinguishable from noise (3/3 vs 1/3: Fisher p = 0.4); the all-cards contrast with A1c (3/3 vs 0/3, p = 0.1) is the
  strongest single-item signal in the experiment, and it is still one item.
- **11679, 16904:** with all cards removed A2 still passes 3/3, as predicted: the cards are not what these items' gains came from (A1c's
  failures there were one dropped e-mail and one skipped-branch reference, each 1 in 3, within noise).
- **Answer to "which retrieved patterns helped":** on this bed, one card (P42, with P36 and P08 contributing) on one item (17878), by
  steering the model away from inventing a validity filter; nothing else is distinguishable from noise. Retrieval's measured gain is
  small, real in sign under every oracle, and concentrated.

## 7. Mercury 3 (A2-M, exploratory)

A2 on `mercury-3`, K = 1, on the first 5 test items in SPLIT order (PREREG §3): 2/5 under v1, 3/5 under v2 (16364, 17878, 14177 pass;
17342 fails on a skipped-branch reference, 17545 on the ambiguous count). On the same 5 items Haiku A2 passes 14/15 (v2). Tokens:
209,337 for 5 builds (41.9K per build; Haiku A2 used 85K per build on those items); dev used about 130K (PREREG);
the item total stays under its 0.5M allowance. Mercury is listed free in `policy/models.json`, so its dollar cost reads $0. Not
competitive in this harness on this evidence (5 builds).

## 8. Deviations from the dossier and the preregistration

| # | What | Why |
|---|---|---|
| D1 | Descriptions written by the bed author (Opus 5.5, in session) instead of a separate paid describer call; no answer keys needed (all 24 descriptions are complete specifications, all keys empty) | the S5 describer budget (~$40) is not in this item's paid budget; the entailment audit became the mutant-survivor audit (§2.3), the anomaly scan and dev-run root-causing, which still missed three defect classes (§4) |
| D2 | Own seeded world generators per item instead of AutomationBench worlds; n8n-sim stand-ins only | the per-operation check of n8n request shapes against AutomationBench routes was not done; generators give boundary control |
| D3 | 24 items (5 dev, 19 test) instead of about 50-55 | bed construction is per-item hand work (read the graph, patch, generator, transliteration, description, agreement); 5 candidates were dropped (§2.1) |
| D4 | 6 hidden worlds per item (cover + minimum), from 32 candidates | the greedy cover reaches every killable mutant with ≤ 6 worlds on every item |
| D5 | A1c skips the template select call when no template's data contract fits the workspace (code check); A1 runs BUILDER-1 unchanged | no template can bind any item's data (0/24): the select call would only add cost |
| D6 | Practice in the item's public world with a self-review, not against expected effects | the builder never sees reference effects; practice catches run failures and lets the model check its own effects |
| D7 | Retrieved exemplars are n8n structure skeletons, not Foundry transliterations of other items | the corpus is n8n; transliterations are bed artefacts |
| D8 | Validator repair hints added to repair feedback in all arms (before the freeze) | dev round 2: Mercury rewrote a tautological acceptance four times without the hint |
| D9 | Mercury arm on 5 test items only; Opus one-shot arm not run | the item's Mercury allowance (0.5M tokens) and paid budget |
| D10 | Bed fixes before the freeze (sim link targets, 20173 generator, 18832 and 17118 patches) | §2.3; every item re-frozen afterwards |
| D11 | Post hoc oracle v2 (§4) | oracle defect classes found by root-causing test failures; reported beside the preregistered numbers, never instead of them |
| D12 | v2 change 5 (a number before a prose comma) added 2026-11-04, after the first v2 rescoring (changes 1–4) | found by root-causing the last unexplained failures (17807 A1c k1, 14177 A0t k1); the rescorer checks per item that it cannot fail what v1 passed |
| D13 | Attribution on the v2x flip items (17878 one card at a time and all cards; 11679, 16904 all cards), K = 3, instead of the v1 flip items at K = 1 | written in PREREG-CI1-ATTR.md before any attribution build: the v1 flips on 16364 and 17807 are oracle artefacts and 17545 is ambiguous; K = 1 cannot separate a one-in-three gap from noise |
| D14 | Wave 2 (§9): 9 more held-out items, wave-1 arms unchanged, oracle v2 frozen as primary; A1 and Mercury not run there | wave 1's intervals were wide and its items near ceiling; no template fits any wave-2 item (0/9); the Mercury allowance is nearly spent |
| D15 | The wave-2 scorer and the post hoc rescorer rerun a world whose run ends in `CODE_TIMEOUT` (at most twice); the frozen wave-1 scorer did not | one wave-1 build failed on a Code-step wall clock under host load (load average above 20 on 4 shared CPUs) |
| D16 | Pattern attribution, the label audit and the root-causing used the local run records; the committed summaries do not carry built workflows | records hold built workflows (corpus-derived content stays local); every number in this document is recomputable from them with the scripts named |
| D17 | Wave-2 post hoc sensitivity (w2x, eight transforms) instead of a third oracle version; wave-1 ambiguous items were dropped in v2x, wave-2 ambiguities neutralised field by field | the wave-2 artefacts are field-specific; dropping whole items would discard their correct parts; both readings are labelled post hoc and the frozen v2 numbers stay primary |
| D18 | During the wave-2 runs a frozen file (`manifest-w2.mjs`) was edited for about two minutes and restored byte-identical before any run started or resumed (A0/A2 had passed the check at 13:16, A1c/A0t passed it at 13:35) | an analysis helper was added to the frozen tree by mistake; it now lives in `experiments/ci1-posthoc/` |
| D19 | Disk fell to about 0.9 GB free (shared machine) during the last wave-2 arm; no new heavy step was started after it crossed 1.2 GB (only $0 rescoring, documents and commits) | the A0t arm was already running; stopping it would have saved a few MB and lost a preregistered arm |

## 9. Wave 2: nine larger items, oracle v2 frozen as primary

Preregistration [w2/PREREG-CI1-W2.md](w2/PREREG-CI1-W2.md), freeze `w2/MANIFEST-W2.json` (sha256 `333650cf…`, commit `9f44f9ad`) before
any wave-2 builder call. Nine n8n.io items created 2026-07-16 to 2026-09-28 (all after Haiku's cutoff), 7 to 35 nodes (median 17),
descriptions 245 to 652 words. Bed: two-reference agreement 32/32 on every item, every killable mutant killed (6–7 hidden worlds),
gates 9/9, template fit 0/9 (`w2/oracles-w2.jsonl`). Controls: **REF 9/9, EMPTY 0/9**. Surviving mutants, audited before the freeze
(`experiments/ci1-w2/survivor-audit.mjs`): 92 of 131 are in another trigger's subgraph of the same corpus file (17902, 18797, 19014,
20090), the rest are wording only, values that never reach an effect, a channel bound by the bed, n8n's no-items semantics, one true
equivalent (20090's phone normaliser at 10 digits), one blind spot (19187: which of two static rejection reasons) and two boundaries not
sampled (17771 at 0/1 days; 19187's fifth validity condition). Generators were extended where a stated boundary was not sampled.

### 9.1 Results (preregistered: oracle v2 frozen as primary)

| Arm | pass@1 (95% CI) | pass^3 | $ / build | $ / verified build | tokens / build | spent |
|---|---|---|---|---|---|---|
| A0 | 40.7% (14.8–66.7) | 22.2% | $0.0092 | $0.0227 | 35,371 | $0.25 |
| A0t | 48.1% (22.2–74.1) | 33.3% | $0.0122 | $0.0254 | 41,835 | $0.33 |
| A1c | 40.7% (11.1–70.4) | 33.3% | $0.0117 | $0.0287 | 70,702 | $0.32 |
| A2 | 40.7% (11.1–74.1) | 33.3% | $0.0127 | $0.0311 | 80,390 | $0.34 |

**A2 − A0 = 0.0 points (−22.2 to 22.2)**, 1 item each way. A2 − A1c 0.0; A1c − A0 0.0; A0t − A0 +7.4 (−7.4 to 22.2). Predictions:
A0 45–80% → **40.7% (missed, lower)**; A2 60–95% → **40.7% (missed)**; A2 − A0 in 0..+25 → 0.0 (edge); A2 − A1c in −5..+15 → 0.0;
A0t − A0 in −10..+10 → +7.4. Per item (v2): every arm passes 17902 and 18534 on every build; all 12 builds fail 17771, 19014 and 19187, and 11 of 12 fail 18281.

### 9.2 Every wave-2 failure root-caused

`experiments/ci1-posthoc/w2-reasons.mjs` groups every failing world's reasons; `diag-w2.mjs` reran each class beside the reference.
Of the 62 failing builds (A0 16, A0t 14, A1c 16, A2 16), **40 fail only because of the frozen oracle or the description**:

Counts are builds showing the class in any failing world (`experiments/ci1-posthoc/w2-classes.mjs`; a build can show several):

| Class | Item: what | Builds (A0 / A0t / A1c / A2) |
|---|---|---|
| Oracle | 17771: a logged e-mail address differs only in case (`NOOR.FAIRHURST@…` vs lower case) | 3 / 3 / 3 / 3 |
| Oracle | 19014: naming the project manager's address from the one-row settings sheet counted as a leak | 2 / 2 / 1 / 1 |
| Oracle | 18797: the invoice Owner's first name ("Pavel Okonkwo") matched another row's client ("Pavel Rothwell") as a leak | 1 / 1 / 1 / – |
| Oracle | 20090: the answer's message required the appointment ID (it has its own field; the description asks for date and time only) | – / – / – / 1 |
| Ambiguous description | 19187: "Evaluation Date and Logged At (now)": every build wrote a date in the Date column, the reference a date-time | 3 / 3 / 3 / 3 |
| Ambiguous description | 19014: the duplicate answer's `clientId` (new ID in the reference, the existing client's in every build) | 3 / 2 / 3 / 3 |
| Ambiguous description | 17175: whether the browser's answer carries the sheet's formula-escaping apostrophe | – / 1 / 3 / 3 |
| Ambiguous description | 17771: whether the log's customer_name takes the greeting fallback (the e-mail) | 3 / 3 / 3 / 3 |
| **Builder** | 18281: no build lists "phone number" as missing when the phone has fewer than 7 digits (the description says such a phone counts as not given); some also write "e-mail address" for the specified "email address" | **3 / 2 / 3 / 3** |
| **Builder** | 19014: the summary's placeholders ("Not provided", "No notes") written into the Start Date / Notes columns | 1 / – / 2 / 1 |
| **Builder** | reads the output of a skipped branch (`MISSING_REFERENCE`): 17175, 20090 | 2 / – / – / – |
| **Builder** | 18797: updates Reminder Count and Last Reminder Date in the invoices sheet, which the description never asks for (over-reach) | 1 / 1 / – / – |
| **Builder** | 18797: code written with literal `\n` escapes: syntax error | 1 / – / – / – |
| **Builder** | A0t: still invalid after its one validation repair (timeouts above the capability limit; untrusted webhook data deciding a reply without a gate) | – / 2 / – / – |
| Failing builds (v2) / genuine builder failures (still failing under w2x) | | 16 / 14 / 16 / 16 → **8 / 5 / 5 / 4** |

The post hoc sensitivity `w2x` (`experiments/ci1-posthoc/rescore-w2x.mjs`, eight declared transforms, each with its reason, applied to
both sides; tests in `experiments/ci1-posthoc/test/w2x.test.mjs`) neutralises exactly the oracle and description rows above:

| Arm | pass@1 v2 (preregistered) | pass@1 w2x (post hoc) | pass^3 w2x |
|---|---|---|---|
| A0 | 40.7% | 70.4% (48.1–88.9) | 44.4% |
| A0t | 48.1% | 81.5% (66.7–96.3) | 55.6% |
| A1c | 40.7% | 81.5% (55.6–100) | 77.8% |
| A2 | 40.7% | **85.2% (63.0–100)** | 77.8% |

Under w2x: A2 − A0 = +14.8 (0.0 to 29.6), +3/−0 items (17175, 18797, 20090); A2 − A1c = +3.7 (0.0 to 11.1); A1c − A0 = +11.1.

### 9.3 Pooled, 28 items (secondary, labelled)

| Contrast | Oracle v2 (wave 1 post hoc + wave 2 preregistered), 28 items | Corrected (wave 1 v2 without its 2 ambiguous items + wave 2 w2x), 26 items |
|---|---|---|
| A0 / A0t / A1c / A2 pass@1 | 67.9% / 70.2% / 69.0% / **76.2%** | 83.3% / 83.3% / 87.2% / **94.9%** |
| **A2 − A0** | **+8.3 (−2.4 to 19.0)**, +5/−1, p = 0.22 | **+11.5 (3.8 to 21.8)**, +6/−0, p = 0.031 |
| A2 − A1c (retrieval) | +7.1 (0.0 to 16.7), +5/−1 | +7.7 (1.3 to 16.7), +4/−0 |
| A1c − A0 (compose loop) | +1.2 (−10.7 to 11.9) | +3.8 (−9.0 to 15.4) |
| A0t − A0 (thinking) | +2.4 (−8.3 to 14.3) | 0.0 (−9.0 to 9.0) |

Park rule on the pooled items: A2 − A1c = 7.1 > 3, so retrieval is not parked. The corrected column is post hoc twice over (both
oracle corrections were written after seeing failures) and is the most favourable reading; the v2 column is the one to quote.

### 9.4 What wave 2 adds

- **Harder items exposed the oracle again.** With oracle v2 frozen, two thirds of wave-2 failures (40 of 62) were still oracle or
  description artefacts, now of new kinds (address case in a cell, settings rows, shared first names, fields the description never
  fixes). An effect oracle on larger, wordier workflows needs the false-negative probe of §10 before a freeze; v2's five corrections
  were not general enough.
- **On the frozen numbers the arms are indistinguishable** (all 40.7% except A0t 48.1%). Corrected, the ordering of wave 1 returns
  (A2 85% > A1c 81% = A0t 81% > A0 70%), with the same mechanism: A0's genuine failures include skipped-branch reads and escaped code
  that a practice run catches.
- **One genuine failure is shared by every arm:** 18281's "missing" list (11 of 11 failing builds treat a 6-digit phone as given).
  Neither retrieval nor the practice loop helps when the public world does not exercise the rule and the builder misreads a
  definition stated once, early, in a 500-word description.

## 10. What this means

**For the owner's asks.** E6 ("build X from a description, check by execution") now exists as a working, reusable measurement:
real n8n.io corpus workflows, run as references in a sandboxed n8n interpreter, admitted only when an independent Foundry
transliteration agrees on 32 worlds, scored by effects on mutation-adequate hidden worlds, never by text similarity. It covers the
deterministic, model-free slice of the corpus (54 to 86 of the 594 local n8n.io templates by the dossier's census); agent workflows
(74%) are out of reach until model nodes can be replayed. A8 ("give the builder templates and the hardest enterprise patterns"): templates bind none of the 33 admitted
items; corpus patterns retrieved leave-one-out help a little and on one item demonstrably; the "hardest enterprise patterns"
(fallbacks, approvals, compensation) are rare in n8n templates and none was retrieved for these items.

**What the evidence supports.**
1. A cheap model builds most described corpus workflows correctly in one shot when the description is complete and the workflow is
   small (wave 1, v2: 80.7%; 90.2% on unambiguous items). On larger items it does not (wave 2: 40.7% on the frozen oracle, 70.4% with
   oracle and description artefacts removed). Over all 28 items the harness (A2) adds about 8 points on the frozen oracle and 11.5 on
   the corrected one, never losing an item under the corrected reading: real, modest, and concentrated in a few error classes.
2. In wave 1 the genuine errors were mostly one engine-semantics class (reading a skipped branch's output; 10 of 19), whose cheapest
   fix is a $0 static validator rule, not retrieval, templates or thinking (handed to the engine v2 series: `src/validate.mjs` is
   theirs). In wave 2 the largest genuine class is a definition stated once and misapplied (18281, 11 builds across all arms), which no
   arm's machinery catches because the public world does not exercise it: a reason to generate practice worlds from the description's
   own conditions.
3. The practice run in a public world is the part of the compose loop that earns its cost; the self-review does not.
4. Retrieval: kept, not parked (the preregistered park rule does not trigger), but its effect here is a few items wide; the larger
   attributable effect was undoing an error class the worked examples may have introduced.
5. **The oracle is the weakest link, and root-causing every failure is what exposed it**: 39% of the preregistered oracle's failures
   were false in wave 1, and with five corrections frozen in, 65% (40 of 62) were still oracle or description artefacts in wave 2.
   A guard belongs in every future bed freeze: a false-negative probe that rewords each reference effect (greeting by name, list vs
   prose, date and number formats, letter case, punctuation, extra harmless detail) and requires the oracle to pass every rewording,
   plus an ambiguity probe (two independent cheap builds per item before the freeze; a field where both disagree with the reference
   the same way is read against the description).

**Next steps, ranked by capability per cost.**
1. Validator rule: a `$ref` to a node that has (or sits downstream of) a `when`, read by a node not guarded by the same condition and
   without `default`, is a validation error; parse Code steps at validation. $0; covers 10 of 19 genuine failures in wave 1 and 3 of
   22 in wave 2.
2. Oracle false-negative probe at freeze (above). $0 to a few cents with a cheap rewording model.
3. Harder items: descriptions with deliberate gaps and answer keys (questions become necessary), and agent-node items with recorded
   model responses, so the bed measures intent recovery and not translation.
4. A sealed subset described by a separate session that never sees builder code or results.
