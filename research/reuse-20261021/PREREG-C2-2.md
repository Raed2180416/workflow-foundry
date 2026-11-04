# Pre-registration: C2-2, consumer conformance as the reuse gate, on fresh suppliers and on its own blind spots

| Field | Value |
|---|---|
| Experiment id | C2-2 (task #43, requirements row A9; follows C2-1) |
| Claim tested | A proven workflow is reused by a separate program **once proven to work in that program**: program B admits program A's entry for a supplier only when the entry reproduces B's own labelled history for that supplier (consumer conformance, judged by the M3 bound), and then checks every run against everything proven (A's proof widened with B's conforming history). Falsifiable form: on fresh suppliers of every C2-1 kind this gate makes **zero wrong reuses**, and the M3 rule lets it serve; it fails, as stated in advance, only on drift that happens after the history (temporal semantic drift) |
| Evidence class | **development**: preregistered and frozen before any run on its items, but program B, its suppliers and its oracle are authored by the experimenter; not sealed |
| Cost | $0 (the entry is code-only; no model call anywhere; no build is run: costs of builds are projected from C2-1's measured unit costs and labelled as projections) |
| Date | 2026-10-22 |

## 0. Why (from C2-1, recorded before this design)

C2-1's preregistered gate (b3: profiles of the inputs and runs A proved the entry on) let 32 of 112 accepted test items through
wrong (S4 inverted scores 21, H4 offset scale 7, S3 1–10 scale 4) and refused every S6 item the entry got right (unproven
branches). A post-hoc gate conceived after the C2-1 test result, G0 ("the entry must reproduce B's 15 labelled history
products for the supplier"), had 0 wrong of 91 accepted, 10 false deopts. That is post-hoc. C2-2 tests it preregistered, on
fresh data, with a statistical admission rule instead of a hand-set one, and against four supplier kinds designed to break it.

Dev evidence used to design C2-2 (C2-1's test set, `runs/c2-1/devcheck-c22.json`, written before this file): G0-15 accepted 91,
0 wrong, 10 false deopts, 7 suppliers need a build; G0-15 with the widened per-run check (b3c) accepted 87, 0 wrong, 14 false
deopts (S6's 19 refusals under b3 are gone: its history covers the branches A's proof never reached; 3 S1 items with text shapes
the 15 history products did not show and 1 S5 item imputing a component no proven run imputed are refused), 9 suppliers need
a build.

## 1. Items

- Generator `gen-c22.mjs` over C2-1's frozen generator and oracle (`gen-b.mjs`, `program-b.mjs`, unchanged); seed
  **`c2-test-2`**; manifest `runs/c2-2/manifest-c22.json` (sha256 in `FREEZE-C2-2.json`). Per supplier: 60 labelled
  history products (pool order; the first 15 are what a C2-1 builder learned from) and 10 shipments of 1–3 stream items.
- Suppliers: one fresh supplier of each C2-1 kind (S0–S6, H1–H5; same definitions) and four new kinds aimed at consumer
  conformance (built as S0 under their own seeds, then changed in the one respect that defines them; truth is always the
  product's real SOP scores under B's matrix):

| Supplier | Kind | Entry on stream items | What a perfect gate does |
|---|---|---|---|
| T1 | temporal semantic drift: after the history, the scoring service stores scores inverted (6 − s) | mostly wrong | refuse; **no history-based gate can** (the history is right) |
| T2 | temporal shape drift: after the history, scores are answered as strings | wrong | refuse (the per-run check sees a new type) |
| T3 | sparse semantic drift: a sub-brand (~10% of products, history and stream) stored inverted | wrong on some sub-brand items | refuse the sub-brand items |
| T4 | label noise: one wrong label (adjacent class) among the first 15 history products | right | accept |

- Counts (from the generated manifest, recorded before any run): see §6.

## 2. Gates (all computed for every stream item, offline, $0)

Per supplier, the entry is run on its 60 history products in the supplier's world **as it was when B made those records**
(T2's service answered numbers then) and on its stream items in the world **as it is now**. Conformance = the entry's
strict answer equals B's recorded label.

| Gate | Rule |
|---|---|
| b0 | accept everything |
| b3 | C2-1's primary (G2 ∧ G3 on A's profiles), replicated |
| G0-15 | supplier admitted iff the entry reproduces all of the first 15 history labels (C2-1's post-hoc rule) |
| G0-15+b3c | G0-15, and per item G2 ∧ G3 (C2-1 options) on A's profiles widened with the conforming first-15 history runs |
| G0-60 | all 60 history labels reproduced |
| G0-M3 | M3 rule (`reuseBoundRule`, method exact, bound 5%, level 95%, minN 60; ATTACK-20261014 §3) on the 60 history decisions returns `serve` |
| **G0-M3+b3c (primary)** | G0-M3, and per item G2 ∧ G3 on A's profiles widened with the conforming 60 history runs |
| oracle | accepts exactly the items the entry gets right (ceiling) |

Deopt (a refused item) = the supplier's rebuild with C2-1's builder, as in C2-1. No build is run here.

## 3. Measurements

Per gate, pooled, on C2-1-kind suppliers, on T suppliers, and without T1: accepted, reuse rate, **wrong reuse** (accepted and
wrong), wrong-reuse rate, deopt rate, **false deopt** (refused though the entry was right), catch rate (refused among items the
entry gets wrong), suppliers needing a build; per supplier; M3 on the admitted stream decisions (parent = shipment; parent
exact "aE" and crossed M3b). Projection (labelled): USD and wall per item for REUSE (builds only for suppliers with a deopt)
and SCRATCH (every supplier builds) from C2-1's measured unit costs ($0.0506 and 241 s per build; agent $0.00134 and 11.4 s per
item), and the accuracy bound acc(REUSE) − acc(SCRATCH) ≥ − wrong reuse / items (REUSE and SCRATCH share the builds on refused
items, so this holds whatever the builds do).

## 4. Decision rules and predictions (recorded before the run)

- **E1 (the claim).** On the 12 C2-1-kind suppliers, the primary gate makes 0 wrong reuses and M3 (parent exact) on its
  admitted stream decisions returns `serve`. *Prediction: yes;* admitted suppliers S0, S1, S5, S6, H5; refused S2, S3, S4,
  H1–H4; a few item-level b3c refusals on S1/S5/S6.
- **E2 (stated blind spot).** On T1 the primary gate wrong-accepts ≥ 80% of the stream items the entry gets wrong.
  *Prediction: yes* (conformance proves the past; inverted scores keep every shape).
- **E3.** On T2 the primary gate refuses ≥ 95% of the items the entry gets wrong; G0-M3 alone refuses none.
  *Prediction: yes.*
- **E4.** T3: reported per gate. *Prediction:* G0-M3 refuses T3 (the 60-product history holds sub-brand products whose
  class the inversion changes); G0-15 may admit it (one realisation; ≈ 25% chance a priori).
- **E5.** T4: every G0 gate refuses it, so every T4 stream item the entry gets right is a false deopt. *Prediction: yes.*
- **E6.** S6: the primary gate's false deopts ≤ 2, against b3's refusal of every S6 item. *Prediction: yes.*
- **E7.** M3b crossed on the primary's admitted decisions: *prediction:* not `serve` (one entry: the entry axis has no
  information), as in C2-1.
- Pooled wrong-reuse rate of the primary: *prediction:* dominated by T1 (≈ 10–20% pooled); 0% without T1.

## 5. Threats

- Self-authored program, suppliers and blind-spot kinds; the experimenter designed T1–T4 knowing the gate. T1 and T4 fail
  it by construction; they are there to put a number on known limits, not to test them.
- One proven entry, one procedure: no rule can bound wrong reuse over entries (M3b).
- 60 labelled history products per supplier is an assumption about B (its own past classifications); C2-1's suppliers had 15.
- The per-run check (b3c) is sound only for effect-free tools (it runs before deciding), as in C2-1.
- No build runs: REUSE/SCRATCH accuracy is bounded, not measured; costs are projections from C2-1's unit costs.

## 6. Counts (from the generated manifest)

From `gen` output before the freeze; no run had been made on these items. Manifest sha256 `8d2a2bf1…`: 16 suppliers, 160
shipments, **320 stream items**, 1,280 products (960 history). Stream items per supplier: S0 20, S1 21, S2 17, S3 19, S4 24,
S5 20, S6 22, H1 20, H2 19, H3 20, H4 24, H5 15, T1 17, T2 22, T3 22, T4 18. T3's sub-brand: 5 of 60 history products (1 of
the first 15) and 2 of 22 stream items, so T3 can contribute at most 2 harmful items.

## Amendments
(dated entries only)
